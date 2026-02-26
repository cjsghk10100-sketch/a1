import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { newMessageId } from "@agentapp/shared";

import {
  assertMessageCreateRequest,
  buildContractError,
  errorPayloadFromUnknown,
  httpStatusForReasonCode,
  type MessageCreateRequest,
} from "../../contracts/pipeline_v2_contract.js";
import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { getRequestAuth } from "../../security/requestAuth.js";

type AgentRow = {
  agent_id: string;
};

type ExistingMessageRow = {
  message_id: string | null;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromHeader(req: { headers: Record<string, unknown> }): string | null {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const pgError = err as { code?: string; constraint?: string };
  if (pgError.code !== "23505") return false;
  if (typeof pgError.constraint !== "string") return false;
  return pgError.constraint.includes("idempotency");
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

type ArtifactHeadCheck = {
  exists: boolean;
  unavailable: boolean;
};

function artifactHeadUrl(object_key: string): string | null {
  const raw = process.env.ARTIFACT_STORAGE_HEAD_URL?.trim() || process.env.ARTIFACT_UPLOAD_BASE_URL?.trim();
  if (!raw) return null;
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
  pool: DbPool,
  workspace_id: string,
  idempotency_key: string,
): Promise<string | null> {
  const existing = await pool.query<ExistingMessageRow>(
    `SELECT data->>'message_id' AS message_id
     FROM evt_events
     WHERE workspace_id = $1
       AND stream_type = 'workspace'
       AND stream_id = $1
       AND event_type = 'message.created'
       AND idempotency_key = $2
     ORDER BY occurred_at DESC, stream_seq DESC
     LIMIT 1`,
    [workspace_id, idempotency_key],
  );
  const message_id = existing.rows[0]?.message_id?.trim();
  return message_id && message_id.length > 0 ? message_id : null;
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

    let body: MessageCreateRequest;
    try {
      assertMessageCreateRequest(req.body);
      body = req.body;
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
    if (!authenticatedAgentId || authenticatedAgentId !== body.from_agent_id) {
      const reason_code = "unknown_agent";
      return reply.code(httpStatusForReasonCode(reason_code)).send(
        buildContractError(reason_code, {
          from_agent_id: body.from_agent_id,
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

    const message_id = newMessageId();
    const occurred_at = new Date().toISOString();
    const correlation_id = body.correlation_id?.trim() || randomUUID();
    const storedMessage = {
      ...body,
      message_id,
      workspace_id,
      from_agent_id: authenticatedAgentId,
      intent: body.intent ?? "message",
      payload: body.payload ?? null,
      payload_ref: body.payload_ref ?? null,
    };

    try {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "message.created",
        event_version: 1,
        occurred_at,
        workspace_id,
        room_id: body.room_id?.trim() || undefined,
        thread_id: body.thread_id?.trim() || undefined,
        actor: { actor_type: "agent", actor_id: authenticatedAgentId },
        actor_principal_id: auth.principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: storedMessage,
        idempotency_key: body.idempotency_key,
        policy_context: {},
        model_context: {},
        display: {},
      });
    } catch (err) {
      if (isIdempotencyUniqueViolation(err)) {
        const existing_message_id = await findExistingMessageByIdempotency(
          pool,
          workspace_id,
          body.idempotency_key,
        );
        if (existing_message_id) {
          const reason_code = "duplicate_idempotent_replay";
          return reply.code(httpStatusForReasonCode(reason_code)).send({
            message_id: existing_message_id,
            idempotent_replay: true,
            reason_code,
          });
        }
        const reason_code = "idempotency_conflict_unresolved";
        return reply.code(httpStatusForReasonCode(reason_code)).send(buildContractError(reason_code));
      }
      const payload = errorPayloadFromUnknown(err, "internal_error");
      return reply.code(httpStatusForReasonCode(payload.reason_code)).send(payload);
    }

    return reply.code(201).send({
      message_id,
      idempotent_replay: false,
    });
  });
}
