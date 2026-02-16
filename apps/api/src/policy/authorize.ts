import { randomUUID } from "node:crypto";

import {
  PolicyDecision,
  type PolicyCheckInputV1,
  type PolicyCheckResultV1,
  type Zone,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";
import { appendToStream } from "../eventStore/index.js";
import { recordLearningFromFailure } from "../security/learningFromFailure.js";
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

interface NegativeDecisionMeta {
  event_id: string;
  correlation_id: string;
  occurred_at: string;
}

async function isQuarantinedAgentPrincipal(
  pool: DbPool,
  principal_id: string | undefined,
): Promise<{ agent_id: string; quarantine_reason: string | null } | null> {
  const candidate = principal_id?.trim();
  if (!candidate) return null;
  const res = await pool.query<{ agent_id: string; quarantine_reason: string | null }>(
    `SELECT agent_id, quarantine_reason
     FROM sec_agents
     WHERE principal_id = $1
       AND quarantined_at IS NOT NULL
     LIMIT 1`,
    [candidate],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

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
): Promise<NegativeDecisionMeta | null> {
  if (result.decision === PolicyDecision.Allow) return null;

  const event_type =
    result.decision === PolicyDecision.Deny ? "policy.denied" : "policy.requires_approval";
  const occurred_at = new Date().toISOString();
  const correlation_id = randomUUID();

  const event = await appendToStream(pool, {
    event_id: randomUUID(),
    event_type,
    event_version: 1,
    occurred_at,
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
    correlation_id,
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
  return {
    event_id: event.event_id,
    correlation_id,
    occurred_at,
  };
}

async function authorizeCore(
  pool: DbPool,
  category: AuthorizeCategory,
  input: AuthorizeInputV2,
): Promise<AuthorizeResultV2> {
  const quarantined =
    category === "egress" ? await isQuarantinedAgentPrincipal(pool, input.principal_id) : null;

  const base = quarantined
    ? {
        decision: PolicyDecision.Deny,
        reason_code: "agent_quarantined",
        reason: quarantined.quarantine_reason
          ? `Agent is quarantined: ${quarantined.quarantine_reason}`
          : "Agent is quarantined.",
      }
    : await evaluatePolicyDbV1(pool, {
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

  const negative = await appendNegativeDecisionEvent(pool, category, input, result);
  if (negative) {
    try {
      await recordLearningFromFailure(pool, {
        category,
        action: input.action,
        actor: input.actor,
        workspace_id: input.workspace_id,
        room_id: input.room_id,
        thread_id: input.thread_id,
        run_id: input.run_id,
        step_id: input.step_id,
        principal_id: input.principal_id,
        zone: input.zone,
        context: input.context,
        decision: result.decision,
        reason_code: result.reason_code,
        reason: result.reason,
        enforcement_mode: result.enforcement_mode,
        blocked: result.blocked,
        capability_token_id: input.capability_token_id,
        policy_event_id: negative.event_id,
        correlation_id: negative.correlation_id,
        occurred_at: negative.occurred_at,
      });
    } catch (err) {
      // Learning signals are additive; they must not block existing policy flows.
      // eslint-disable-next-line no-console
      console.warn("learning-from-failure recording failed", err);
    }
  }
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
