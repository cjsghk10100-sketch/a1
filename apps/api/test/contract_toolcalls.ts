import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { buildServer } from "../src/server.js";
import { createPool } from "../src/db/pool.js";

const { Client } = pg;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
    );

    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function postJson<T>(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(
  baseUrl: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers: {
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

async function waitForSseEvent<T>(
  url: string,
  predicate: (ev: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`SSE request failed: ${res.status}`);
    if (!res.body) throw new Error("SSE response has no body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      while (true) {
        const sep = buf.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice("data: ".length);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }

          const ev = parsed as T;
          if (predicate(ev)) {
            ac.abort(new Error("found"));
            return ev;
          }
        }
      }
    }

    throw new Error("SSE ended before the expected event");
  } catch (err) {
    if (ac.signal.aborted) {
      const reason = (ac.signal as unknown as { reason?: unknown }).reason;
      if (reason instanceof Error && reason.message === "timeout") {
        throw new Error("SSE timed out");
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: { port: 0, databaseUrl },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected server to listen on a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Tool Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const { run_id } = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Tool Contract Run" },
      workspaceHeader,
    );

    await postJson<{ ok: boolean }>(baseUrl, `/v1/runs/${run_id}/start`, {}, workspaceHeader);

    const { step_id } = await postJson<{ step_id: string }>(
      baseUrl,
      `/v1/runs/${run_id}/steps`,
      { kind: "tool", title: "Tool step" },
      workspaceHeader,
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const scopedPrincipalId = randomUUID();
      const scopedGrantorId = randomUUID();
      await client.query(
        `INSERT INTO sec_principals (principal_id, principal_type)
         VALUES ($1, 'agent'), ($2, 'user')`,
        [scopedPrincipalId, scopedGrantorId],
      );

      const scopedToken = await postJson<{ token_id: string }>(
        baseUrl,
        "/v1/capabilities/grant",
        {
          issued_to_principal_id: scopedPrincipalId,
          granted_by_principal_id: scopedGrantorId,
          scopes: {
            rooms: [room_id],
            tools: ["contract.echo"],
          },
        },
        workspaceHeader,
      );

      const deniedTool = await postJson<{ decision: string; reason_code: string }>(
        baseUrl,
        `/v1/steps/${step_id}/toolcalls`,
        {
          tool_name: "contract.blocked",
          input: { blocked: true },
          principal_id: scopedPrincipalId,
          capability_token_id: scopedToken.token_id,
        },
        workspaceHeader,
      );
      assert.equal(deniedTool.decision, "deny");
      assert.equal(deniedTool.reason_code, "capability_scope_tool_not_allowed");

      const deniedPolicyEvent = await client.query<{ event_type: string }>(
        `SELECT event_type
         FROM evt_events
         WHERE workspace_id = $1
           AND run_id = $2
           AND step_id = $3
           AND event_type = 'policy.denied'
         ORDER BY recorded_at DESC
         LIMIT 1`,
        ["ws_contract", run_id, step_id],
      );
      assert.equal(deniedPolicyEvent.rowCount, 1);

      const stepRow = await client.query<{ last_event_id: string | null }>(
        "SELECT last_event_id FROM proj_steps WHERE step_id = $1",
        [step_id],
      );
      assert.equal(stepRow.rowCount, 1);
      const stepCreatedEventId = stepRow.rows[0].last_event_id;
      assert.ok(stepCreatedEventId);

      const maxSeq = await client.query<{ max_seq: string }>(
        "SELECT COALESCE(MAX(stream_seq), 0)::text AS max_seq FROM evt_events WHERE stream_type = 'room' AND stream_id = $1",
        [room_id],
      );
      const fromSeq = Number(maxSeq.rows[0]?.max_seq ?? "0");
      assert.ok(Number.isFinite(fromSeq));

      const invokedPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        stream_seq: number;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        step_id: string | null;
        data: { tool_call_id?: string; tool_name?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${fromSeq}`,
        (ev) => ev.event_type === "tool.invoked",
        10_000,
      );

      const { tool_call_id } = await postJson<{ tool_call_id: string }>(
        baseUrl,
        `/v1/steps/${step_id}/toolcalls`,
        {
          tool_name: "contract.echo",
          input: { hello: "world" },
          principal_id: scopedPrincipalId,
          capability_token_id: scopedToken.token_id,
        },
        workspaceHeader,
      );

      const invoked = await invokedPromise;
      assert.equal(invoked.event_type, "tool.invoked");
      assert.equal(invoked.run_id, run_id);
      assert.equal(invoked.step_id, step_id);
      assert.equal(invoked.data.tool_call_id, tool_call_id);
      assert.equal(invoked.data.tool_name, "contract.echo");
      assert.ok(tool_call_id.startsWith("tc_"));
      assert.notEqual(invoked.event_id, tool_call_id);
      assert.equal(invoked.causation_id, stepCreatedEventId);

      const toolRow1 = await client.query<{ status: string; last_event_id: string }>(
        "SELECT status, last_event_id FROM proj_tool_calls WHERE tool_call_id = $1",
        [tool_call_id],
      );
      assert.equal(toolRow1.rowCount, 1);
      assert.equal(toolRow1.rows[0].status, "running");
      assert.equal(toolRow1.rows[0].last_event_id, invoked.event_id);

      const stepRow2 = await client.query<{ status: string; last_event_id: string }>(
        "SELECT status, last_event_id FROM proj_steps WHERE step_id = $1",
        [step_id],
      );
      assert.equal(stepRow2.rowCount, 1);
      assert.equal(stepRow2.rows[0].status, "running");
      assert.equal(stepRow2.rows[0].last_event_id, invoked.event_id);

      const succeedPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        step_id: string | null;
        data: { tool_call_id?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${invoked.stream_seq}`,
        (ev) => ev.event_type === "tool.succeeded",
        10_000,
      );

      await postJson<{ ok: boolean }>(
        baseUrl,
        `/v1/toolcalls/${tool_call_id}/succeed`,
        { output: { ok: true } },
        workspaceHeader,
      );

      const succeeded = await succeedPromise;
      assert.equal(succeeded.event_type, "tool.succeeded");
      assert.equal(succeeded.run_id, run_id);
      assert.equal(succeeded.step_id, step_id);
      assert.equal(succeeded.data.tool_call_id, tool_call_id);
      assert.equal(succeeded.correlation_id, invoked.correlation_id);
      assert.equal(succeeded.causation_id, invoked.event_id);

      const toolRow2 = await client.query<{ status: string; last_event_id: string; output: unknown }>(
        "SELECT status, last_event_id, output FROM proj_tool_calls WHERE tool_call_id = $1",
        [tool_call_id],
      );
      assert.equal(toolRow2.rowCount, 1);
      assert.equal(toolRow2.rows[0].status, "succeeded");
      assert.equal(toolRow2.rows[0].last_event_id, succeeded.event_id);
      assert.equal((toolRow2.rows[0].output as { ok?: boolean } | null)?.ok, true);

      const stepRow3 = await client.query<{ status: string; last_event_id: string }>(
        "SELECT status, last_event_id FROM proj_steps WHERE step_id = $1",
        [step_id],
      );
      assert.equal(stepRow3.rowCount, 1);
      assert.equal(stepRow3.rows[0].status, "succeeded");
      assert.equal(stepRow3.rows[0].last_event_id, succeeded.event_id);

      const runRow = await client.query<{ last_event_id: string }>(
        "SELECT last_event_id FROM proj_runs WHERE run_id = $1",
        [run_id],
      );
      assert.equal(runRow.rowCount, 1);
      assert.equal(runRow.rows[0].last_event_id, succeeded.event_id);

      const list = await getJson<{ tool_calls: Array<{ tool_call_id: string }> }>(
        baseUrl,
        `/v1/toolcalls?run_id=${encodeURIComponent(run_id)}`,
        workspaceHeader,
      );
      assert.ok(list.tool_calls.some((tc) => tc.tool_call_id === tool_call_id));

      const detail = await getJson<{ tool_call: { tool_call_id: string; status: string } }>(
        baseUrl,
        `/v1/toolcalls/${encodeURIComponent(tool_call_id)}`,
        workspaceHeader,
      );
      assert.equal(detail.tool_call.tool_call_id, tool_call_id);
      assert.equal(detail.tool_call.status, "succeeded");
    } finally {
      await client.end();
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
