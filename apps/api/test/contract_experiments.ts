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
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
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
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const headers = { "x-workspace-id": "ws_contract" };
    const room = await requestJson<{ room_id: string }>(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Experiment Room", room_mode: "default", default_lang: "en" },
      headers,
    );
    assert.equal(room.status, 201);
    const room_id = room.json.room_id;

    const created = await requestJson<{ experiment_id: string }>(
      baseUrl,
      "POST",
      "/v1/experiments",
      {
        room_id,
        title: "Latency hypothesis",
        hypothesis: "Caching lowers p95 latency",
        success_criteria: { p95_ms_lt: 250 },
        stop_conditions: { max_errors: 3 },
        budget_cap_units: 50,
        risk_tier: "medium",
      },
      headers,
    );
    assert.equal(created.status, 201);
    const experiment_id = created.json.experiment_id;
    assert.ok(experiment_id.startsWith("exp_"));

    const listOpen = await requestJson<{
      experiments: Array<{ experiment_id: string; status: string }>;
    }>(baseUrl, "GET", "/v1/experiments?status=open", undefined, headers);
    assert.equal(listOpen.status, 200);
    assert.ok(listOpen.json.experiments.some((row) => row.experiment_id === experiment_id));

    const run = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, experiment_id, title: "Experiment run A" },
      headers,
    );
    assert.equal(run.status, 201);
    const run_id = run.json.run_id;

    const filteredRuns = await requestJson<{
      runs: Array<{ run_id: string; experiment_id: string | null }>;
    }>(
      baseUrl,
      "GET",
      `/v1/runs?experiment_id=${encodeURIComponent(experiment_id)}`,
      undefined,
      headers,
    );
    assert.equal(filteredRuns.status, 200);
    assert.ok(filteredRuns.json.runs.some((row) => row.run_id === run_id));

    const closeBlocked = await requestJson<{ error: string; active_run_count?: number }>(
      baseUrl,
      "POST",
      `/v1/experiments/${encodeURIComponent(experiment_id)}/close`,
      {},
      headers,
    );
    assert.equal(closeBlocked.status, 409);
    assert.equal(closeBlocked.json.error, "experiment_has_active_runs");

    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(run_id)}/start`, {}, headers);
    await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/complete`,
      { summary: "done", output: { ok: true } },
      headers,
    );

    const update = await requestJson<{ ok: boolean }>(
      baseUrl,
      "POST",
      `/v1/experiments/${encodeURIComponent(experiment_id)}/update`,
      { budget_cap_units: 75, metadata: { note: "post-run adjustment" } },
      headers,
    );
    assert.equal(update.status, 200);
    assert.equal(update.json.ok, true);

    const closeOk = await requestJson<{ ok: boolean; status: string }>(
      baseUrl,
      "POST",
      `/v1/experiments/${encodeURIComponent(experiment_id)}/close`,
      { reason: "sufficient evidence" },
      headers,
    );
    assert.equal(closeOk.status, 200);
    assert.equal(closeOk.json.ok, true);
    assert.equal(closeOk.json.status, "closed");

    const detail = await requestJson<{ experiment: { status: string } }>(
      baseUrl,
      "GET",
      `/v1/experiments/${encodeURIComponent(experiment_id)}`,
      undefined,
      headers,
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.json.experiment.status, "closed");

    const updateClosed = await requestJson<{ error: string }>(
      baseUrl,
      "POST",
      `/v1/experiments/${encodeURIComponent(experiment_id)}/update`,
      { title: "should fail" },
      headers,
    );
    assert.equal(updateClosed.status, 409);
    assert.equal(updateClosed.json.error, "experiment_not_open");

    const second = await requestJson<{ experiment_id: string }>(
      baseUrl,
      "POST",
      "/v1/experiments",
      {
        room_id,
        title: "Force-stop experiment",
        hypothesis: "Needs manual stop",
        success_criteria: { done: true },
        stop_conditions: { abort: true },
        budget_cap_units: 10,
        risk_tier: "high",
      },
      headers,
    );
    assert.equal(second.status, 201);
    const secondExpId = second.json.experiment_id;

    const secondRun = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, experiment_id: secondExpId, title: "running run" },
      headers,
    );
    assert.equal(secondRun.status, 201);
    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(secondRun.json.run_id)}/start`, {}, headers);

    const forceClose = await requestJson<{ ok: boolean; status: string; active_run_count: number }>(
      baseUrl,
      "POST",
      `/v1/experiments/${encodeURIComponent(secondExpId)}/close`,
      { force: true, reason: "manual stop" },
      headers,
    );
    assert.equal(forceClose.status, 200);
    assert.equal(forceClose.json.ok, true);
    assert.equal(forceClose.json.status, "stopped");
    assert.ok(forceClose.json.active_run_count > 0);

    const eventRows = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type IN ('experiment.created', 'experiment.updated', 'experiment.closed')
         AND workspace_id = $1`,
      ["ws_contract"],
    );
    assert.ok(Number(eventRows.rows[0]?.count ?? "0") >= 5);
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
