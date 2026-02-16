import { randomUUID } from "node:crypto";

import {
  PolicyDecision,
  type PolicyCheckInputV1,
  type PolicyCheckResultV1,
  type Zone,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { evaluatePolicyDbV1 } from "./policyGate.js";

export const PolicyEnforcementMode = {
  Shadow: "shadow",
  Enforce: "enforce",
} as const;

export type PolicyEnforcementMode =
  (typeof PolicyEnforcementMode)[keyof typeof PolicyEnforcementMode];

export interface AuthorizeInputV2 extends PolicyCheckInputV1 {
  principal_id?: string;
  capability_token_id?: string;
  zone?: Zone;
}

export interface AuthorizeResultV2 extends PolicyCheckResultV1 {
  enforcement_mode: PolicyEnforcementMode;
  blocked: boolean;
}

type AuthorizeCategory = "tool_call" | "data_access" | "action" | "egress";

function getPolicyEnforcementMode(raw: string | undefined): PolicyEnforcementMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === PolicyEnforcementMode.Enforce) return PolicyEnforcementMode.Enforce;
  return PolicyEnforcementMode.Shadow;
}

function toPolicyResult(result: AuthorizeResultV2): PolicyCheckResultV1 {
  if (result.reason) {
    return {
      decision: result.decision,
      reason_code: result.reason_code,
      reason: result.reason,
    };
  }
  return {
    decision: result.decision,
    reason_code: result.reason_code,
  };
}

async function appendNegativeDecisionEvent(
  pool: DbPool,
  category: AuthorizeCategory,
  input: AuthorizeInputV2,
  result: AuthorizeResultV2,
): Promise<void> {
  if (result.decision === PolicyDecision.Allow) return;

  const event_type =
    result.decision === PolicyDecision.Deny ? "policy.denied" : "policy.requires_approval";

  await appendToStream(pool, {
    event_id: randomUUID(),
    event_type,
    event_version: 1,
    occurred_at: new Date().toISOString(),
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    thread_id: input.thread_id,
    run_id: input.run_id,
    step_id: input.step_id,
    actor: input.actor,
    actor_principal_id: input.principal_id,
    zone: input.zone,
    stream: input.room_id
      ? { stream_type: "room", stream_id: input.room_id }
      : { stream_type: "workspace", stream_id: input.workspace_id },
    correlation_id: randomUUID(),
    data: {
      category,
      action: input.action,
      reason_code: result.reason_code,
      reason: result.reason,
      enforcement_mode: result.enforcement_mode,
      blocked: result.blocked,
      capability_token_id: input.capability_token_id,
    },
    policy_context: input.context ?? {},
    model_context: {},
    display: {},
  });
}

async function authorizeCore(
  pool: DbPool,
  category: AuthorizeCategory,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  const base = await evaluatePolicyDbV1(pool, {
    action: input.action,
    actor: input.actor,
    workspace_id: input.workspace_id,
    room_id: input.room_id,
    thread_id: input.thread_id,
    run_id: input.run_id,
    step_id: input.step_id,
    context: input.context,
  });

  const enforcement_mode = getPolicyEnforcementMode(process.env.POLICY_ENFORCEMENT_MODE);
  const blocked =
    enforcement_mode === PolicyEnforcementMode.Enforce &&
    base.decision !== PolicyDecision.Allow;

  const result: AuthorizeResultV2 = {
    ...toPolicyResult({
      ...base,
      enforcement_mode,
      blocked,
    }),
    enforcement_mode,
    blocked,
  };

  await appendNegativeDecisionEvent(pool, category, input, result);
  return result;
}

export async function authorize_tool_call(
  pool: DbPool,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  return await authorizeCore(pool, "tool_call", input);
}

export async function authorize_data_access(
  pool: DbPool,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  return await authorizeCore(pool, "data_access", input);
}

export async function authorize_action(
  pool: DbPool,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  return await authorizeCore(pool, "action", input);
}

export async function authorize_egress(
  pool: DbPool,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  return await authorizeCore(pool, "egress", input);
}

