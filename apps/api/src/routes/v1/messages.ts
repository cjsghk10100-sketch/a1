import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newMessageId } from "@agentapp/shared";

import {
  ContractViolationError,
  assertMessageCreateRequest,
  buildContractError,
  errorPayloadFromUnknown,
  httpStatusForReasonCode,
  type MessageCreateRequest,
} from "../../contracts/pipeline_v2_contract.js";
import { RATE_LIMIT_SCOPE_MESSAGES } from "../../config.js";
import type { DbClient, DbPool } from "../../db/pool.js";
import { recordMessageProcessingFailure } from "../../dlq/poisonMessageDlq.js";
import { appendToStream } from "../../eventStore/index.js";
import { enforceMessageRateLimit } from "../../ratelimit/enforceMessageRateLimit.js";
import { getRequestAuth } from "../../security/requestAuth.js";

type AgentRow = {
  agent_id: string;
};

type RoomRow = {
  workspace_id: string;
};

type ThreadRow = {
  workspace_id: string;
  room_id: string;
};

type ExistingMessageRow = {
  message_id: string | null;
  from_agent_id: string | null;
};

type ArtifactHeadCheck = {
  exists: boolean;
  unavailable: boolean;
};

type WorkLinks = {
  approval_id?: unknown;
  experiment_id?: unknown;
  incident_id?: unknown;
  run_id?: unknown;
};

type ResolvedWorkItem =
  | { type: "approval"; id: string; skip_lease?: false }
  | { type: "experiment"; id: string; skip_lease?: false }
  | { type: "incident"; id: string; skip_lease?: false }
  | { type: "run"; id: string; skip_lease: true };

type LeaseRow = {
  agent_id: string;
  expires_at: string;
  is_expired: boolean;
};

type MessageCreateBody = MessageCreateRequest & {
  work_links?: WorkLinks;
};

type Queryable = Pick<DbPool, "query"> | Pick<DbClient, "query">;

const TERMINAL_INTENTS = new Set(["resolve", "reject"]);
const LEASE_REQUIRED_INTENTS = new Set(["message", "resolve", "reject"]);
const RATE_LIMIT_SCOPE =
  process.env.RATE_LIMIT_SCOPE_MESSAGES?.trim() || RATE_LIMIT_SCOPE_MESSAGES;

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromHeader(req: { headers: Record<string, unknown> }): string | null {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "23505";
}

function isNowaitLockUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "55P03";
}

function resolveWorkItem(workLinks: WorkLinks): ResolvedWorkItem | null {
  const approval_id = normalizeOptionalString(workLinks.approval_id);
  if (approval_id) return { type: "approval", id: approval_id };

  const experiment_id = normalizeOptionalString(workLinks.experiment_id);
  if (experiment_id) return { type: "experiment", id: experiment_id };

  const incident_id = normalizeOptionalString(workLinks.incident_id);
  if (incident_id) return { type: "incident", id: incident_id };

  const run_id = normalizeOptionalString(workLinks.run_id);
  if (run_id) return { type: "run", id: run_id, skip_lease: true };

  return null;
}

async function findAuthenticatedAgentId(pool: DbPool, principal_id: string): Promise<string | null> {
  const res = await pool.query<AgentRow>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [principal_id],
  );
  return res.rows[0]?.agent_id ?? null;
}

function artifactHeadUrl(object_key: string): string | null {
  const raw = process.env.ARTIFACT_STORAGE_HEAD_URL?.trim() || process.env.ARTIFACT_UPLOAD_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  if (raw.includes("{object_key}")) {
    return raw.replaceAll("{object_key}", encodeURIComponent(object_key));
  }
  try {
    const url = new URL(raw);
    url.searchParams.set("object_key", object_key);
    return url.toString();
  } catch {
    return null;
  }
}

async function artifactObjectExists(object_key: string): Promise<ArtifactHeadCheck> {
  const targetUrl = artifactHeadUrl(object_key);
  if (!targetUrl) {
    return { exists: false, unavailable: true };
  }
  try {
    const res = await fetch(targetUrl, { method: "HEAD" });
    if (res.status === 404) return { exists: false, unavailable: false };
    if (res.ok) return { exists: true, unavailable: false };
    if (res.status >= 500) return { exists: false, unavailable: true };
    return { exists: false, unavailable: false };
  } catch {
    return { exists: false, unavailable: true };
  }
}

async function findExistingMessageByIdempotency(
  queryable: Queryable,
  workspace_id: string,
  idempotency_key: string,
): Promise<{ message_id: string; from_agent_id: string | null } | null> {
  const existing = await queryable.query<ExistingMessageRow>(
    `SELECT
       data->>'message_id' AS message_id,
       data->>'from_agent_id' AS from_agent_id
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type = 'message.created'
       AND idempotency_key = $2
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [workspace_id, idempotency_key],
  );
  if (existing.rowCount !== 1) return null;

  const message_id = existing.rows[0].message_id?.trim();
  if (!message_id) return null;

  const from_agent_id = existing.rows[0].from_agent_id?.trim() || null;
  return { message_id, from_agent_id };
}

async function validateRoomWorkspace(
  pool: DbPool,
  workspace_id: string,
  room_id: string | undefined,
): Promise<boolean> {
  if (!room_id) return true;
  const room = await pool.query<RoomRow>(
    `SELECT workspace_id
     FROM proj_rooms
     WHERE room_id = $1
     LIMIT 1`,
    [room_id],
  );
  if (room.rowCount !== 1) return false;
  return room.rows[0].workspace_id === workspace_id;
}

async function validateThreadWorkspace(
  pool: DbPool,
  workspace_id: string,
  thread_id: string | undefined,
  room_id: string | undefined,
): Promise<boolean> {
  if (!thread_id) return true;
  const thread = await pool.query<ThreadRow>(
    `SELECT workspace_id, room_id
     FROM proj_threads
     WHERE thread_id = $1
     LIMIT 1`,
    [thread_id],
  );
  if (thread.rowCount !== 1) return false;
  const row = thread.rows[0];
  if (row.workspace_id !== workspace_id) return false;
  if (room_id && row.room_id !== room_id) return false;
  return true;
}

function extractExperimentId(rawBody: Record<string, unknown>, workLinks?: WorkLinks): string | null {
  const fromWorkLinks = normalizeOptionalString(workLinks?.experiment_id);
  if (fromWorkLinks) return fromWorkLinks;
  const payload = rawBody.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return normalizeOptionalString((payload as Record<string, unknown>).experiment_id) ?? null;
}

async function resetRateLimitStreakAfterSuccess(
  pool: DbPool,
  workspace_id: string,
  agent_id: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
    `UPDATE rate_limit_streaks
     SET consecutive_429 = 0,
         updated_at = now()
     WHERE workspace_id = $1
       AND agent_id = $2
       AND scope = $3
       AND consecutive_429 > 0`,
    [workspace_id, agent_id, RATE_LIMIT_SCOPE],
  );
  } finally {
    client.release();
  }
}

export async function registerMessageRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{ Body: unknown }>("/v1/messages", async (req, reply) => {
    const workspace_id = workspaceIdFromHeader(req);
    if (!workspace_id) {
      const reason_code = "missing_workspace_header";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          header: "x-workspace-id",
        }),
      );
    }

    let body: MessageCreateBody;
    try {
      assertMessageCreateRequest(req.body);
      body = req.body as MessageCreateBody;
    } catch (err) {
      const payload = errorPayloadFromUnknown(err, "internal_error");
      return reply.code(httpStatusForReasonCode(payload.reason_code)).send(payload);
    }

    if (body.workspace_id && body.workspace_id !== workspace_id) {
      const reason_code = "unauthorized_workspace";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          header_workspace_id: workspace_id,
          body_workspace_id: body.workspace_id,
        }),
      );
    }

    const auth = getRequestAuth(req);
    const authenticatedAgentId = await findAuthenticatedAgentId(pool, auth.principal_id);
    if (!authenticatedAgentId) {
      const reason_code = "unknown_agent";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          from_agent_id: body.from_agent_id,
        }),
      );
    }

    if (normalizeOptionalString(body.from_agent_id) !== authenticatedAgentId) {
      const reason_code = "unknown_agent";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          from_agent_id: body.from_agent_id,
        }),
      );
    }

    const room_id = normalizeOptionalString(body.room_id);
    const thread_id = normalizeOptionalString(body.thread_id);
    if (!(await validateRoomWorkspace(pool, workspace_id, room_id))) {
      const reason_code = "unauthorized_workspace";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          room_id,
          workspace_id,
        }),
      );
    }
    if (!(await validateThreadWorkspace(pool, workspace_id, thread_id, room_id))) {
      const reason_code = "unauthorized_workspace";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          thread_id,
          room_id,
          workspace_id,
        }),
      );
    }

    if (body.payload_ref) {
      const head = await artifactObjectExists(body.payload_ref.object_key);
      if (head.unavailable) {
        const reason_code = "storage_unavailable";
        return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
      }
      if (!head.exists) {
        const reason_code = "artifact_not_found";
        return reply.code(httpStatusForReasonCode(reason_code)).send(
          buildContractError(reason_code, {
            object_key: body.payload_ref.object_key,
          }),
        );
      }
    }

    const normalizedIntent = normalizeOptionalString((req.body as Record<string, unknown>)?.intent) ?? "message";
    const terminalIntent = TERMINAL_INTENTS.has(normalizedIntent);

    const rawWorkLinks = (req.body as Record<string, unknown>)?.work_links;
    const workLinks = rawWorkLinks && typeof rawWorkLinks === "object" && !Array.isArray(rawWorkLinks)
      ? (rawWorkLinks as WorkLinks)
      : undefined;
    const experiment_id = extractExperimentId(req.body as Record<string, unknown>, workLinks);
    const hasWorkLinks = Boolean(workLinks && Object.keys(workLinks).length > 0);
    const leaseEnforcementApplies = hasWorkLinks && LEASE_REQUIRED_INTENTS.has(normalizedIntent);

    let resolvedWorkItem: ResolvedWorkItem | null = null;
    if (leaseEnforcementApplies) {
      resolvedWorkItem = resolveWorkItem(workLinks as WorkLinks);
      if (!resolvedWorkItem) {
        const reason_code = "missing_work_link";
        return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
      }
      if (terminalIntent && resolvedWorkItem.type === "run") {
        const reason_code = "invalid_intent_for_type";
        return reply.code(httpStatusForReasonCode(reason_code)).send(
          buildContractError(reason_code, {
            intent: normalizedIntent,
            work_item_type: resolvedWorkItem.type,
          }),
        );
      }
    }

    const existingBeforeRateLimit = await findExistingMessageByIdempotency(pool, workspace_id, body.idempotency_key);
    if (existingBeforeRateLimit) {
      if (existingBeforeRateLimit.from_agent_id === authenticatedAgentId) {
        await resetRateLimitStreakAfterSuccess(pool, workspace_id, authenticatedAgentId).catch(() => {});
        const reason_code = "duplicate_idempotent_replay";
        return reply.code(httpStatusForReasonCode(reason_code)).send({
          message_id: existingBeforeRateLimit.message_id,
          idempotent_replay: true,
          reason_code,
        });
      }
      const reason_code = "idempotency_conflict_unresolved";
      return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
    }

    try {
      await enforceMessageRateLimit(pool, {
        workspace_id,
        agent_id: authenticatedAgentId,
        intent: normalizedIntent,
        experiment_id,
        correlation_id: body.correlation_id?.trim() || randomUUID(),
      });
    } catch (err) {
      const payload = errorPayloadFromUnknown(err, "internal_error");
      if (payload.reason_code === "internal_error") {
        await recordMessageProcessingFailure(pool, {
          workspace_id,
          message_id: body.idempotency_key?.trim() || "unknown_idempotency",
          last_error: payload.reason,
          source_intent: normalizedIntent,
          source_kind: "messages_route",
          raw_payload: JSON.stringify(req.body ?? null),
        }).catch(() => {});
      }
      return reply.code(httpStatusForReasonCode(payload.reason_code)).send(payload);
    }

    const message_id = newMessageId();
    const occurred_at = new Date().toISOString();
    const correlation_id = normalizeOptionalString(body.correlation_id) ?? randomUUID();
    const stream = room_id
      ? ({ stream_type: "room", stream_id: room_id } as const)
      : ({ stream_type: "workspace", stream_id: workspace_id } as const);
    const storedMessage = {
      ...body,
      message_id,
      workspace_id,
      room_id: room_id ?? null,
      thread_id: thread_id ?? null,
      from_agent_id: authenticatedAgentId,
      intent: normalizedIntent,
      payload: body.payload ?? null,
      payload_ref: body.payload_ref ?? null,
    };

    let txClient: DbClient | undefined;
    let committed = false;
    let missingLease = false;
    let replayHandled = false;
    let shouldResetRateLimitStreak = false;
    let responseStatus = 201;
    let responseBody: unknown = {
      message_id,
      idempotent_replay: false,
    };

    try {
      txClient = await pool.connect();
      await txClient.query("BEGIN");

      if (!committed && leaseEnforcementApplies && resolvedWorkItem && resolvedWorkItem.skip_lease !== true) {
        const lease = await txClient.query<LeaseRow>(
          `SELECT
             agent_id,
             expires_at::text AS expires_at,
             (expires_at <= now()) AS is_expired
           FROM work_item_leases
           WHERE workspace_id = $1
             AND work_item_type = $2
             AND work_item_id = $3
           FOR UPDATE NOWAIT
           LIMIT 1`,
          [workspace_id, resolvedWorkItem.type, resolvedWorkItem.id],
        );

        if (lease.rowCount === 1) {
          const row = lease.rows[0];
          if (row.agent_id !== authenticatedAgentId || row.is_expired === true) {
            throw new ContractViolationError("lease_expired_or_preempted", "lease_expired_or_preempted", {
              work_item_type: resolvedWorkItem.type,
              work_item_id: resolvedWorkItem.id,
              lease_agent_id: row.agent_id,
              caller_agent_id: authenticatedAgentId,
              lease_expires_at: row.expires_at,
            });
          }
        } else {
          missingLease = true;
        }
      }

      try {
        if (committed) {
          // no-op; duplicate replay/conflict already handled in this transaction
        } else {
          await appendToStream(
            pool,
            {
              event_id: randomUUID(),
              event_type: "message.created",
              event_version: 1,
              occurred_at,
              workspace_id,
              room_id: room_id ?? undefined,
              thread_id: thread_id ?? undefined,
              actor: { actor_type: "agent", actor_id: authenticatedAgentId },
              actor_principal_id: auth.principal_id,
              stream,
              correlation_id,
              data: storedMessage,
              idempotency_key: body.idempotency_key,
              policy_context: {},
              model_context: {},
              display: {},
            },
            txClient,
          );
        }
      } catch (err) {
        if (!isIdempotencyUniqueViolation(err)) {
          throw err;
        }

        await txClient.query("ROLLBACK");
        replayHandled = true;

        await txClient.query("BEGIN");
        const existing = await findExistingMessageByIdempotency(txClient, workspace_id, body.idempotency_key);
        if (existing && existing.from_agent_id === authenticatedAgentId) {
          await txClient.query("COMMIT");
          committed = true;
          shouldResetRateLimitStreak = true;

          const reason_code = "duplicate_idempotent_replay";
          responseStatus = httpStatusForReasonCode(reason_code);
          responseBody = {
            message_id: existing.message_id,
            idempotent_replay: true,
            reason_code,
          };
        } else {
          await txClient.query("ROLLBACK");
          committed = true;
          const reason_code = "idempotency_conflict_unresolved";
          responseStatus = httpStatusForReasonCode(reason_code);
          responseBody = buildContractError(reason_code);
        }
      }

      if (!committed && !replayHandled) {
        if (
          terminalIntent &&
          resolvedWorkItem &&
          resolvedWorkItem.skip_lease !== true &&
          missingLease !== true
        ) {
          await txClient.query(
            `DELETE FROM work_item_leases
             WHERE workspace_id = $1
               AND work_item_type = $2
               AND work_item_id = $3
               AND agent_id = $4`,
            [workspace_id, resolvedWorkItem.type, resolvedWorkItem.id, authenticatedAgentId],
          );
        }

        await txClient.query("COMMIT");
        committed = true;
        shouldResetRateLimitStreak = true;
      }
    } catch (err) {
      if (!committed && txClient) {
        await txClient.query("ROLLBACK").catch(() => {});
        committed = true;
      }

      if (isNowaitLockUnavailable(err)) {
        const reason_code = "heartbeat_rate_limited";
        // TODO: add dedicated reason_code for lease_lock_contention in a follow-up PR.
        return reply.code(httpStatusForReasonCode(reason_code)).send(
          buildContractError(reason_code, {
            work_item_type: resolvedWorkItem?.type,
            work_item_id: resolvedWorkItem?.id,
          }),
        );
      }

      const payload = errorPayloadFromUnknown(err, "internal_error");
      if (payload.reason_code === "internal_error") {
        await recordMessageProcessingFailure(pool, {
          workspace_id,
          message_id: body.idempotency_key?.trim() || message_id,
          last_error: payload.reason,
          source_intent: normalizedIntent,
          source_kind: "messages_route",
          raw_payload: JSON.stringify(req.body ?? null),
        }).catch(() => {});
      }
      return reply.code(httpStatusForReasonCode(payload.reason_code)).send(payload);
    } finally {
      txClient?.release();
    }

    if (missingLease === true) {
      reply.header("X-Lease-Warning", "missing_lease");
    }
    if (shouldResetRateLimitStreak) {
      await resetRateLimitStreakAfterSuccess(pool, workspace_id, authenticatedAgentId).catch(() => {});
    }

    return reply.code(responseStatus).send(responseBody);
  });
}
