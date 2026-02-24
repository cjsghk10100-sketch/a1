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

async function requestJson<T>(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = (text.length ? JSON.parse(text) : {}) as T;
  return { status: res.status, json };
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
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const headers = { "x-workspace-id": "ws_contract" };

    const room = await requestJson<{ room_id: string }>(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Evidence Room", room_mode: "default", default_lang: "en" },
      headers,
    );
    assert.equal(room.status, 201);
    const room_id = room.json.room_id;

    const thread = await requestJson<{ thread_id: string }>(
      baseUrl,
      "POST",
      `/v1/rooms/${encodeURIComponent(room_id)}/threads`,
      { title: "Evidence Thread" },
      headers,
    );
    assert.equal(thread.status, 201);
    const thread_id = thread.json.thread_id;

    const run = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, thread_id, title: "Evidence run" },
      headers,
    );
    assert.equal(run.status, 201);
    const run_id = run.json.run_id;

    const started = await requestJson<{ ok: boolean }>(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/start`,
      {},
      headers,
    );
    assert.equal(started.status, 200);
    assert.equal(started.json.ok, true);

    const step = await requestJson<{ step_id: string }>(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/steps`,
      { kind: "work", title: "collect evidence", input: { stage: 1 } },
      headers,
    );
    assert.equal(step.status, 201);
    const step_id = step.json.step_id;

    const tool = await requestJson<{ tool_call_id: string }>(
      baseUrl,
      "POST",
      `/v1/steps/${encodeURIComponent(step_id)}/toolcalls`,
      { tool_name: "web_search", input: { q: "agent os evidence" } },
      headers,
    );
    assert.equal(tool.status, 201);
    const tool_call_id = tool.json.tool_call_id;

    const toolDone = await requestJson<{ ok: boolean }>(
      baseUrl,
      "POST",
      `/v1/toolcalls/${encodeURIComponent(tool_call_id)}/succeed`,
      { output: { hits: 1 } },
      headers,
    );
    assert.equal(toolDone.status, 200);
    assert.equal(toolDone.json.ok, true);

    const artifact = await requestJson<{ artifact_id: string }>(
      baseUrl,
      "POST",
      `/v1/steps/${encodeURIComponent(step_id)}/artifacts`,
      {
        kind: "note",
        content: { type: "json", json: { evidence: "ok" } },
      },
      headers,
    );
    assert.equal(artifact.status, 201);
    const artifact_id = artifact.json.artifact_id;

    const complete = await requestJson<{ ok: boolean }>(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/complete`,
      { summary: "done", output: { ok: true } },
      headers,
    );
    assert.equal(complete.status, 200);
    assert.equal(complete.json.ok, true);

    const evidence = await requestJson<{
      evidence: {
        evidence_id: string;
        run_id: string;
        run_status: string;
        manifest_hash: string;
        event_hash_root: string;
        manifest: {
          pointers: {
            step_ids: string[];
            tool_call_ids: string[];
            artifact_ids: string[];
            events: Array<{ event_id: string; stream_seq: number; event_hash: string }>;
          };
          completeness: { terminal_event_present: boolean; all_toolcalls_terminal: boolean };
        };
      };
    }>(baseUrl, "GET", `/v1/runs/${encodeURIComponent(run_id)}/evidence`, undefined, headers);
    assert.equal(evidence.status, 200);
    assert.equal(evidence.json.evidence.run_id, run_id);
    assert.equal(evidence.json.evidence.run_status, "succeeded");
    assert.ok(evidence.json.evidence.manifest_hash.startsWith("sha256:"));
    assert.ok(evidence.json.evidence.event_hash_root.startsWith("sha256:"));
    assert.ok(evidence.json.evidence.manifest.pointers.step_ids.includes(step_id));
    assert.ok(evidence.json.evidence.manifest.pointers.tool_call_ids.includes(tool_call_id));
    assert.ok(evidence.json.evidence.manifest.pointers.artifact_ids.includes(artifact_id));
    assert.ok(evidence.json.evidence.manifest.pointers.events.length >= 4);
    assert.equal(evidence.json.evidence.manifest.completeness.terminal_event_present, true);
    assert.equal(evidence.json.evidence.manifest.completeness.all_toolcalls_terminal, true);

    const refinalize = await requestJson<{
      created: boolean;
      evidence: { manifest_hash: string };
    }>(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/evidence/finalize`,
      {},
      headers,
    );
    assert.equal(refinalize.status, 200);
    assert.equal(refinalize.json.created, false);
    assert.equal(refinalize.json.evidence.manifest_hash, evidence.json.evidence.manifest_hash);

    const evidenceRows = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM proj_evidence_manifests
       WHERE run_id = $1`,
      [run_id],
    );
    assert.equal(Number(evidenceRows.rows[0]?.count ?? "0"), 1);

    const evidenceEvents = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type = 'evidence.manifest.created'
         AND run_id = $1`,
      [run_id],
    );
    assert.equal(Number(evidenceEvents.rows[0]?.count ?? "0"), 1);

    const failRun = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, thread_id, title: "Evidence fail run" },
      headers,
    );
    assert.equal(failRun.status, 201);
    const failRunId = failRun.json.run_id;

    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(failRunId)}/start`, {}, headers);
    const failed = await requestJson<{ ok: boolean }>(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(failRunId)}/fail`,
      { message: "boom", error: { code: "E_FAIL" } },
      headers,
    );
    assert.equal(failed.status, 200);
    assert.equal(failed.json.ok, true);

    const failEvidence = await requestJson<{
      evidence: { run_id: string; run_status: string };
    }>(baseUrl, "GET", `/v1/runs/${encodeURIComponent(failRunId)}/evidence`, undefined, headers);
    assert.equal(failEvidence.status, 200);
    assert.equal(failEvidence.json.evidence.run_id, failRunId);
    assert.equal(failEvidence.json.evidence.run_status, "failed");
  } finally {
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
