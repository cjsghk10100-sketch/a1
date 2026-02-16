import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { runDailySnapshotJob } from "../src/snapshots/daily.js";

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
  delete process.env.POLICY_ENFORCEMENT_MODE;

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
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Snapshot Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string; principal_id: string };

    const trustSeed = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/trust`,
      undefined,
      workspaceHeader,
    );
    assert.equal(trustSeed.status, 200);

    const skillCatalog = await requestJson(
      baseUrl,
      "POST",
      "/v1/skills/catalog",
      {
        skill_id: "snapshot.skill",
        name: "Snapshot Skill",
        skill_type: "workflow",
        risk_class: "low",
      },
      workspaceHeader,
    );
    assert.equal(skillCatalog.status, 201);

    const learned = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/skills/learn`,
      { skill_id: "snapshot.skill", level: 2, set_primary: true },
      workspaceHeader,
    );
    assert.equal(learned.status, 201);

    const room = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Snapshot Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(room.status, 201);
    const room_id = (room.json as { room_id: string }).room_id;

    const egressPayload = {
      action: "external.write",
      target_url: "https://example.org/snapshot",
      method: "POST",
      room_id,
      principal_id: agent.principal_id,
    };

    const denied1 = await requestJson(baseUrl, "POST", "/v1/egress/requests", egressPayload, workspaceHeader);
    assert.equal(denied1.status, 201);
    const denied2 = await requestJson(baseUrl, "POST", "/v1/egress/requests", egressPayload, workspaceHeader);
    assert.equal(denied2.status, 201);

    const snapshot_date = new Date().toISOString().slice(0, 10);

    const firstRun = await runDailySnapshotJob(pool, {
      workspace_id: "ws_contract",
      snapshot_date,
    });
    assert.equal(firstRun.workspace_id, "ws_contract");
    assert.equal(firstRun.snapshot_date, snapshot_date);
    assert.ok(firstRun.scanned_agents >= 1);
    assert.ok(firstRun.written_rows >= 1);

    const read = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/snapshots?days=7`,
      undefined,
      workspaceHeader,
    );
    assert.equal(read.status, 200);
    const snapshots = read.json as {
      snapshots: Array<{
        snapshot_date: string;
        trust_score: number;
        autonomy_rate_7d: number;
        new_skills_learned_7d: number;
        constraints_learned_7d: number;
        repeated_mistakes_7d: number;
      }>;
    };
    assert.ok(snapshots.snapshots.length >= 1);
    const latest = snapshots.snapshots[0];
    assert.equal(latest.snapshot_date, snapshot_date);
    assert.ok(latest.trust_score >= 0 && latest.trust_score <= 1);
    assert.ok(latest.autonomy_rate_7d >= 0 && latest.autonomy_rate_7d <= 1);
    assert.ok(latest.new_skills_learned_7d >= 1);
    assert.ok(latest.constraints_learned_7d >= 1);
    assert.ok(latest.repeated_mistakes_7d >= 1);

    const secondRun = await runDailySnapshotJob(pool, {
      workspace_id: "ws_contract",
      snapshot_date,
    });
    assert.equal(secondRun.written_rows, 0);

    const snapshotEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE event_type = 'daily.agent.snapshot'
         AND workspace_id = $1
         AND data->>'agent_id' = $2
         AND data->>'snapshot_date' = $3`,
      ["ws_contract", agent.agent_id, snapshot_date],
    );
    assert.equal(Number.parseInt(snapshotEvents.rows[0].count, 10), 1);
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
