import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { runQueuedRunsWorker } from "../src/runtime/runWorker.js";
import { buildServer } from "../src/server.js";

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

async function requestJson(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  return { status: res.status, json, text };
}

async function createRunInWorkspace(
  baseUrl: string,
  workspaceHeader: Record<string, string>,
  roomTitle: string,
): Promise<{ room_id: string; run_id: string }> {
  const room = await requestJson(
    baseUrl,
    "POST",
    "/v1/rooms",
    { title: roomTitle, room_mode: "default", default_lang: "en" },
    workspaceHeader,
  );
  assert.equal(room.status, 201);
  const roomJson = room.json as { room_id: string };

  const run = await requestJson(
    baseUrl,
    "POST",
    "/v1/runs",
    { room_id: roomJson.room_id, title: "Worker run" },
    workspaceHeader,
  );
  assert.equal(run.status, 201);
  const runJson = run.json as { run_id: string };
  return { room_id: roomJson.room_id, run_id: runJson.run_id };
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
    const ws1 = { "x-workspace-id": "ws_contract_run_worker_1" };
    const ws2 = { "x-workspace-id": "ws_contract_run_worker_2" };

    const runA = await createRunInWorkspace(baseUrl, ws1, "Worker Room A");
    const runB = await createRunInWorkspace(baseUrl, ws2, "Worker Room B");

    const cycleA = await runQueuedRunsWorker(pool, {
      workspace_id: ws1["x-workspace-id"],
      batch_limit: 10,
    });

    assert.equal(cycleA.claimed, 1);
    assert.equal(cycleA.completed, 1);
    assert.equal(cycleA.failed, 0);

    const runAStatus = await db.query<{ status: string }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [runA.run_id],
    );
    assert.equal(runAStatus.rowCount, 1);
    assert.equal(runAStatus.rows[0].status, "succeeded");

    const runBStatusBefore = await db.query<{ status: string }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [runB.run_id],
    );
    assert.equal(runBStatusBefore.rowCount, 1);
    assert.equal(runBStatusBefore.rows[0].status, "queued");

    const runASteps = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM proj_steps WHERE run_id = $1 AND status = 'succeeded'",
      [runA.run_id],
    );
    assert.equal(Number.parseInt(runASteps.rows[0].count, 10), 1);

    const runATools = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM proj_tool_calls WHERE run_id = $1 AND status = 'succeeded' AND tool_name = 'runtime.noop'",
      [runA.run_id],
    );
    assert.equal(Number.parseInt(runATools.rows[0].count, 10), 1);

    const cycleB = await runQueuedRunsWorker(pool, {
      batch_limit: 10,
    });
    assert.ok(cycleB.claimed >= 1);
    assert.ok(cycleB.completed >= 1);

    const runBStatusAfter = await db.query<{ status: string }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [runB.run_id],
    );
    assert.equal(runBStatusAfter.rowCount, 1);
    assert.equal(runBStatusAfter.rows[0].status, "succeeded");

    const cycleEmpty = await runQueuedRunsWorker(pool, {
      batch_limit: 10,
    });
    assert.equal(cycleEmpty.claimed, 0);
    assert.equal(cycleEmpty.completed, 0);

    const eventCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE run_id = $1
         AND event_type IN ('run.started', 'step.created', 'tool.invoked', 'tool.succeeded', 'run.completed')`,
      [runA.run_id],
    );
    assert.ok(Number.parseInt(eventCount.rows[0].count, 10) >= 5);
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
