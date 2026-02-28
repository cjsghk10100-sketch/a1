import { randomUUID } from "node:crypto";

import { newIncidentId } from "@agentapp/shared";

import {
  ContractViolationError,
  type ContractReasonCode,
} from "../contracts/pipeline_v2_contract.js";
import {
  MESSAGES_HEARTBEAT_LIMIT_PER_MIN,
  MESSAGES_RATE_LIMIT_AGENT_PER_HOUR,
  MESSAGES_RATE_LIMIT_AGENT_PER_MIN,
  MESSAGES_RATE_LIMIT_EXPERIMENT_PER_HOUR,
  MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN,
  RATE_LIMIT_INCIDENT_MUTE_SEC,
  RATE_LIMIT_SCOPE_MESSAGES,
  RATE_LIMIT_STREAK_THRESHOLD,
} from "../config.js";
import type { DbClient, DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

type RateLimitScope =
  | "hb_per_agent_per_min"
  | "global_per_min"
  | "agent_per_min"
  | "agent_per_hour"
  | "experiment_per_hour";

type RateLimitRule = {
  scope: RateLimitScope;
  bucket_key: string;
  limit: number;
  window_sec: number;
};

type IncrementResult = {
  count: number;
  retry_after_sec: number;
  server_time: string;
};

type StreakUpdateResult = {
  consecutive_429: number;
  should_emit_incident: boolean;
  server_time: string;
};

type RateLimitConfig = {
  agent_per_min: number;
  agent_per_hour: number;
  experiment_per_hour: number;
  global_per_min: number;
  hb_per_agent_per_min: number;
  streak_threshold: number;
  incident_mute_sec: number;
  scope_messages: string;
};

type EnforceParams = {
  workspace_id: string;
  agent_id: string;
  intent: string;
  experiment_id?: string | null;
  correlation_id?: string;
};

type EnforceOk = {
  allowed: true;
  server_time: string;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readRateLimitConfig(): RateLimitConfig {
  return {
    agent_per_min: parsePositiveIntEnv("MESSAGES_RATE_LIMIT_AGENT_PER_MIN", MESSAGES_RATE_LIMIT_AGENT_PER_MIN),
    agent_per_hour: parsePositiveIntEnv(
      "MESSAGES_RATE_LIMIT_AGENT_PER_HOUR",
      MESSAGES_RATE_LIMIT_AGENT_PER_HOUR,
    ),
    experiment_per_hour: parsePositiveIntEnv(
      "MESSAGES_RATE_LIMIT_EXPERIMENT_PER_HOUR",
      MESSAGES_RATE_LIMIT_EXPERIMENT_PER_HOUR,
    ),
    global_per_min: parsePositiveIntEnv("MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN", MESSAGES_RATE_LIMIT_GLOBAL_PER_MIN),
    hb_per_agent_per_min: parsePositiveIntEnv(
      "MESSAGES_HEARTBEAT_LIMIT_PER_MIN",
      MESSAGES_HEARTBEAT_LIMIT_PER_MIN,
    ),
    streak_threshold: parsePositiveIntEnv("RATE_LIMIT_STREAK_THRESHOLD", RATE_LIMIT_STREAK_THRESHOLD),
    incident_mute_sec: parsePositiveIntEnv("RATE_LIMIT_INCIDENT_MUTE_SEC", RATE_LIMIT_INCIDENT_MUTE_SEC),
    scope_messages: process.env.RATE_LIMIT_SCOPE_MESSAGES?.trim() || RATE_LIMIT_SCOPE_MESSAGES,
  };
}

function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code !== "23505") return false;
  return typeof pgErr.constraint === "string" && pgErr.constraint.includes("idempotency");
}

async function appendWithIdempotencyReplayTx(
  pool: DbPool,
  client: DbClient,
  event: Parameters<typeof appendToStream>[1],
): Promise<"emitted" | "replayed"> {
  await client.query("SAVEPOINT rl_emit_sp");
  try {
    await appendToStream(pool, event, client);
    await client.query("RELEASE SAVEPOINT rl_emit_sp");
    return "emitted";
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT rl_emit_sp");
    await client.query("RELEASE SAVEPOINT rl_emit_sp");
    if (isIdempotencyUniqueViolation(err)) {
      return "replayed";
    }
    throw err;
  }
}

async function incrementBucketTx(
  client: DbClient,
  input: { bucket_key: string; window_sec: number },
): Promise<IncrementResult> {
  const res = await client.query<{
    count: string;
    retry_after_sec: string;
    server_time: string;
  }>(
    `WITH t AS (
       SELECT
         (now() AT TIME ZONE 'UTC') AS now_utc,
         clock_timestamp() AS wall_clock
     ),
     w AS (
       SELECT
         to_timestamp(floor(extract(epoch FROM t.now_utc) / $2) * $2) AS window_start
       FROM t
     )
     INSERT INTO rate_limit_buckets (
       bucket_key,
       window_start,
       window_sec,
       count,
       updated_at
     )
     SELECT
       $1,
       w.window_start,
       $2,
       1,
       (SELECT wall_clock FROM t)
     FROM w
     ON CONFLICT (bucket_key, window_start, window_sec)
     DO UPDATE SET
       count = rate_limit_buckets.count + 1,
       updated_at = (SELECT wall_clock FROM t)
     RETURNING
       count::text AS count,
       GREATEST(
         EXTRACT(EPOCH FROM (window_start + (window_sec || ' seconds')::interval - (SELECT wall_clock FROM t)))::INT,
         0
       )::text AS retry_after_sec,
       (SELECT wall_clock::text FROM t) AS server_time`,
    [input.bucket_key, input.window_sec],
  );

  return {
    count: Number.parseInt(res.rows[0]?.count ?? "0", 10),
    retry_after_sec: Number.parseInt(res.rows[0]?.retry_after_sec ?? "0", 10),
    server_time: res.rows[0]?.server_time ?? "",
  };
}

async function bumpRateLimitStreakTx(
  client: DbClient,
  input: {
    workspace_id: string;
    agent_id: string;
    scope: string;
    incident_mute_sec: number;
  },
): Promise<StreakUpdateResult> {
  const res = await client.query<{
    consecutive_429: string;
    should_emit_incident: boolean;
    server_time: string;
  }>(
    `WITH t AS (
       SELECT
         ((now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS now_utc_tz,
         clock_timestamp() AS wall_clock
     )
     INSERT INTO rate_limit_streaks (
       workspace_id,
       agent_id,
       scope,
       consecutive_429,
       last_429_at,
       updated_at
     ) VALUES (
       $1, $2, $3, 1, (SELECT now_utc_tz FROM t), (SELECT wall_clock FROM t)
     )
     ON CONFLICT (workspace_id, agent_id, scope)
     DO UPDATE SET
       consecutive_429 = CASE
         WHEN rate_limit_streaks.last_429_at IS NULL
           OR rate_limit_streaks.last_429_at < (SELECT now_utc_tz FROM t) - interval '10 minutes'
         THEN 1
         ELSE rate_limit_streaks.consecutive_429 + 1
       END,
       last_429_at = (SELECT now_utc_tz FROM t),
       updated_at = (SELECT wall_clock FROM t)
     RETURNING
       consecutive_429::text AS consecutive_429,
       (
         last_incident_at IS NULL
         OR last_incident_at < (SELECT now_utc_tz FROM t) - make_interval(secs => $4)
       ) AS should_emit_incident,
       (SELECT wall_clock::text FROM t) AS server_time`,
    [input.workspace_id, input.agent_id, input.scope, input.incident_mute_sec],
  );

  return {
    consecutive_429: Number.parseInt(res.rows[0]?.consecutive_429 ?? "0", 10),
    should_emit_incident: Boolean(res.rows[0]?.should_emit_incident),
    server_time: res.rows[0]?.server_time ?? "",
  };
}

async function emitAgentFloodingIncidentIfNeededTx(
  pool: DbPool,
  client: DbClient,
  input: {
    workspace_id: string;
    agent_id: string;
    scope: string;
    server_time: string;
    correlation_id?: string;
  },
): Promise<void> {
  const idempotency_key = `incident:agent_flooding:${input.workspace_id}:${input.agent_id}`;
  const event = {
    event_id: randomUUID(),
    event_type: "incident.opened",
    event_version: 1,
    occurred_at: input.server_time,
    workspace_id: input.workspace_id,
    actor: {
      actor_type: "service" as const,
      actor_id: "rate_limiter",
    },
    stream: {
      stream_type: "workspace" as const,
      stream_id: input.workspace_id,
    },
    correlation_id:
      input.correlation_id?.trim() ||
      `ratelimit:${input.workspace_id}:${input.agent_id}:${input.scope}`,
    idempotency_key,
    entity_type: "agent",
    entity_id: input.agent_id,
    data: {
      incident_id: newIncidentId(),
      category: "agent_flooding",
      title: "Rate limit threshold reached",
      summary: `agent=${input.agent_id} exceeded message rate limits`,
      severity: "medium",
      source: "rate_limit",
      scope: input.scope,
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
    },
    policy_context: {},
    model_context: {},
    display: {},
  };

  await appendWithIdempotencyReplayTx(pool, client, event);
  await client.query(
    `WITH t AS (
       SELECT
         ((now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS now_utc_tz,
         clock_timestamp() AS wall_clock
     )
     UPDATE rate_limit_streaks
     SET last_incident_at = (SELECT now_utc_tz FROM t),
         updated_at = (SELECT wall_clock FROM t)
     WHERE workspace_id = $1
       AND agent_id = $2
       AND scope = $3`,
    [input.workspace_id, input.agent_id, input.scope],
  );
}

async function cleanupBucketsBestEffortTx(client: DbClient): Promise<void> {
  // TODO: shard global bucket if contention becomes severe.
  await client.query(
    `DELETE FROM rate_limit_buckets
     WHERE ctid IN (
       SELECT ctid
       FROM rate_limit_buckets
       WHERE updated_at < ((now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '2 hours'
       LIMIT 200
     )`,
  ).catch(() => {});
}

function buildRules(cfg: RateLimitConfig, params: EnforceParams): RateLimitRule[] {
  const globalMin: RateLimitRule = {
    scope: "global_per_min",
    bucket_key: "global_min:global",
    limit: cfg.global_per_min,
    window_sec: 60,
  };

  if (params.intent === "heartbeat") {
    return [
      {
        scope: "hb_per_agent_per_min",
        bucket_key: `hb_min:${params.workspace_id}:${params.agent_id}`,
        limit: cfg.hb_per_agent_per_min,
        window_sec: 60,
      },
      globalMin,
    ];
  }

  const rules: RateLimitRule[] = [
    {
      scope: "agent_per_min",
      bucket_key: `agent_min:${params.workspace_id}:${params.agent_id}`,
      limit: cfg.agent_per_min,
      window_sec: 60,
    },
    {
      scope: "agent_per_hour",
      bucket_key: `agent_hour:${params.workspace_id}:${params.agent_id}`,
      limit: cfg.agent_per_hour,
      window_sec: 3600,
    },
    globalMin,
  ];

  if (params.experiment_id?.trim()) {
    rules.push({
      scope: "experiment_per_hour",
      bucket_key: `exp_hour:${params.workspace_id}:${params.experiment_id.trim()}`,
      limit: cfg.experiment_per_hour,
      window_sec: 3600,
    });
  }
  return rules.sort((a, b) => a.bucket_key.localeCompare(b.bucket_key));
}

export async function enforceMessageRateLimitTx(
  client: DbClient,
  params: EnforceParams & { pool: DbPool },
): Promise<EnforceOk> {
  const cfg = readRateLimitConfig();
  const rules = buildRules(cfg, params);
  let server_time = "";

  for (const rule of rules) {
    const result = await incrementBucketTx(client, rule);
    server_time = result.server_time || server_time;
    if (result.count <= rule.limit) continue;

    const streak = await bumpRateLimitStreakTx(client, {
      workspace_id: params.workspace_id,
      agent_id: params.agent_id,
      scope: cfg.scope_messages,
      incident_mute_sec: cfg.incident_mute_sec,
    });
    server_time = streak.server_time || server_time;

    if (
      streak.consecutive_429 >= cfg.streak_threshold &&
      streak.should_emit_incident
    ) {
      await emitAgentFloodingIncidentIfNeededTx(params.pool, client, {
        workspace_id: params.workspace_id,
        agent_id: params.agent_id,
        scope: cfg.scope_messages,
        server_time: server_time || result.server_time,
        correlation_id: params.correlation_id,
      });
    }

    await cleanupBucketsBestEffortTx(client);

    const reason_code: ContractReasonCode = "rate_limited";
    throw new ContractViolationError(reason_code, reason_code, {
      scope: rule.scope,
      limit: rule.limit,
      window_sec: rule.window_sec,
      retry_after_sec: result.retry_after_sec,
      server_time: server_time || result.server_time,
    });
  }

  await cleanupBucketsBestEffortTx(client);
  return {
    allowed: true,
    server_time,
  };
}

export async function enforceMessageRateLimit(
  pool: DbPool,
  params: EnforceParams,
): Promise<EnforceOk> {
  const client = await pool.connect();
  let inTx = false;
  try {
    await client.query("BEGIN");
    inTx = true;
    const result = await enforceMessageRateLimitTx(client, { ...params, pool });
    await client.query("COMMIT");
    inTx = false;
    return result;
  } catch (err) {
    if (inTx) {
      if (err instanceof ContractViolationError && err.reason_code === "rate_limited") {
        await client.query("COMMIT").catch(async () => {
          await client.query("ROLLBACK").catch(() => {});
        });
      } else {
        await client.query("ROLLBACK").catch(() => {});
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
