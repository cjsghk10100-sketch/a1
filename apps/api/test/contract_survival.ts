import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { runDailySurvivalRollup } from "../src/survival/daily.js";

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

  const workspaceHeader = { "x-workspace-id": "ws_contract_survival" };

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Survival Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string; principal_id: string };

    const room = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Survival Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(room.status, 201);
    const room_id = (room.json as { room_id: string }).room_id;

    const runSucceeded = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "Survival Success Run" },
      workspaceHeader,
    );
    assert.equal(runSucceeded.status, 201);
    const run_id_ok = (runSucceeded.json as { run_id: string }).run_id;

    const startOk = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id_ok}/start`,
      {},
      workspaceHeader,
    );
    assert.equal(startOk.status, 200);

    const completeOk = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id_ok}/complete`,
      { summary: "completed", output: { ok: true } },
      workspaceHeader,
    );
    assert.equal(completeOk.status, 200);

    const runFailed = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "Survival Failed Run" },
      workspaceHeader,
    );
    assert.equal(runFailed.status, 201);
    const run_id_fail = (runFailed.json as { run_id: string }).run_id;

    const startFail = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id_fail}/start`,
      {},
      workspaceHeader,
    );
    assert.equal(startFail.status, 200);

    const failRun = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id_fail}/fail`,
      { message: "simulated failure", error: { code: "E_TIMEOUT" } },
      workspaceHeader,
    );
    assert.equal(failRun.status, 200);

    const incidentCreate = await requestJson(
      baseUrl,
      "POST",
      "/v1/incidents",
      {
        room_id,
        run_id: run_id_fail,
        title: "Failure incident",
        summary: "run failed in contract test",
        severity: "medium",
      },
      workspaceHeader,
    );
    assert.equal(incidentCreate.status, 201);
    const incident_id = (incidentCreate.json as { incident_id: string }).incident_id;

    const rca = await requestJson(
      baseUrl,
      "POST",
      `/v1/incidents/${incident_id}/rca`,
      { summary: "retry policy missing" },
      workspaceHeader,
    );
    assert.equal(rca.status, 200);

    const learning = await requestJson(
      baseUrl,
      "POST",
      `/v1/incidents/${incident_id}/learning`,
      { note: "add bounded retry and fallback" },
      workspaceHeader,
    );
    assert.equal(learning.status, 201);

    const close = await requestJson(
      baseUrl,
      "POST",
      `/v1/incidents/${incident_id}/close`,
      { reason: "actions captured" },
      workspaceHeader,
    );
    assert.equal(close.status, 200);

    const egressPayload = {
      action: "external.write",
      target_url: "https://example.org/survival",
      method: "POST",
      room_id,
      principal_id: agent.principal_id,
    };

    const eg1 = await requestJson(baseUrl, "POST", "/v1/egress/requests", egressPayload, workspaceHeader);
    assert.equal(eg1.status, 201);
    const eg2 = await requestJson(baseUrl, "POST", "/v1/egress/requests", egressPayload, workspaceHeader);
    assert.equal(eg2.status, 201);

    const snapshot_date = new Date().toISOString().slice(0, 10);

    const first = await runDailySurvivalRollup(pool, {
      workspace_id: "ws_contract_survival",
      snapshot_date,
    });
    assert.equal(first.workspace_id, "ws_contract_survival");
    assert.equal(first.snapshot_date, snapshot_date);
    assert.ok(first.scanned_targets >= 2);
    assert.ok(first.written_rows >= 2);

    const workspaceLedger = await requestJson(
      baseUrl,
      "GET",
      `/v1/survival/ledger/workspace/ws_contract_survival?days=7`,
      undefined,
      workspaceHeader,
    );
    assert.equal(workspaceLedger.status, 200);
    const wsRows = workspaceLedger.json as {
      ledgers: Array<{
        target_type: string;
        target_id: string;
        run_succeeded?: number;
        success_count: number;
        failure_count: number;
        incident_closed_count: number;
        learning_count: number;
        egress_requests_count: number;
        survival_score: number;
      }>;
    };
    assert.ok(wsRows.ledgers.length >= 1);
    const wsLatest = wsRows.ledgers[0];
    assert.equal(wsLatest.target_type, "workspace");
    assert.equal(wsLatest.target_id, "ws_contract_survival");
    assert.ok(wsLatest.success_count >= 1);
    assert.ok(wsLatest.failure_count >= 1);
    assert.ok(wsLatest.incident_closed_count >= 1);
    assert.ok(wsLatest.learning_count >= 1);
    assert.ok(wsLatest.egress_requests_count >= 2);
    assert.ok(wsLatest.survival_score >= 0 && wsLatest.survival_score <= 1);

    const agentLedger = await requestJson(
      baseUrl,
      "GET",
      `/v1/survival/ledger/agent/${encodeURIComponent(agent.agent_id)}?days=7`,
      undefined,
      workspaceHeader,
    );
    assert.equal(agentLedger.status, 200);
    const agRows = agentLedger.json as {
      ledgers: Array<{
        target_type: string;
        target_id: string;
        egress_requests_count: number;
        survival_score: number;
      }>;
    };
    assert.ok(agRows.ledgers.length >= 1);
    assert.equal(agRows.ledgers[0].target_type, "agent");
    assert.equal(agRows.ledgers[0].target_id, agent.agent_id);
    assert.ok(agRows.ledgers[0].egress_requests_count >= 2);
    assert.ok(agRows.ledgers[0].survival_score >= 0 && agRows.ledgers[0].survival_score <= 1);

    const second = await runDailySurvivalRollup(pool, {
      workspace_id: "ws_contract_survival",
      snapshot_date,
    });
    assert.equal(second.written_rows, 0);

    const rollupEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE event_type = 'survival.ledger.rolled_up'
         AND workspace_id = $1
         AND data->>'snapshot_date' = $2`,
      ["ws_contract_survival", snapshot_date],
    );
    assert.ok(Number.parseInt(rollupEvents.rows[0].count, 10) >= 2);
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
