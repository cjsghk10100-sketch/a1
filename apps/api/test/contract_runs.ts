import assert from "node:assert/strict";
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
      { title: "Run Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const maxSeq = await client.query<{ max_seq: string }>(
        "SELECT COALESCE(MAX(stream_seq), 0)::text AS max_seq FROM evt_events WHERE stream_type = 'room' AND stream_id = $1",
        [room_id],
      );
      const fromSeq = Number(maxSeq.rows[0]?.max_seq ?? "0");
      assert.ok(Number.isFinite(fromSeq));

      const createdPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        stream_seq: number;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        data: { run_id?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${fromSeq}`,
        (ev) => ev.event_type === "run.created",
        10_000,
      );

      const { run_id } = await postJson<{ run_id: string }>(
        baseUrl,
        "/v1/runs",
        { room_id, title: "Contract Run" },
        workspaceHeader,
      );

      const runCreated = await createdPromise;
      assert.equal(runCreated.event_type, "run.created");
      assert.equal(runCreated.data.run_id, run_id);
      assert.equal(runCreated.run_id, run_id);
      assert.ok(run_id.startsWith("run_"));
      assert.notEqual(runCreated.event_id, run_id);
      assert.ok(runCreated.correlation_id.length > 0);
      assert.equal(runCreated.causation_id, null);

      const startedPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        stream_seq: number;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        data: { run_id?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${runCreated.stream_seq}`,
        (ev) => ev.event_type === "run.started",
        10_000,
      );

      await postJson<{ ok: boolean }>(baseUrl, `/v1/runs/${run_id}/start`, {}, workspaceHeader);

      const runStarted = await startedPromise;
      assert.equal(runStarted.event_type, "run.started");
      assert.equal(runStarted.run_id, run_id);
      assert.equal(runStarted.data.run_id, run_id);
      assert.equal(runStarted.correlation_id, runCreated.correlation_id);
      assert.equal(runStarted.causation_id, runCreated.event_id);

      const stepPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        step_id: string | null;
        data: { step_id?: string; kind?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${runStarted.stream_seq}`,
        (ev) => ev.event_type === "step.created",
        10_000,
      );

      const { step_id } = await postJson<{ step_id: string }>(
        baseUrl,
        `/v1/runs/${run_id}/steps`,
        { kind: "tool", title: "Contract step" },
        workspaceHeader,
      );

      const stepCreated = await stepPromise;
      assert.equal(stepCreated.event_type, "step.created");
      assert.equal(stepCreated.run_id, run_id);
      assert.equal(stepCreated.step_id, step_id);
      assert.equal(stepCreated.data.step_id, step_id);
      assert.equal(stepCreated.data.kind, "tool");
      assert.ok(step_id.startsWith("step_"));
      assert.notEqual(stepCreated.event_id, step_id);
      assert.equal(stepCreated.correlation_id, runCreated.correlation_id);
      assert.equal(stepCreated.causation_id, runStarted.event_id);

      const runRow = await client.query<{ status: string; last_event_id: string; correlation_id: string }>(
        "SELECT status, last_event_id, correlation_id FROM proj_runs WHERE run_id = $1",
        [run_id],
      );
      assert.equal(runRow.rowCount, 1);
      assert.equal(runRow.rows[0].status, "running");
      assert.equal(runRow.rows[0].correlation_id, runCreated.correlation_id);
      assert.equal(runRow.rows[0].last_event_id, stepCreated.event_id);

      const stepRow = await client.query<{ step_id: string; run_id: string; last_event_id: string }>(
        "SELECT step_id, run_id, last_event_id FROM proj_steps WHERE step_id = $1",
        [step_id],
      );
      assert.equal(stepRow.rowCount, 1);
      assert.equal(stepRow.rows[0].step_id, step_id);
      assert.equal(stepRow.rows[0].run_id, run_id);
      assert.equal(stepRow.rows[0].last_event_id, stepCreated.event_id);
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

