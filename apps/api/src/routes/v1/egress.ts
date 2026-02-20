import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import {
  ApprovalScopeType,
  type ActorType,
  type ApprovalEventV1,
  PolicyDecision,
  type Zone,
  newApprovalId,
  type EgressRequestCreateV1,
  type EgressRequestDecisionV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { authorize_egress } from "../../policy/authorize.js";
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

function normalizeZone(raw: unknown): Zone | undefined {
  if (raw === "sandbox" || raw === "supervised" || raw === "high_stakes") return raw;
  return undefined;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeTarget(raw: unknown): { target_url: string; target_domain: string } | null {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (!url.hostname) return null;
  return { target_url: url.toString(), target_domain: url.hostname.toLowerCase() };
}

function newEgressRequestId(): string {
  return `egr_${randomUUID().replaceAll("-", "")}`;
}

async function createApprovalForEgress(
  pool: DbPool,
  input: {
    workspace_id: string;
    room_id?: string;
    run_id?: string;
    step_id?: string;
    actor_type: ActorType;
    actor_id: string;
    action: string;
    target_url: string;
    target_domain: string;
    method?: string;
    context?: Record<string, unknown>;
    correlation_id: string;
  },
): Promise<string> {
  const approval_id = newApprovalId();
  const stream = input.room_id
    ? { stream_type: "room" as const, stream_id: input.room_id }
    : { stream_type: "workspace" as const, stream_id: input.workspace_id };

  const scope = input.room_id
    ? { type: ApprovalScopeType.Room, room_id: input.room_id }
    : { type: ApprovalScopeType.Workspace };

  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type: "approval.requested",
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    run_id: input.run_id,
    step_id: input.step_id,
    actor: { actor_type: input.actor_type, actor_id: input.actor_id },
    stream,
    correlation_id: input.correlation_id,
    data: {
      approval_id,
      action: input.action,
      title: `Egress request to ${input.target_domain}`,
      request: {
        target_url: input.target_url,
        target_domain: input.target_domain,
        method: input.method,
      },
      context: input.context,
      scope,
    },
    policy_context: {},
    model_context: {},
    display: {},
  });

  await applyApprovalEvent(pool, event as ApprovalEventV1);
  return approval_id;
}

export async function registerEgressRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: EgressRequestCreateV1;
  }>("/v1/egress/requests", async (req, reply): Promise<EgressRequestDecisionV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const action = normalizeOptionalString(req.body.action) ?? "external.write";
    const target = normalizeTarget(req.body.target_url);
    if (!target) return reply.code(400).send({ error: "invalid_target_url" });

    const method = normalizeOptionalString(req.body.method);
    const room_id = normalizeOptionalString(req.body.room_id);
    const run_id = normalizeOptionalString(req.body.run_id);
    const step_id = normalizeOptionalString(req.body.step_id);
    const principal_id = normalizeOptionalString(req.body.principal_id);
    const capability_token_id = normalizeOptionalString(req.body.capability_token_id);
    const zone = normalizeZone(req.body.zone);

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");

    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();
    const egress_request_id = newEgressRequestId();

    const stream = room_id
      ? { stream_type: "room" as const, stream_id: room_id }
      : { stream_type: "workspace" as const, stream_id: workspace_id };
    const policy_context: Record<string, unknown> = {
      ...(req.body.context ?? {}),
      egress: {
        target_url: target.target_url,
        target_domain: target.target_domain,
        method,
      },
    };

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "egress.requested",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id,
      room_id,
      run_id,
      step_id,
      actor: { actor_type, actor_id },
      actor_principal_id: principal_id,
      zone,
      stream,
      correlation_id,
      data: {
        egress_request_id,
        action,
        method,
        target_url: target.target_url,
        target_domain: target.target_domain,
        capability_token_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    const policy = await authorize_egress(pool, {
      action,
      actor: { actor_type, actor_id },
      workspace_id,
      room_id,
      run_id,
      step_id,
      context: policy_context,
      principal_id,
      capability_token_id,
      zone,
    });

    let approval_id: string | undefined;
    if (policy.decision === PolicyDecision.RequireApproval) {
      approval_id = await createApprovalForEgress(pool, {
        workspace_id,
        room_id,
        run_id,
        step_id,
        actor_type,
        actor_id,
        action,
        target_url: target.target_url,
        target_domain: target.target_domain,
        method,
        context: req.body.context,
        correlation_id,
      });
    }

    await pool.query(
      `INSERT INTO sec_egress_requests (
        egress_request_id,
        workspace_id,
        room_id,
        run_id,
        step_id,
        requested_by_type,
        requested_by_id,
        requested_by_principal_id,
        zone,
        action,
        method,
        target_url,
        target_domain,
        policy_decision,
        policy_reason_code,
        policy_reason,
        enforcement_mode,
        blocked,
        approval_id,
        correlation_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )`,
      [
        egress_request_id,
        workspace_id,
        room_id,
        run_id,
        step_id,
        actor_type,
        actor_id,
        principal_id,
        zone,
        action,
        method,
        target.target_url,
        target.target_domain,
        policy.decision,
        policy.reason_code,
        policy.reason ?? null,
        policy.enforcement_mode,
        policy.blocked,
        approval_id ?? null,
        correlation_id,
      ],
    );

    const outcome_event_type =
      policy.decision === PolicyDecision.Allow ? "egress.allowed" : "egress.blocked";

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: outcome_event_type,
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id,
      room_id,
      run_id,
      step_id,
      actor: { actor_type, actor_id },
      actor_principal_id: principal_id,
      zone,
      stream,
      correlation_id,
      data: {
        egress_request_id,
        action,
        target_url: target.target_url,
        target_domain: target.target_domain,
        decision: policy.decision,
        reason_code: policy.reason_code,
        reason: policy.reason,
        blocked: policy.blocked,
        enforcement_mode: policy.enforcement_mode,
        approval_id,
        capability_token_id,
      },
      policy_context,
      model_context: {},
      display: {},
    });

    if (policy.reason_code === "quota_exceeded") {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "quota.exceeded",
        event_version: 1,
        occurred_at: new Date().toISOString(),
        workspace_id,
        room_id,
        run_id,
        step_id,
        actor: { actor_type, actor_id },
        actor_principal_id: principal_id,
        zone,
        stream,
        correlation_id,
        data: {
          egress_request_id,
          action,
          target_url: target.target_url,
          target_domain: target.target_domain,
          reason_code: policy.reason_code,
          reason: policy.reason,
          capability_token_id,
        },
        policy_context,
        model_context: {},
        display: {},
      });
    }

    if (policy.reason) {
      return reply.code(201).send({
        egress_request_id,
        decision: policy.decision,
        reason_code: policy.reason_code,
        reason: policy.reason,
        approval_id,
      });
    }

    return reply.code(201).send({
      egress_request_id,
      decision: policy.decision,
      reason_code: policy.reason_code,
      approval_id,
    });
  });

  app.get<{
    Querystring: { room_id?: string; limit?: string };
  }>("/v1/egress/requests", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id) ?? null;
    const rawLimit = Number(req.query.limit ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    args.push(limit);

    const res = await pool.query(
      `SELECT
        egress_request_id,
        workspace_id,
        room_id,
        run_id,
        step_id,
        requested_by_type,
        requested_by_id,
        requested_by_principal_id,
        zone,
        action,
        method,
        target_url,
        target_domain,
        policy_decision,
        policy_reason_code,
        policy_reason,
        enforcement_mode,
        blocked,
        approval_id,
        correlation_id,
        created_at
      FROM sec_egress_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ requests: res.rows });
  });
}
