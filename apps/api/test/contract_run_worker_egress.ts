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

async function createRoom(baseUrl: string, workspaceHeader: Record<string, string>): Promise<string> {
  const room = await requestJson(
    baseUrl,
    "POST",
    "/v1/rooms",
    { title: "Worker Egress Room", room_mode: "default", default_lang: "en" },
    workspaceHeader,
  );
  assert.equal(room.status, 201);
  const roomJson = room.json as { room_id: string };
  return roomJson.room_id;
}

async function createRunWithEgress(
  baseUrl: string,
  workspaceHeader: Record<string, string>,
  input: {
    room_id: string;
    title: string;
    action: string;
    target_url: string;
    method: string;
  },
): Promise<string> {
  const run = await requestJson(
    baseUrl,
    "POST",
    "/v1/runs",
    {
      room_id: input.room_id,
      title: input.title,
      input: {
        runtime: {
          egress: {
            action: input.action,
            target_url: input.target_url,
            method: input.method,
          },
        },
      },
    },
    workspaceHeader,
  );
  assert.equal(run.status, 201);
  const runJson = run.json as { run_id: string };
  return runJson.run_id;
}

async function main(): Promise<void> {
  delete process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE;
  process.env.POLICY_ENFORCEMENT_MODE = "enforce";
  delete process.env.EGRESS_MAX_REQUESTS_PER_HOUR;

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
    const workspaceHeader = { "x-workspace-id": "ws_contract_run_worker_egress" };
    const room_id = await createRoom(baseUrl, workspaceHeader);

    const allowRunId = await createRunWithEgress(baseUrl, workspaceHeader, {
      room_id,
      title: "Allow egress run",
      action: "internal.read",
      target_url: "https://example.com/runtime",
      method: "GET",
    });

    const blockedRunId = await createRunWithEgress(baseUrl, workspaceHeader, {
      room_id,
      title: "Blocked egress run",
      action: "external.write",
      target_url: "https://example.net/submit",
      method: "POST",
    });

    const cycle = await runQueuedRunsWorker(pool, {
      workspace_id: workspaceHeader["x-workspace-id"],
      batch_limit: 10,
    });
    assert.equal(cycle.claimed, 2);
    assert.equal(cycle.completed, 1);
    assert.equal(cycle.failed, 1);

    const allowRun = await db.query<{ status: string }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [allowRunId],
    );
    assert.equal(allowRun.rowCount, 1);
    assert.equal(allowRun.rows[0].status, "succeeded");

    const blockedRun = await db.query<{ status: string }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [blockedRunId],
    );
    assert.equal(blockedRun.rowCount, 1);
    assert.equal(blockedRun.rows[0].status, "failed");

    const allowTool = await db.query<{ status: string; tool_name: string }>(
      "SELECT status, tool_name FROM proj_tool_calls WHERE run_id = $1 LIMIT 1",
      [allowRunId],
    );
    assert.equal(allowTool.rowCount, 1);
    assert.equal(allowTool.rows[0].status, "succeeded");
    assert.equal(allowTool.rows[0].tool_name, "egress.request");

    const blockedTool = await db.query<{ status: string; tool_name: string }>(
      "SELECT status, tool_name FROM proj_tool_calls WHERE run_id = $1 LIMIT 1",
      [blockedRunId],
    );
    assert.equal(blockedTool.rowCount, 1);
    assert.equal(blockedTool.rows[0].status, "failed");
    assert.equal(blockedTool.rows[0].tool_name, "egress.request");

    const allowEgressRow = await db.query<{
      policy_decision: string;
      blocked: boolean;
      approval_id: string | null;
      target_domain: string;
    }>(
      `SELECT policy_decision, blocked, approval_id, target_domain
       FROM sec_egress_requests
       WHERE run_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [allowRunId],
    );
    assert.equal(allowEgressRow.rowCount, 1);
    assert.equal(allowEgressRow.rows[0].policy_decision, "allow");
    assert.equal(allowEgressRow.rows[0].blocked, false);
    assert.equal(allowEgressRow.rows[0].approval_id, null);
    assert.equal(allowEgressRow.rows[0].target_domain, "example.com");

    const blockedEgressRow = await db.query<{
      policy_decision: string;
      blocked: boolean;
      approval_id: string | null;
      policy_reason_code: string | null;
      target_domain: string;
    }>(
      `SELECT policy_decision, blocked, approval_id, policy_reason_code, target_domain
       FROM sec_egress_requests
       WHERE run_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [blockedRunId],
    );
    assert.equal(blockedEgressRow.rowCount, 1);
    assert.equal(blockedEgressRow.rows[0].policy_decision, "require_approval");
    assert.equal(blockedEgressRow.rows[0].blocked, true);
    assert.ok(typeof blockedEgressRow.rows[0].approval_id === "string");
    assert.equal(blockedEgressRow.rows[0].policy_reason_code, "external_write_requires_approval");
    assert.equal(blockedEgressRow.rows[0].target_domain, "example.net");

    const allowEvents = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE run_id = $1
         AND event_type IN ('egress.requested', 'egress.allowed')
       ORDER BY occurred_at ASC`,
      [allowRunId],
    );
    assert.equal(allowEvents.rowCount, 2);

    const blockedEvents = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE run_id = $1
         AND event_type IN ('egress.requested', 'egress.blocked')
       ORDER BY occurred_at ASC`,
      [blockedRunId],
    );
    assert.equal(blockedEvents.rowCount, 2);
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
