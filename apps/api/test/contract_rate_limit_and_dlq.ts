import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { recordMessageProcessingFailure } from "../src/dlq/poisonMessageDlq.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type JsonResponse = {
  status: number;
  json: unknown;
  text: string;
};

type ContractErrorJson = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
};

const RUN_SUFFIX = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const WORKSPACE_BASE = `ws_contract_ratelimit_dlq_${RUN_SUFFIX}`;
const AGENT_ID = `agt_ratelimit_dlq_${RUN_SUFFIX}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeDatabaseUrl(databaseUrl: string): void {
  if (
    !databaseUrl.includes("test") &&
    !databaseUrl.includes("local") &&
    !databaseUrl.includes("127.0.0.1") &&
    !databaseUrl.includes("localhost")
  ) {
    throw new Error("DATABASE_URL does not look like a test DB");
  }
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

async function postJson(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}

function assertContractError(json: unknown, reason_code: string): ContractErrorJson {
  const payload = json as ContractErrorJson;
  assert.equal(payload.error, true);
  assert.equal(payload.reason_code, reason_code);
  assert.equal(typeof payload.reason, "string");
  assert.equal(typeof payload.details, "object");
  return payload;
}

async function ensureAuthenticatedAgent(db: InstanceType<typeof Client>, agent_id: string): Promise<string> {
  const principal = await db.query<{ principal_id: string }>(
    `SELECT principal_id
     FROM sec_principals
     WHERE legacy_actor_type = 'user'
       AND legacy_actor_id = 'legacy_header'
     LIMIT 1`,
  );
  assert.equal(principal.rowCount, 1);
  const principal_id = principal.rows[0].principal_id;

  const existing = await db.query<{ agent_id: string }>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
     LIMIT 1`,
    [principal_id],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0].agent_id;
  }

  await db.query(
    `INSERT INTO sec_agents (agent_id, principal_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (principal_id) DO NOTHING`,
    [agent_id, principal_id, "RateLimit Contract Agent"],
  );
  return agent_id;
}

async function resetRateLimitState(db: InstanceType<typeof Client>, workspaceBase: string): Promise<void> {
  await db.query("DELETE FROM rate_limit_buckets");
  await db.query("DELETE FROM rate_limit_streaks WHERE workspace_id LIKE $1", [`${workspaceBase}%`]);
}

function msgBody(input: {
  from_agent_id: string;
  idempotency_key: string;
  intent?: string;
  workspace_id?: string;
  experiment_id?: string;
}): Record<string, unknown> {
  return {
    schema_version: "2.1",
    from_agent_id: input.from_agent_id,
    workspace_id: input.workspace_id,
    idempotency_key: input.idempotency_key,
    intent: input.intent ?? "message",
    payload: {
      text: `msg:${input.idempotency_key}`,
      ...(input.experiment_id ? { experiment_id: input.experiment_id } : {}),
    },
  };
}

async function waitForMinuteBoundaryGuard(db: InstanceType<typeof Client>): Promise<void> {
  const sec = await db.query<{ seconds_to_minute_end: string }>(
    `SELECT
       EXTRACT(EPOCH FROM (date_trunc('minute', now()) + interval '1 minute' - now()))::int::text
         AS seconds_to_minute_end`,
  );
  const remaining = Number.parseInt(sec.rows[0]?.seconds_to_minute_end ?? "0", 10);
  if (remaining < 2) {
    await sleep(2_000);
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertSafeDatabaseUrl(databaseUrl);

  process.env.MESSAGES_RATE_LIMIT_AGENT_PER_MIN = "2";
  process.env.MESSAGES_RATE_LIMIT_AGENT_PER_HOUR = "20";
  process.env.MESSAGES_RATE_LIMIT_EXPERIMENT_PER_HOUR = "20";
  process.env.MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN = "20";
  process.env.MESSAGES_HEARTBEAT_LIMIT_PER_MIN = "10";
  process.env.RATE_LIMIT_STREAK_THRESHOLD = "3";
  process.env.RATE_LIMIT_INCIDENT_MUTE_SEC = "3600";

  await applyMigrations(databaseUrl);
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
    const agentId = await ensureAuthenticatedAgent(db, AGENT_ID);
    await waitForMinuteBoundaryGuard(db);

    // T1 Non-heartbeat agent_per_min limit => 429 rate_limited
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      const workspace = `${WORKSPACE_BASE}_t1`;
      const headers = { "x-workspace-id": workspace };
      const first = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t1:1:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(first.status, 201, first.text);
      await sleep(10);

      const second = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t1:2:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(second.status, 201, second.text);
      await sleep(10);

      const third = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t1:3:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(third.status, 429, third.text);
      assertContractError(third.json, "rate_limited");
    }

    // T1b Idempotent replay must bypass rate limit and return duplicate replay
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      process.env.MESSAGES_RATE_LIMIT_AGENT_PER_MIN = "1";
      process.env.MESSAGES_RATE_LIMIT_AGENT_PER_HOUR = "20";
      process.env.MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN = "20";

      const workspace = `${WORKSPACE_BASE}_t1b`;
      const headers = { "x-workspace-id": workspace };
      const idempotency_key = `t1b:stable:${RUN_SUFFIX}`;

      const first = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key,
        }),
        headers,
      );
      assert.equal(first.status, 201, first.text);

      const replay = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key,
        }),
        headers,
      );
      assert.equal(replay.status, 200, replay.text);
      const replayJson = replay.json as { idempotent_replay: boolean; reason_code?: string };
      assert.equal(replayJson.idempotent_replay, true);
      assert.equal(replayJson.reason_code, "duplicate_idempotent_replay");

      const blocked = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t1b:new:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(blocked.status, 429, blocked.text);
      assertContractError(blocked.json, "rate_limited");
    }

    // T2 Heartbeat rules
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      const workspace = `${WORKSPACE_BASE}_t2`;
      const headers = { "x-workspace-id": workspace };

      process.env.MESSAGES_RATE_LIMIT_AGENT_PER_MIN = "1";
      process.env.MESSAGES_HEARTBEAT_LIMIT_PER_MIN = "10";
      process.env.MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN = "2";

      const hb1 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t2:hb:1:${RUN_SUFFIX}`,
          intent: "heartbeat",
        }),
        headers,
      );
      assert.equal(hb1.status, 201, hb1.text);
      await sleep(10);

      const hb2 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t2:hb:2:${RUN_SUFFIX}`,
          intent: "heartbeat",
        }),
        headers,
      );
      assert.equal(hb2.status, 201, hb2.text);
      await sleep(10);

      const hb3 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t2:hb:3:${RUN_SUFFIX}`,
          intent: "heartbeat",
        }),
        headers,
      );
      assert.equal(hb3.status, 429, hb3.text);
      const hb3Err = assertContractError(hb3.json, "rate_limited");
      assert.equal(hb3Err.details.scope, "global_per_min");

      process.env.MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN = "50";
      process.env.MESSAGES_HEARTBEAT_LIMIT_PER_MIN = "1";

      const hb4 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t2:hb:4:${RUN_SUFFIX}`,
          intent: "heartbeat",
        }),
        headers,
      );
      assert.equal(hb4.status, 429, hb4.text);
      const hb4Err = assertContractError(hb4.json, "rate_limited");
      assert.equal(hb4Err.details.scope, "hb_per_agent_per_min");

      const regular = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t2:msg:1:${RUN_SUFFIX}`,
          intent: "message",
        }),
        headers,
      );
      assert.equal(regular.status, 201, regular.text);
    }

    // reset defaults for remaining tests
    process.env.MESSAGES_RATE_LIMIT_AGENT_PER_MIN = "2";
    process.env.MESSAGES_HEARTBEAT_LIMIT_PER_MIN = "10";
    process.env.MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN = "20";

    // T3 3 consecutive 429 => one agent_flooding incident emitted (muted + idempotent)
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      const workspace = `${WORKSPACE_BASE}_t3`;
      const headers = { "x-workspace-id": workspace };

      const seed = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t3:seed:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(seed.status, 201, seed.text);
      await sleep(10);

      const exceed1 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t3:429:1:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(exceed1.status, 201, exceed1.text);
      await sleep(10);

      const exceed2 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t3:429:2:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(exceed2.status, 429, exceed2.text);
      await sleep(10);

      const exceed3 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t3:429:3:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(exceed3.status, 429, exceed3.text);
      await sleep(10);

      const exceed4 = await postJson(
        baseUrl,
        "/v1/messages",
        msgBody({
          from_agent_id: agentId,
          idempotency_key: `t3:429:4:${RUN_SUFFIX}`,
        }),
        headers,
      );
      assert.equal(exceed4.status, 429, exceed4.text);

      const incidents = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'incident.opened'
           AND data->>'category' = 'agent_flooding'`,
        [workspace],
      );
      assert.equal(Number.parseInt(incidents.rows[0]?.count ?? "0", 10), 1);
    }

    // T4 + T5 DLQ trigger + idempotency
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      const workspace = `${WORKSPACE_BASE}_t4`;
      const message_id = `msg_poison_${RUN_SUFFIX}`;

      await recordMessageProcessingFailure(pool, {
        workspace_id: workspace,
        message_id,
        last_error: "failure-1",
        source_intent: "message",
      });
      await recordMessageProcessingFailure(pool, {
        workspace_id: workspace,
        message_id,
        last_error: "failure-2",
        source_intent: "message",
      });
      const third = await recordMessageProcessingFailure(pool, {
        workspace_id: workspace,
        message_id,
        last_error: "failure-3",
        source_intent: "message",
      });
      assert.equal(third.moved_to_dlq, true);

      const dlqRow = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM dead_letter_messages
         WHERE workspace_id = $1
           AND message_id = $2`,
        [workspace, message_id],
      );
      assert.equal(Number.parseInt(dlqRow.rows[0]?.count ?? "0", 10), 1);

      const poisonIncident = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'incident.opened'
           AND data->>'category' = 'poison_message'
           AND data->>'message_id' = $2`,
        [workspace, message_id],
      );
      assert.equal(Number.parseInt(poisonIncident.rows[0]?.count ?? "0", 10), 1);

      const humanDecision = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'message.created'
           AND data->>'intent' = 'request_human_decision'
           AND data#>>'{payload,source_message_id}' = $2`,
        [workspace, message_id],
      );
      assert.equal(Number.parseInt(humanDecision.rows[0]?.count ?? "0", 10), 1);

      await recordMessageProcessingFailure(pool, {
        workspace_id: workspace,
        message_id,
        last_error: "failure-4",
        source_intent: "message",
      });

      const dlqRowsAfter4th = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM dead_letter_messages
         WHERE workspace_id = $1
           AND message_id = $2`,
        [workspace, message_id],
      );
      assert.equal(Number.parseInt(dlqRowsAfter4th.rows[0]?.count ?? "0", 10), 1);

      const poisonIncidentAfter4th = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND idempotency_key = $2`,
        [workspace, `incident:poison_message:${workspace}:${message_id}`],
      );
      assert.equal(Number.parseInt(poisonIncidentAfter4th.rows[0]?.count ?? "0", 10), 1);
    }

    // T6 Workspace isolation for DLQ rows
    {
      await resetRateLimitState(db, WORKSPACE_BASE);
      const message_id = `msg_shared_${RUN_SUFFIX}`;
      const wsA = `${WORKSPACE_BASE}_t6_a`;
      const wsB = `${WORKSPACE_BASE}_t6_b`;

      for (let i = 0; i < 3; i += 1) {
        await recordMessageProcessingFailure(pool, {
          workspace_id: wsA,
          message_id,
          last_error: `wsA-failure-${i + 1}`,
          source_intent: "message",
        });
        await recordMessageProcessingFailure(pool, {
          workspace_id: wsB,
          message_id,
          last_error: `wsB-failure-${i + 1}`,
          source_intent: "message",
        });
      }

      const rows = await db.query<{ workspace_id: string }>(
        `SELECT workspace_id
         FROM dead_letter_messages
         WHERE message_id = $1
         ORDER BY workspace_id ASC`,
        [message_id],
      );
      assert.deepEqual(rows.rows.map((r) => r.workspace_id), [wsA, wsB]);
    }
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
