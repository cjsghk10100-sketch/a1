import { randomUUID } from "node:crypto";

import {
  ApprovalScopeType,
  type ActorType,
  type ApprovalEventV1,
  PolicyDecision,
  type Zone,
  newApprovalId,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { authorize_egress, type PolicyEnforcementMode } from "../policy/authorize.js";
import { applyApprovalEvent } from "../projectors/approvalProjector.js";

export interface RequestEgressInput {
  workspace_id: string;
  action?: string;
  target_url: string;
  method?: string;
  room_id?: string;
  run_id?: string;
  step_id?: string;
  actor_type: ActorType;
  actor_id: string;
  principal_id?: string;
  capability_token_id?: string;
  zone?: Zone;
  correlation_id?: string;
  context?: Record<string, unknown>;
}

export interface RequestEgressResult {
  egress_request_id: string;
  action: string;
  method?: string;
  target_url: string;
  target_domain: string;
  decision: PolicyDecision;
  reason_code: string;
  reason?: string;
  approval_id?: string;
  enforcement_mode: PolicyEnforcementMode;
  blocked: boolean;
  correlation_id: string;
}

export class InvalidEgressTargetError extends Error {
  constructor(message = "invalid_target_url") {
    super(message);
    this.name = "InvalidEgressTargetError";
  }
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeAction(raw: string | undefined): string {
  const action = normalizeOptionalString(raw) ?? "external.write";
  if (action === "external_write") return "external.write";
  return action;
}

function normalizeTarget(raw: string): { target_url: string; target_domain: string } | null {
  const input = normalizeOptionalString(raw);
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

export async function requestEgress(
  pool: DbPool,
  input: RequestEgressInput,
): Promise<RequestEgressResult> {
  const target = normalizeTarget(input.target_url);
  if (!target) throw new InvalidEgressTargetError();

  const action = normalizeAction(input.action);
  const method = normalizeOptionalString(input.method);
  const room_id = normalizeOptionalString(input.room_id);
  const run_id = normalizeOptionalString(input.run_id);
  const step_id = normalizeOptionalString(input.step_id);
  const principal_id = normalizeOptionalString(input.principal_id);
  const capability_token_id = normalizeOptionalString(input.capability_token_id);
  const correlation_id = normalizeOptionalString(input.correlation_id) ?? randomUUID();
  const egress_request_id = newEgressRequestId();

  const stream = room_id
    ? { stream_type: "room" as const, stream_id: room_id }
    : { stream_type: "workspace" as const, stream_id: input.workspace_id };

  const policy_context: Record<string, unknown> = {
    ...(input.context ?? {}),
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
    workspace_id: input.workspace_id,
    room_id,
    run_id,
    step_id,
    actor: { actor_type: input.actor_type, actor_id: input.actor_id },
    actor_principal_id: principal_id,
    zone: input.zone,
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
    actor: { actor_type: input.actor_type, actor_id: input.actor_id },
    workspace_id: input.workspace_id,
    room_id,
    run_id,
    step_id,
    context: policy_context,
    principal_id,
    capability_token_id,
    zone: input.zone,
  });

  let approval_id: string | undefined;
  if (policy.decision === PolicyDecision.RequireApproval) {
    approval_id = await createApprovalForEgress(pool, {
      workspace_id: input.workspace_id,
      room_id,
      run_id,
      step_id,
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      action,
      target_url: target.target_url,
      target_domain: target.target_domain,
      method,
      context: input.context,
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
      input.workspace_id,
      room_id,
      run_id,
      step_id,
      input.actor_type,
      input.actor_id,
      principal_id,
      input.zone,
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
    workspace_id: input.workspace_id,
    room_id,
    run_id,
    step_id,
    actor: { actor_type: input.actor_type, actor_id: input.actor_id },
    actor_principal_id: principal_id,
    zone: input.zone,
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
      workspace_id: input.workspace_id,
      room_id,
      run_id,
      step_id,
      actor: { actor_type: input.actor_type, actor_id: input.actor_id },
      actor_principal_id: principal_id,
      zone: input.zone,
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

  return {
    egress_request_id,
    action,
    method,
    target_url: target.target_url,
    target_domain: target.target_domain,
    decision: policy.decision,
    reason_code: policy.reason_code,
    reason: policy.reason,
    approval_id,
    enforcement_mode: policy.enforcement_mode,
    blocked: policy.blocked,
    correlation_id,
  };
}
