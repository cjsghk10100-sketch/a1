import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { runLifecycleAutomation } from "../src/lifecycle/automation.js";
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

function addIsoDays(date: string, delta: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + delta * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

async function insertSurvivalRow(
  db: pg.Client,
  input: {
    workspace_id: string;
    target_id: string;
    snapshot_date: string;
    success_count: number;
    failure_count: number;
    repeated_mistakes_count: number;
    survival_score: number;
    budget_utilization: number;
    learning_count: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sec_survival_ledger_daily (
       workspace_id,
       target_type,
       target_id,
       snapshot_date,
       success_count,
       failure_count,
       incident_opened_count,
       incident_closed_count,
       learning_count,
       repeated_mistakes_count,
       egress_requests_count,
       blocked_requests_count,
       estimated_cost_units,
       value_units,
       budget_cap_units,
       budget_utilization,
       survival_score,
       extras,
       created_at,
       updated_at
     ) VALUES (
       $1,'agent',$2,$3::date,$4,$5,0,0,$6,$7,0,0,10,10,100,$8,$9,'{}'::jsonb,$10,$10
     )
     ON CONFLICT (workspace_id, target_type, target_id, snapshot_date)
     DO UPDATE SET
       success_count = EXCLUDED.success_count,
       failure_count = EXCLUDED.failure_count,
       learning_count = EXCLUDED.learning_count,
       repeated_mistakes_count = EXCLUDED.repeated_mistakes_count,
       budget_utilization = EXCLUDED.budget_utilization,
       survival_score = EXCLUDED.survival_score,
       updated_at = EXCLUDED.updated_at`,
    [
      input.workspace_id,
      input.target_id,
      input.snapshot_date,
      input.success_count,
      input.failure_count,
      input.learning_count,
      input.repeated_mistakes_count,
      input.budget_utilization,
      input.survival_score,
      `${input.snapshot_date}T00:00:00.000Z`,
    ],
  );
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
    const workspaceHeader = { "x-workspace-id": "ws_contract_lifecycle" };

    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Lifecycle Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string };

    const day3 = new Date().toISOString().slice(0, 10);
    const day2 = addIsoDays(day3, -1);
    const day1 = addIsoDays(day3, -2);

    await insertSurvivalRow(db, {
      workspace_id: "ws_contract_lifecycle",
      target_id: agent.agent_id,
      snapshot_date: day1,
      success_count: 8,
      failure_count: 1,
      repeated_mistakes_count: 0,
      survival_score: 0.82,
      budget_utilization: 0.42,
      learning_count: 2,
    });
    await insertSurvivalRow(db, {
      workspace_id: "ws_contract_lifecycle",
      target_id: agent.agent_id,
      snapshot_date: day2,
      success_count: 3,
      failure_count: 5,
      repeated_mistakes_count: 2,
      survival_score: 0.45,
      budget_utilization: 0.96,
      learning_count: 1,
    });
    await insertSurvivalRow(db, {
      workspace_id: "ws_contract_lifecycle",
      target_id: agent.agent_id,
      snapshot_date: day3,
      success_count: 1,
      failure_count: 8,
      repeated_mistakes_count: 4,
      survival_score: 0.2,
      budget_utilization: 1.35,
      learning_count: 0,
    });

    const r1 = await runLifecycleAutomation(pool, {
      workspace_id: "ws_contract_lifecycle",
      snapshot_date: day1,
    });
    assert.equal(r1.evaluated_targets, 1);
    assert.equal(r1.state_changes, 1);

    const r2 = await runLifecycleAutomation(pool, {
      workspace_id: "ws_contract_lifecycle",
      snapshot_date: day2,
    });
    assert.equal(r2.evaluated_targets, 1);
    assert.equal(r2.state_changes, 1);

    const r3 = await runLifecycleAutomation(pool, {
      workspace_id: "ws_contract_lifecycle",
      snapshot_date: day3,
    });
    assert.equal(r3.evaluated_targets, 1);
    assert.equal(r3.state_changes, 1);

    const detail = await requestJson(
      baseUrl,
      "GET",
      `/v1/lifecycle/states/agent/${encodeURIComponent(agent.agent_id)}?limit=10`,
      undefined,
      workspaceHeader,
    );
    assert.equal(detail.status, 200);

    const parsed = detail.json as {
      state: {
        current_state: string;
        recommended_state: string;
        consecutive_risky_days: number;
        last_snapshot_date: string;
      };
      transitions: Array<{
        from_state: string | null;
        to_state: string;
        snapshot_date: string;
      }>;
    };

    assert.equal(parsed.state.current_state, "sunset");
    assert.equal(parsed.state.recommended_state, "sunset");
    assert.equal(parsed.state.last_snapshot_date, day3);
    assert.ok(parsed.state.consecutive_risky_days >= 2);
    assert.ok(parsed.transitions.length >= 3);
    assert.ok(
      parsed.transitions.some((t) => t.from_state === "active" && t.to_state === "probation"),
    );
    assert.ok(
      parsed.transitions.some((t) => t.from_state === "probation" && t.to_state === "sunset"),
    );

    const rerun = await runLifecycleAutomation(pool, {
      workspace_id: "ws_contract_lifecycle",
      snapshot_date: day3,
    });
    assert.equal(rerun.state_changes, 0);

    const lifecycleEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'lifecycle.state.changed'
         AND data->>'target_id' = $2`,
      ["ws_contract_lifecycle", agent.agent_id],
    );
    assert.ok(Number.parseInt(lifecycleEvents.rows[0].count, 10) >= 3);
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
