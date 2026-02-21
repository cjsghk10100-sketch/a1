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
      // Keep the contract re-runnable against shared local DBs without cleanup.
      const workspaceId = `ws_contract_learning_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const workspaceHeader = { "x-workspace-id": workspaceId };

    const room = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Learning Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const payload = {
      action: "external.write",
      actor_type: "user",
      actor_id: "ceo",
      room_id: room.room_id,
      context: {
        request_id: "req-1",
        api_key: "sk-live-test-secret-12345",
        note: "this should be redacted in learned constraints",
      },
    };

    const first = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      payload,
      workspaceHeader,
    );
    assert.equal(first.decision, "require_approval");
    assert.equal(first.reason_code, "external_write_requires_approval");

    const second = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      payload,
      workspaceHeader,
    );
    assert.equal(second.decision, "require_approval");
    assert.equal(second.reason_code, "external_write_requires_approval");

      const constraint = await db.query<{
        constraint_id: string;
        seen_count: number;
        reason_code: string;
        category: string;
      pattern: string;
      guidance: string;
    }>(
      `SELECT constraint_id, seen_count, reason_code, category, pattern, guidance
      FROM sec_constraints
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [workspaceId],
    );
    assert.equal(constraint.rowCount, 1);
    assert.equal(constraint.rows[0].seen_count, 2);
    assert.equal(constraint.rows[0].reason_code, "external_write_requires_approval");
    assert.equal(constraint.rows[0].category, "action");
    assert.ok(constraint.rows[0].guidance.length > 0);
    assert.ok(!constraint.rows[0].pattern.includes("sk-live-test-secret-12345"));
    assert.ok(constraint.rows[0].pattern.includes("REDACTED"));

    const learningCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE event_type = 'learning.from_failure'
         AND workspace_id = $1
         AND room_id = $2`,
      [workspaceId, room.room_id],
    );
    assert.equal(Number.parseInt(learningCount.rows[0].count, 10), 2);

    const learnedCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE event_type = 'constraint.learned'
         AND workspace_id = $1
         AND room_id = $2`,
      [workspaceId, room.room_id],
    );
    assert.equal(Number.parseInt(learnedCount.rows[0].count, 10), 2);

    const repeated = await db.query<{
      repeat_count: string | null;
      reason_code: string | null;
    }>(
      `SELECT
         data->>'repeat_count' AS repeat_count,
         data->>'reason_code' AS reason_code
       FROM evt_events
       WHERE event_type = 'mistake.repeated'
         AND workspace_id = $1
         AND room_id = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [workspaceId, room.room_id],
    );
    assert.equal(repeated.rowCount, 1);
    assert.equal(repeated.rows[0].repeat_count, "2");
    assert.equal(repeated.rows[0].reason_code, "external_write_requires_approval");

    const counters = await db.query<{ seen_count: number; reason_code: string }>(
      `SELECT seen_count, reason_code
       FROM sec_mistake_counters
       WHERE workspace_id = $1
       ORDER BY last_seen_at DESC
       LIMIT 1`,
      [workspaceId],
    );
    assert.equal(counters.rowCount, 1);
    assert.equal(counters.rows[0].seen_count, 2);
    assert.equal(counters.rows[0].reason_code, "external_write_requires_approval");

    const agent = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Learning Agent" },
      workspaceHeader,
    );

    const egressPayload = {
      action: "external.write",
      actor_type: "service",
      actor_id: "agent-runner",
      principal_id: agent.principal_id,
      room_id: room.room_id,
      target_url: "https://example.com/write",
      context: {
        request_id: "eg-1",
        note: "auto quarantine trigger",
      },
    };

    for (let i = 0; i < 3; i += 1) {
      const egressDecision = await postJson<{ decision: string; reason_code: string }>(
        baseUrl,
        "/v1/egress/requests",
        egressPayload,
        workspaceHeader,
      );
      assert.equal(egressDecision.decision, "require_approval");
      assert.equal(egressDecision.reason_code, "external_write_requires_approval");
    }

    const quarantined = await db.query<{
      quarantined_at: string | null;
      quarantine_reason: string | null;
    }>(
      `SELECT quarantined_at::text AS quarantined_at, quarantine_reason
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent.agent_id],
    );
    assert.equal(quarantined.rowCount, 1);
    assert.ok(quarantined.rows[0].quarantined_at);
    assert.equal(quarantined.rows[0].quarantine_reason, "auto_repeated_external_write_requires_approval");

    const quarantineEvent = await db.query<{
      mode: string | null;
      repeat_count: string | null;
      trigger_reason_code: string | null;
    }>(
      `SELECT
         data->>'mode' AS mode,
         data->>'repeat_count' AS repeat_count,
         data->>'trigger_reason_code' AS trigger_reason_code
       FROM evt_events
       WHERE event_type = 'agent.quarantined'
         AND workspace_id = $1
         AND data->>'agent_id' = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [workspaceId, agent.agent_id],
    );
    assert.equal(quarantineEvent.rowCount, 1);
    assert.equal(quarantineEvent.rows[0].mode, "auto");
    assert.equal(quarantineEvent.rows[0].repeat_count, "3");
    assert.equal(quarantineEvent.rows[0].trigger_reason_code, "external_write_requires_approval");
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
