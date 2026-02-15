import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  type ActorType,
  type ApprovalEventV1,
  type ApprovalDecision,
  ApprovalScopeType,
  type ApprovalScopeV1,
  type ApprovalStatus,
  newApprovalId,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyApprovalEvent } from "../../projectors/approvalProjector.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  return raw === "service" ? "service" : "user";
}

function normalizeDecision(raw: unknown): ApprovalDecision {
  return raw === "approve" || raw === "deny" || raw === "hold" ? raw : "hold";
}

function normalizeStatus(raw: unknown): ApprovalStatus | null {
  return raw === "pending" || raw === "held" || raw === "approved" || raw === "denied" ? raw : null;
}

function normalizeScope(raw: unknown): ApprovalScopeV1 | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Partial<ApprovalScopeV1>;
  if (!v.type) return undefined;

  const okType =
    v.type === ApprovalScopeType.Once ||
    v.type === ApprovalScopeType.Run ||
    v.type === ApprovalScopeType.Room ||
    v.type === ApprovalScopeType.Workspace ||
    v.type === ApprovalScopeType.Template;
  if (!okType) return undefined;

  return v as ApprovalScopeV1;
}

export async function registerApprovalRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: {
      action: string;
      title?: string;
      request?: Record<string, unknown>;
      context?: Record<string, unknown>;

      room_id?: string;
      thread_id?: string;
      run_id?: string;
      step_id?: string;

      scope?: ApprovalScopeV1;
      expires_at?: string;

      correlation_id?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/approvals", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    if (!req.body.action?.trim()) {
      return reply.code(400).send({ error: "missing_action" });
    }

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      req.body.actor_id?.trim() || (actor_type === "service" ? "api" : "anon");

    const approval_id = newApprovalId();
    const occurred_at = new Date().toISOString();
    const correlation_id = req.body.correlation_id?.trim() || randomUUID();

    const room_id = req.body.room_id?.trim() || undefined;
    const thread_id = req.body.thread_id?.trim() || undefined;
    const run_id = req.body.run_id?.trim() || undefined;
    const step_id = req.body.step_id?.trim() || undefined;

    const stream =
      room_id != null
        ? { stream_type: "room" as const, stream_id: room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const scope = normalizeScope(req.body.scope);

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "approval.requested",
      event_version: 1,
      occurred_at,
      workspace_id,
      room_id,
      thread_id,
      run_id,
      step_id,
      actor: { actor_type, actor_id },
      stream,
      correlation_id,
      data: {
        approval_id,
        action: req.body.action,
        title: req.body.title,
        request: req.body.request,
        context: req.body.context,
        scope,
        expires_at: req.body.expires_at,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyApprovalEvent(pool, event as ApprovalEventV1);
    return reply.code(201).send({ approval_id });
  });

  app.get<{
    Querystring: { status?: string; room_id?: string; limit?: string };
  }>("/v1/approvals", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);

    const status = normalizeStatus(req.query.status);
    if (req.query.status && !status) {
      return reply.code(400).send({ error: "invalid_status" });
    }

    const room_id = req.query.room_id?.trim() || null;

    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";

    if (status) {
      args.push(status);
      where += ` AND status = $${args.length}`;
    }

    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }

    args.push(limit);

    const res = await pool.query(
      `SELECT
        approval_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        action, status,
        title,
        request, context, scope, expires_at,
        requested_by_type, requested_by_id, requested_at,
        decided_by_type, decided_by_id, decided_at, decision, decision_reason,
        correlation_id,
        created_at, updated_at, last_event_id
      FROM proj_approvals
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ approvals: res.rows });
  });

  app.get<{
    Params: { approvalId: string };
  }>("/v1/approvals/:approvalId", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const res = await pool.query(
      `SELECT
        approval_id,
        workspace_id, room_id, thread_id, run_id, step_id,
        action, status,
        title,
        request, context, scope, expires_at,
        requested_by_type, requested_by_id, requested_at,
        decided_by_type, decided_by_id, decided_at, decision, decision_reason,
        correlation_id,
        created_at, updated_at, last_event_id
      FROM proj_approvals
      WHERE approval_id = $1
        AND workspace_id = $2`,
      [req.params.approvalId, workspace_id],
    );
    if (res.rowCount !== 1) {
      return reply.code(404).send({ error: "approval_not_found" });
    }
    return reply.code(200).send({ approval: res.rows[0] });
  });

  app.post<{
    Params: { approvalId: string };
    Body: {
      decision: ApprovalDecision;
      reason?: string;
      scope?: ApprovalScopeV1;
      expires_at?: string;
      actor_type?: ActorType;
      actor_id?: string;
    };
  }>("/v1/approvals/:approvalId/decide", async (req, reply) => {
    const existing = await pool.query<{
      workspace_id: string;
      room_id: string | null;
      thread_id: string | null;
      run_id: string | null;
      step_id: string | null;
      correlation_id: string;
      last_event_id: string | null;
    }>(
      `SELECT workspace_id, room_id, thread_id, run_id, step_id, correlation_id, last_event_id
       FROM proj_approvals
       WHERE approval_id = $1`,
      [req.params.approvalId],
    );
    if (existing.rowCount !== 1) {
      return reply.code(404).send({ error: "approval_not_found" });
    }

    const row = existing.rows[0];
    const occurred_at = new Date().toISOString();
    const causation_id = row.last_event_id ?? undefined;

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      req.body.actor_id?.trim() || (actor_type === "service" ? "api" : "ceo");

    const decision = normalizeDecision(req.body.decision);
    const scope = normalizeScope(req.body.scope);

    const stream =
      row.room_id != null
        ? { stream_type: "room" as const, stream_id: row.room_id }
        : { stream_type: "workspace" as const, stream_id: row.workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "approval.decided",
      event_version: 1,
      occurred_at,
      workspace_id: row.workspace_id,
      room_id: row.room_id ?? undefined,
      thread_id: row.thread_id ?? undefined,
      run_id: row.run_id ?? undefined,
      step_id: row.step_id ?? undefined,
      actor: { actor_type, actor_id },
      stream,
      correlation_id: row.correlation_id,
      causation_id,
      data: {
        approval_id: req.params.approvalId,
        decision,
        reason: req.body.reason,
        scope,
        expires_at: req.body.expires_at,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyApprovalEvent(pool, event as ApprovalEventV1);
    return reply.code(200).send({ ok: true });
  });
}
