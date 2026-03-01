import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
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
  return { status: res.status, json: (text.length ? JSON.parse(text) : {}) as T };
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  process.env.PROMOTION_LOOP_ENABLED = "1";

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
    const workspace_id = `ws_contract_promotion_${Date.now()}`;
    const headers = { "x-workspace-id": workspace_id };

    const room = await requestJson<{ room_id: string }>(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Promotion room", room_mode: "default", default_lang: "en" },
      headers,
    );
    assert.equal(room.status, 201);
    const room_id = room.json.room_id;

    const run = await requestJson<{ run_id: string }>(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "promotion run" },
      headers,
    );
    assert.equal(run.status, 201);
    const run_id = run.json.run_id;

    await requestJson(baseUrl, "POST", `/v1/runs/${encodeURIComponent(run_id)}/start`, {}, headers);
    await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${encodeURIComponent(run_id)}/complete`,
      { summary: "done", output: { ok: true } },
      headers,
    );

    const evidence = await requestJson<{ evidence: { evidence_id: string } }>(
      baseUrl,
      "GET",
      `/v1/runs/${encodeURIComponent(run_id)}/evidence`,
      undefined,
      headers,
    );
    assert.equal(evidence.status, 200);
    const evidence_id = evidence.json.evidence.evidence_id;

    const agent = await requestJson<{ agent_id: string }>(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Promotion Agent", actor_type: "service", actor_id: "promotion-agent" },
      headers,
    );
    assert.equal(agent.status, 201);
    const agent_id = agent.json.agent_id;

    for (let i = 0; i < 3; i += 1) {
      const score = await requestJson<{ scorecard_id: string }>(
        baseUrl,
        "POST",
        "/v1/scorecards",
        {
          run_id,
          evidence_id,
          agent_id,
          template_key: "promotion_template",
          template_version: "1.0.0",
          metrics: [{ key: "quality", value: 0.9 }],
        },
        headers,
      );
      assert.equal(score.status, 201);
    }

    for (let i = 0; i < 6; i += 1) {
      const score = await requestJson<{ scorecard_id: string }>(
        baseUrl,
        "POST",
        "/v1/scorecards",
        {
          run_id,
          evidence_id,
          agent_id,
          template_key: "promotion_template",
          template_version: "1.0.0",
          metrics: [{ key: "quality", value: 0.1 }],
        },
        headers,
      );
      assert.equal(score.status, 201);
    }

    const noUpgradeRecommendation = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM sec_autonomy_recommendations
       WHERE workspace_id = $1
         AND agent_id = $2`,
      [workspace_id, agent_id],
    );
    assert.equal(Number(noUpgradeRecommendation.rows[0]?.count ?? "0"), 0);

    const noRevokeApproval = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM proj_approvals
       WHERE workspace_id = $1
         AND action = 'capability.revoke'
         AND context->>'agent_id' = $2`,
      [workspace_id, agent_id],
    );
    assert.equal(Number(noRevokeApproval.rows[0]?.count ?? "0"), 0);

    const notQuarantined = await db.query<{ quarantined_at: string | null }>(
      `SELECT quarantined_at::text AS quarantined_at
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent_id],
    );
    assert.equal(notQuarantined.rowCount, 1);
    assert.equal(notQuarantined.rows[0].quarantined_at, null);

    const status = await requestJson<{
      agent_id: string;
      pass_count: number;
      fail_count: number;
      pending_recommendation: boolean;
      open_loop_incident: boolean;
      pending_revoke_approval: boolean;
      quarantined: boolean;
    }>(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent_id)}/promotion-loop/status`,
      undefined,
      headers,
    );
    assert.equal(status.status, 200);
    assert.equal(status.json.agent_id, agent_id);
    assert.ok(status.json.pass_count >= 3);
    assert.ok(status.json.fail_count >= 6);
    assert.equal(status.json.pending_recommendation, false);
    assert.equal(status.json.open_loop_incident, false);
    assert.equal(status.json.pending_revoke_approval, false);
    assert.equal(status.json.quarantined, false);
  } finally {
    delete process.env.PROMOTION_LOOP_ENABLED;
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
