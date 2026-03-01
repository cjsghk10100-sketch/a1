import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function main(): Promise<void> {
  delete process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE;
  process.env.POLICY_ENFORCEMENT_MODE = "enforce";

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
    const workspaceHeader = { "x-workspace-id": `ws_contract_run_worker_tool_policy_${Date.now()}` };

    const room = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Worker Tool Policy Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(room.status, 201);
    const room_id = (room.json as { room_id: string }).room_id;

    const principal_id = randomUUID();
    const grantor_id = randomUUID();
    await db.query(
      `INSERT INTO sec_principals (principal_id, principal_type)
       VALUES ($1, 'agent'), ($2, 'user')`,
      [principal_id, grantor_id],
    );

    const tokenRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/capabilities/grant",
      {
        issued_to_principal_id: principal_id,
        granted_by_principal_id: grantor_id,
        scopes: {
          rooms: [room_id],
          tools: ["contract.echo"],
        },
      },
      workspaceHeader,
    );
    assert.equal(tokenRes.status, 201);
    const capability_token_id = (tokenRes.json as { token_id: string }).token_id;

    const experimentRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/experiments",
      {
        room_id,
        title: "Worker Tool Policy Experiment",
        hypothesis: "policy guard",
        success_criteria: { ok: true },
        stop_conditions: { stop: false },
        budget_cap_units: 1,
        risk_tier: "high",
      },
      workspaceHeader,
    );
    assert.equal(experimentRes.status, 201);
    const experiment_id = (experimentRes.json as { experiment_id: string }).experiment_id;

    const runRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs",
      {
        room_id,
        experiment_id,
        title: "Policy blocked worker run",
        input: {
          runtime: {
            policy: {
              principal_id,
              capability_token_id,
              zone: "sandbox",
            },
          },
        },
      },
      workspaceHeader,
    );
    assert.equal(runRes.status, 201);
    const run_id = (runRes.json as { run_id: string }).run_id;

    const cycle = await runQueuedRunsWorker(pool, {
      workspace_id: workspaceHeader["x-workspace-id"],
      batch_limit: 10,
    });
    assert.equal(cycle.claimed, 1);
    assert.equal(cycle.completed, 0);
    assert.equal(cycle.failed, 1);

    const runRow = await db.query<{ status: string; error: Record<string, unknown> }>(
      `SELECT status, error
       FROM proj_runs
       WHERE run_id = $1`,
      [run_id],
    );
    assert.equal(runRow.rowCount, 1);
    assert.equal(runRow.rows[0].status, "failed");
    assert.equal(String(runRow.rows[0].error.stage ?? ""), "tool_policy");
    assert.equal(String(runRow.rows[0].error.reason_code ?? ""), "capability_scope_tool_not_allowed");

    const toolRow = await db.query<{ status: string; tool_name: string }>(
      `SELECT status, tool_name
       FROM proj_tool_calls
       WHERE run_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [run_id],
    );
    assert.equal(toolRow.rowCount, 1);
    assert.equal(toolRow.rows[0].status, "failed");
    assert.equal(toolRow.rows[0].tool_name, "runtime.noop");

    const deniedEvent = await db.query<{ reason_code: string | null }>(
      `SELECT data->>'reason_code' AS reason_code
       FROM evt_events
       WHERE workspace_id = $1
         AND run_id = $2
         AND event_type = 'policy.denied'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [workspaceHeader["x-workspace-id"], run_id],
    );
    assert.equal(deniedEvent.rowCount, 1);
    assert.equal(deniedEvent.rows[0].reason_code, "capability_scope_tool_not_allowed");

    const automationIncident = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'incident.opened'
         AND idempotency_key = $2`,
      [workspaceHeader["x-workspace-id"], `incident:run_failed:${workspaceHeader["x-workspace-id"]}:${run_id}`],
    );
    assert.equal(Number.parseInt(automationIncident.rows[0].count, 10), 1);

    const automationEscalation = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'message.created'
         AND idempotency_key = $2`,
      [
        workspaceHeader["x-workspace-id"],
        `message:request_human_decision:run_failed:${workspaceHeader["x-workspace-id"]}:${run_id}`,
      ],
    );
    assert.equal(Number.parseInt(automationEscalation.rows[0].count, 10), 1);
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
