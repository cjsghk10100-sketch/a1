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
      { title: "Artifact Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const { run_id } = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Artifact Contract Run" },
      workspaceHeader,
    );

    await postJson<{ ok: boolean }>(baseUrl, `/v1/runs/${run_id}/start`, {}, workspaceHeader);

    const { step_id } = await postJson<{ step_id: string }>(
      baseUrl,
      `/v1/runs/${run_id}/steps`,
      { kind: "tool", title: "Artifact step" },
      workspaceHeader,
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const runRow = await client.query<{ correlation_id: string }>(
        "SELECT correlation_id FROM proj_runs WHERE run_id = $1",
        [run_id],
      );
      assert.equal(runRow.rowCount, 1);
      const runCorrelationId = runRow.rows[0].correlation_id;
      assert.ok(runCorrelationId.length > 0);

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

      const createdPromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        stream_seq: number;
        correlation_id: string;
        causation_id: string | null;
        run_id: string | null;
        step_id: string | null;
        data: { artifact_id?: string; kind?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${fromSeq}`,
        (ev) => ev.event_type === "artifact.created",
        10_000,
      );

      const { artifact_id } = await postJson<{ artifact_id: string }>(
        baseUrl,
        `/v1/steps/${step_id}/artifacts`,
        {
          kind: "note",
          title: "Contract Artifact",
          content: { type: "json", json: { hello: "world" } },
          metadata: { source: "contract" },
        },
        workspaceHeader,
      );

      const created = await createdPromise;
      assert.equal(created.event_type, "artifact.created");
      assert.equal(created.run_id, run_id);
      assert.equal(created.step_id, step_id);
      assert.equal(created.data.artifact_id, artifact_id);
      assert.equal(created.data.kind, "note");
      assert.ok(artifact_id.startsWith("art_"));
      assert.notEqual(created.event_id, artifact_id);
      assert.equal(created.correlation_id, runCorrelationId);
      assert.equal(created.causation_id, stepCreatedEventId);

      const row = await client.query<{ artifact_id: string; kind: string; last_event_id: string }>(
        "SELECT artifact_id, kind, last_event_id FROM proj_artifacts WHERE artifact_id = $1",
        [artifact_id],
      );
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0].artifact_id, artifact_id);
      assert.equal(row.rows[0].kind, "note");
      assert.equal(row.rows[0].last_event_id, created.event_id);

      const list = await getJson<{ artifacts: Array<{ artifact_id: string }> }>(
        baseUrl,
        `/v1/artifacts?run_id=${encodeURIComponent(run_id)}`,
        workspaceHeader,
      );
      assert.ok(list.artifacts.some((a) => a.artifact_id === artifact_id));

      const detail = await getJson<{ artifact: { artifact_id: string; kind: string } }>(
        baseUrl,
        `/v1/artifacts/${encodeURIComponent(artifact_id)}`,
        workspaceHeader,
      );
      assert.equal(detail.artifact.artifact_id, artifact_id);
      assert.equal(detail.artifact.kind, "note");
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
