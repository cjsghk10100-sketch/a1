import { randomUUID } from "node:crypto";

import { newIncidentId, newMessageId } from "@agentapp/shared";

import { SCHEMA_VERSION } from "../contracts/schemaVersion.js";
import type { DbClient, DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";

const DLQ_THRESHOLD = 3;
const WORKSPACE_FALLBACK = "SYS_GLOBAL";
const LOOP_GUARD_INTENTS = new Set(["request_human_decision", "resolve", "reject"]);
const LOOP_GUARD_KINDS = new Set(["incident_control", "poison_message_control"]);

type DlqCounterRow = {
  consecutive_failures: number;
  first_failed_at: string | null;
  last_failed_at: string | null;
  already_dlq: boolean;
};

type RecordFailureParams = {
  workspace_id?: string | null;
  message_id: string;
  last_error: string;
  source_intent?: string;
  source_kind?: string;
};

type TxParams = RecordFailureParams & {
  pool: DbPool;
};

type RecordFailureResult = {
  moved_to_dlq: boolean;
  failure_count: number;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code !== "23505") return false;
  return typeof pgErr.constraint === "string" && pgErr.constraint.includes("idempotency");
}

function shouldSkipHumanDecision(source_intent?: string, source_kind?: string): boolean {
  if (source_intent && LOOP_GUARD_INTENTS.has(source_intent)) return true;
  if (source_kind && LOOP_GUARD_KINDS.has(source_kind)) return true;
  return false;
}

async function appendWithIdempotentReplayTx(
  pool: DbPool,
  client: DbClient,
  event: Parameters<typeof appendToStream>[1],
): Promise<"emitted" | "replayed"> {
  await client.query("SAVEPOINT dlq_emit_sp");
  try {
    await appendToStream(pool, event, client);
    await client.query("RELEASE SAVEPOINT dlq_emit_sp");
    return "emitted";
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT dlq_emit_sp");
    await client.query("RELEASE SAVEPOINT dlq_emit_sp");
    if (isIdempotencyUniqueViolation(err)) {
      return "replayed";
    }
    throw err;
  }
}

async function upsertFailureCounterTx(
  client: DbClient,
  input: { workspace_id: string; message_id: string; last_error: string },
): Promise<DlqCounterRow> {
  const res = await client.query<{
    consecutive_failures: string;
    first_failed_at: string | null;
    last_failed_at: string | null;
    already_dlq: boolean;
  }>(
    `INSERT INTO message_failure_counters (
       workspace_id,
       message_id,
       consecutive_failures,
       first_failed_at,
       last_failed_at,
       last_error,
       dlq_at,
       updated_at
     ) VALUES (
       $1, $2, 1, now(), now(), $3, NULL, now()
     )
     ON CONFLICT (workspace_id, message_id)
     DO UPDATE SET
       consecutive_failures = CASE
         WHEN message_failure_counters.dlq_at IS NOT NULL
         THEN message_failure_counters.consecutive_failures
         ELSE message_failure_counters.consecutive_failures + 1
       END,
       first_failed_at = COALESCE(message_failure_counters.first_failed_at, now()),
       last_failed_at = now(),
       last_error = EXCLUDED.last_error,
       updated_at = now()
     RETURNING
       consecutive_failures::text AS consecutive_failures,
       first_failed_at::text AS first_failed_at,
       last_failed_at::text AS last_failed_at,
       (dlq_at IS NOT NULL) AS already_dlq`,
    [input.workspace_id, input.message_id, input.last_error],
  );

  return {
    consecutive_failures: Number.parseInt(res.rows[0]?.consecutive_failures ?? "0", 10),
    first_failed_at: res.rows[0]?.first_failed_at ?? null,
    last_failed_at: res.rows[0]?.last_failed_at ?? null,
    already_dlq: Boolean(res.rows[0]?.already_dlq),
  };
}

export async function recordMessageProcessingFailureTx(
  client: DbClient,
  params: TxParams,
): Promise<RecordFailureResult> {
  const workspace_id = normalizeOptionalString(params.workspace_id) ?? WORKSPACE_FALLBACK;
  const source_intent = normalizeOptionalString(params.source_intent);
  const source_kind = normalizeOptionalString(params.source_kind);
  const message_id = params.message_id.trim();
  const last_error = params.last_error;

  const counter = await upsertFailureCounterTx(client, {
    workspace_id,
    message_id,
    last_error,
  });

  if (counter.already_dlq) {
    return {
      moved_to_dlq: false,
      failure_count: counter.consecutive_failures,
    };
  }

  if (counter.consecutive_failures < DLQ_THRESHOLD) {
    return {
      moved_to_dlq: false,
      failure_count: counter.consecutive_failures,
    };
  }

  await client.query(
    `INSERT INTO dead_letter_messages (
       workspace_id,
       message_id,
       first_failed_at,
       last_failed_at,
       failure_count,
       last_error
     ) VALUES (
       $1,
       $2,
       $3::timestamptz,
       $4::timestamptz,
       $5,
       $6
     )
     ON CONFLICT (workspace_id, message_id) DO NOTHING`,
    [
      workspace_id,
      message_id,
      counter.first_failed_at,
      counter.last_failed_at,
      counter.consecutive_failures,
      last_error,
    ],
  );

  const dlqUpdated = await client.query(
    `UPDATE message_failure_counters
     SET dlq_at = now(),
         updated_at = now()
     WHERE workspace_id = $1
       AND message_id = $2
       AND dlq_at IS NULL`,
    [workspace_id, message_id],
  );

  if (dlqUpdated.rowCount === 0) {
    return {
      moved_to_dlq: false,
      failure_count: counter.consecutive_failures,
    };
  }

  const correlation_id = `dlq:${workspace_id}:${message_id}`;
  const poisonIncidentKey = `incident:poison_message:${workspace_id}:${message_id}`;

  await appendWithIdempotentReplayTx(params.pool, client, {
    event_id: randomUUID(),
    event_type: "incident.opened",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id,
    actor: { actor_type: "service", actor_id: "dlq" },
    stream: { stream_type: "workspace", stream_id: workspace_id },
    correlation_id,
    idempotency_key: poisonIncidentKey,
    entity_type: "message",
    entity_id: message_id,
    data: {
      incident_id: newIncidentId(),
      category: "poison_message",
      title: "Message moved to DLQ",
      summary: `message_id=${message_id}`,
      severity: "medium",
      source: "dlq",
      workspace_id,
      message_id,
      last_error,
      failure_count: counter.consecutive_failures,
    },
    policy_context: {},
    model_context: {},
    display: {},
  } as Parameters<typeof appendToStream>[1]);

  if (!shouldSkipHumanDecision(source_intent, source_kind)) {
    const humanDecisionKey = `message:request_human_decision:${workspace_id}:${message_id}`;
    const decisionMessageId = newMessageId();

    await appendWithIdempotentReplayTx(params.pool, client, {
      event_id: randomUUID(),
      event_type: "message.created",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id,
      actor: { actor_type: "service", actor_id: "dlq" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      idempotency_key: humanDecisionKey,
      entity_type: "message",
      entity_id: decisionMessageId,
      data: {
        schema_version: SCHEMA_VERSION,
        message_id: decisionMessageId,
        workspace_id,
        from_agent_id: "system",
        correlation_id,
        idempotency_key: humanDecisionKey,
        intent: "request_human_decision",
        payload: {
          source_message_id: message_id,
          last_error,
          reason: "poison_message",
        },
        payload_ref: null,
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1]);
  }

  return {
    moved_to_dlq: true,
    failure_count: counter.consecutive_failures,
  };
}

export async function recordMessageProcessingFailure(
  pool: DbPool,
  params: RecordFailureParams,
): Promise<RecordFailureResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await recordMessageProcessingFailureTx(client, {
      ...params,
      pool,
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
