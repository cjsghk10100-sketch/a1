import { randomUUID } from "node:crypto";

import {
  PolicyDecision,
  type CapabilityScopesV1,
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

interface CapabilityTokenRow {
  token_id: string;
  issued_to_principal_id: string;
  scopes: CapabilityScopesV1 | null;
  valid_until: string | null;
  revoked_at: string | null;
}

interface ActionRegistryRow {
  action_type: string;
  reversible: boolean;
  zone_required: Zone;
  requires_pre_approval: boolean;
}

function normalizeAction(action: string): string {
  const a = action.trim();
  if (a === "external_write") return "external.write";
  if (a === "data_read") return "data.read";
  if (a === "data_write") return "data.write";
  return a;
}

function normalizeScopeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    out.add(v);
  }
  return [...out];
}

function normalizeString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length ? value : null;
}

function effectiveZone(inputZone: Zone | undefined): Zone {
  return inputZone ?? "supervised";
}

function normalizeRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function listAllowsValue(values: string[], candidates: string[]): boolean {
  if (!values.length) return false;
  const set = new Set(values);
  if (set.has("*")) return true;
  for (const candidate of candidates) {
    if (set.has(candidate)) return true;
  }
  return false;
}

function domainAllowed(patterns: string[], rawDomain: string): boolean {
  const domain = rawDomain.trim().toLowerCase();
  if (!domain) return false;
  for (const patternRaw of patterns) {
    const pattern = patternRaw.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === "*") return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (domain === suffix || domain.endsWith(`.${suffix}`)) return true;
      continue;
    }
    if (domain === pattern) return true;
  }
  return false;
}

function dataAccessCandidates(input: AuthorizeInputV2): string[] {
  const out = new Set<string>();
  if (input.room_id?.trim()) out.add(`room:${input.room_id.trim()}`);

  const context = normalizeRecord(input.context);
  const dataAccess = normalizeRecord(context?.data_access);
  const resourceType = normalizeString(dataAccess?.resource_type);
  const resourceId = normalizeString(dataAccess?.resource_id);

  if (resourceType) {
    out.add(resourceType);
    out.add(`resource_type:${resourceType}`);
  }
  if (resourceType && resourceId) out.add(`resource:${resourceType}:${resourceId}`);

  return [...out];
}

function toolCallName(input: AuthorizeInputV2): string | null {
  const context = normalizeRecord(input.context);
  const toolCallContext = normalizeRecord(context?.tool_call);
  return normalizeString(toolCallContext?.tool_name) ?? normalizeString(context?.tool_name);
}

function buildTokenDenied(reason_code: string, reason: string): PolicyCheckResultV1 {
  return {
    decision: PolicyDecision.Deny,
    reason_code,
    reason,
  };
}

function buildActionPolicyDecision(
  decision: PolicyDecision,
  reason_code: string,
  reason: string,
): PolicyCheckResultV1 {
  return { decision, reason_code, reason };
}

async function evaluateActionRegistryPolicy(
  pool: DbPool,
  category: AuthorizeCategory,
  input: AuthorizeInputV2,
): Promise<PolicyCheckResultV1 | null> {
  if (category !== "action" && category !== "egress") return null;

  const action = normalizeAction(input.action);
  const rowRes = await pool.query<ActionRegistryRow>(
    `SELECT action_type, reversible, zone_required, requires_pre_approval
     FROM sec_action_registry
     WHERE action_type = $1
     LIMIT 1`,
    [action],
  );
  if (rowRes.rowCount !== 1) return null;
  if (action === "external.write") return null;

  const row = rowRes.rows[0];
  const zone = effectiveZone(input.zone);

  if (zone !== row.zone_required) {
    if (row.zone_required === "high_stakes") {
      return buildActionPolicyDecision(
        PolicyDecision.RequireApproval,
        "action_zone_requires_high_stakes",
        `Action '${action}' requires high_stakes zone.`,
      );
    }

    return buildActionPolicyDecision(
      PolicyDecision.Deny,
      "action_zone_mismatch",
      `Action '${action}' requires '${row.zone_required}' zone (current: '${zone}').`,
    );
  }

  if (!row.reversible && zone !== "high_stakes") {
    return buildActionPolicyDecision(
      PolicyDecision.RequireApproval,
      "action_irreversible_requires_high_stakes",
      `Irreversible action '${action}' requires high_stakes zone.`,
    );
  }

  if (row.requires_pre_approval && action !== "external.write") {
    return buildActionPolicyDecision(
      PolicyDecision.RequireApproval,
      "action_pre_approval_required",
      `Action '${action}' requires pre-approval.`,
    );
  }

  return null;
}

async function evaluateCapabilityToken(
  pool: DbPool,
  category: AuthorizeCategory,
  input: AuthorizeInputV2,
): Promise<PolicyCheckResultV1 | null> {
  const capability_token_id = input.capability_token_id?.trim();
  if (!capability_token_id) return null;

  const tokenRes = await pool.query<CapabilityTokenRow>(
    `SELECT
       token_id,
       issued_to_principal_id,
       scopes,
       valid_until,
       revoked_at
     FROM sec_capability_tokens
     WHERE workspace_id = $1
       AND token_id = $2
     LIMIT 1`,
    [input.workspace_id, capability_token_id],
  );
  if (tokenRes.rowCount !== 1) {
    return buildTokenDenied("capability_token_not_found", "Capability token was not found.");
  }

  const token = tokenRes.rows[0];
  if (token.revoked_at) {
    return buildTokenDenied("capability_token_revoked", "Capability token has been revoked.");
  }
  if (token.valid_until && new Date(token.valid_until).getTime() <= Date.now()) {
    return buildTokenDenied("capability_token_expired", "Capability token has expired.");
  }

  const principal_id = input.principal_id?.trim();
  if (principal_id && token.issued_to_principal_id !== principal_id) {
    return buildTokenDenied(
      "capability_token_principal_mismatch",
      "Capability token does not belong to the provided principal.",
    );
  }

  const scopes = token.scopes ?? {};
  const room_id = input.room_id?.trim();
  if (room_id) {
    const roomScopes = normalizeScopeList(scopes.rooms);
    if (!roomScopes.length) {
      return buildTokenDenied(
        "capability_scope_room_required",
        "Capability token is missing room scope for this request.",
      );
    }
    if (!listAllowsValue(roomScopes, [room_id])) {
      return buildTokenDenied(
        "capability_scope_room_not_allowed",
        `Capability token does not allow room '${room_id}'.`,
      );
    }
  }

  if (category === "action" || category === "egress") {
    const actionScopes = normalizeScopeList(scopes.action_types);
    if (!actionScopes.length) {
      return buildTokenDenied(
        "capability_scope_action_type_required",
        "Capability token is missing action_types scope for this request.",
      );
    }
    const action = normalizeAction(input.action);
    if (!listAllowsValue(actionScopes, [action, input.action.trim()])) {
      return buildTokenDenied(
        "capability_scope_action_not_allowed",
        `Capability token does not allow action '${action}'.`,
      );
    }
  }

  if (category === "tool_call") {
    const toolScopes = normalizeScopeList(scopes.tools);
    if (!toolScopes.length) {
      return buildTokenDenied(
        "capability_scope_tool_required",
        "Capability token is missing tools scope for this request.",
      );
    }
    const toolName = toolCallName(input);
    if (!toolName) {
      return buildTokenDenied(
        "capability_scope_context_missing_tool_name",
        "Tool name is required for capability scope enforcement.",
      );
    }
    if (!listAllowsValue(toolScopes, [toolName])) {
      return buildTokenDenied(
        "capability_scope_tool_not_allowed",
        `Capability token does not allow tool '${toolName}'.`,
      );
    }
  }

  if (category === "data_access") {
    const action = normalizeAction(input.action);
    const dataAccessScopes =
      action === "data.write"
        ? normalizeScopeList(scopes.data_access?.write)
        : action === "data.read"
          ? normalizeScopeList(scopes.data_access?.read)
          : [];
    if (!dataAccessScopes.length) {
      return buildTokenDenied(
        "capability_scope_data_access_required",
        "Capability token is missing data_access scope for this request.",
      );
    }
    if (!listAllowsValue(dataAccessScopes, dataAccessCandidates(input))) {
      return buildTokenDenied(
        "capability_scope_data_access_not_allowed",
        "Capability token does not allow this data access target.",
      );
    }
  }

  if (category === "egress") {
    const egressDomains = normalizeScopeList(scopes.egress_domains);
    if (!egressDomains.length) {
      return buildTokenDenied(
        "capability_scope_egress_domain_required",
        "Capability token is missing egress_domains scope for this request.",
      );
    }
    const context = normalizeRecord(input.context);
    const egressContext = normalizeRecord(context?.egress);
    const targetDomain =
      normalizeString(egressContext?.target_domain) ?? normalizeString(context?.target_domain);
    if (!targetDomain) {
      return buildTokenDenied(
        "capability_scope_context_missing_egress_domain",
        "Egress target domain is required for capability scope enforcement.",
      );
    }
    if (!domainAllowed(egressDomains, targetDomain)) {
      return buildTokenDenied(
        "capability_scope_domain_not_allowed",
        `Capability token does not allow egress domain '${targetDomain}'.`,
      );
    }
  }

  return null;
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

function egressQuotaPerHour(): number {
  const raw = Number(process.env.EGRESS_MAX_REQUESTS_PER_HOUR ?? "0");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.floor(raw));
}

async function checkEgressQuota(
  pool: DbPool,
  workspace_id: string,
  actor: { actor_type: "service" | "user" | "agent"; actor_id: string },
  principal_id: string | undefined,
): Promise<PolicyCheckResultV1 | null> {
  const quotaLimit = egressQuotaPerHour();
  if (quotaLimit <= 0) return null;

  const principal = principal_id?.trim();
  const usage = principal
    ? await pool.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt
         FROM sec_egress_requests
         WHERE workspace_id = $1
           AND requested_by_principal_id = $2
           AND created_at >= (now() - interval '1 hour')`,
        [workspace_id, principal],
      )
    : await pool.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt
         FROM sec_egress_requests
         WHERE workspace_id = $1
           AND requested_by_type = $2
           AND requested_by_id = $3
           AND requested_by_principal_id IS NULL
           AND created_at >= (now() - interval '1 hour')`,
        [workspace_id, actor.actor_type, actor.actor_id],
      );
  const used = Number.parseInt(usage.rows[0]?.cnt ?? "0", 10);
  if (used < quotaLimit) return null;

  return {
    decision: PolicyDecision.Deny,
    reason_code: "quota_exceeded",
    reason: `Egress hourly quota exceeded (${used}/${quotaLimit}).`,
  };
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
  const capabilityDecision = await evaluateCapabilityToken(pool, category, input);
  const actionRegistryDecision =
    capabilityDecision == null ? await evaluateActionRegistryPolicy(pool, category, input) : null;
  const quarantined =
    category === "egress" && !capabilityDecision && !actionRegistryDecision
      ? await isQuarantinedAgentPrincipal(pool, input.principal_id)
      : null;
  const quotaDecision =
    category === "egress" && !capabilityDecision
      ? await checkEgressQuota(pool, input.workspace_id, input.actor, input.principal_id)
      : null;

  const policyBase =
    capabilityDecision ??
    actionRegistryDecision ??
    (quarantined
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
        }));

  const base =
    !capabilityDecision &&
    !actionRegistryDecision &&
    !quarantined &&
    quotaDecision &&
    policyBase.decision !== PolicyDecision.Deny
      ? quotaDecision
      : policyBase;

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
