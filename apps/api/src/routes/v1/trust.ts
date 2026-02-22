import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  ActorType,
  AutonomyApproveRequestV1,
  AutonomyRecommendRequestV1,
  CapabilityScopesV1,
  TrustRecalculateRequestV1,
  TrustComponentsV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";

const TRUST_EPSILON = 0.0001;
type ApprovalModeCode = "auto" | "post" | "pre" | "blocked";
type ApprovalTargetCode = "internal_write" | "external_write" | "high_stakes";
type ApprovalBasisCode =
  | "default"
  | "no_scope"
  | "quarantine"
  | "pre_required"
  | "post_required"
  | "irreversible"
  | "high_stakes"
  | "high_trust"
  | "repeated_mistakes"
  | "low_autonomy"
  | "assessment_regression"
  | "high_cost"
  | "medium_cost"
  | "hard_recovery";
type ActionZone = "sandbox" | "supervised" | "high_stakes";
type CostImpact = "low" | "medium" | "high";
type RecoveryDifficulty = "easy" | "moderate" | "hard";

type ScopeUnion = {
  rooms: string[];
  tools: string[];
  data_read: string[];
  data_write: string[];
  egress: string[];
  actions: string[];
};

type ActionPolicyRow = {
  action_type: string;
  reversible: boolean;
  zone_required: ActionZone;
  requires_pre_approval: boolean;
  post_review_required: boolean;
  metadata: Record<string, unknown>;
};

type ActionPolicyFlags = {
  highStakes: number;
  supervised: number;
  sandbox: number;
  preRequired: boolean;
  postRequired: boolean;
  irreversible: boolean;
  reversible: number;
  highCost: number;
  mediumCost: number;
  hardRecovery: number;
  moderateRecovery: number;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeActorType(raw: unknown): ActorType {
  if (raw === "service" || raw === "agent") return raw;
  return "user";
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeRequiredString(raw: unknown): string | null {
  const v = normalizeOptionalString(raw);
  return v ?? null;
}

function parseTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampSigned(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function parseMaybeNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function uniqueSortedStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    out.add(s);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function normalizeScopes(raw: unknown): CapabilityScopesV1 {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const dataAccessRaw =
    obj.data_access && typeof obj.data_access === "object"
      ? (obj.data_access as Record<string, unknown>)
      : undefined;

  const scopes: CapabilityScopesV1 = {
    rooms: uniqueSortedStrings(obj.rooms),
    tools: uniqueSortedStrings(obj.tools),
    egress_domains: uniqueSortedStrings(obj.egress_domains),
    action_types: uniqueSortedStrings(obj.action_types),
    data_access: {
      read: uniqueSortedStrings(dataAccessRaw?.read),
      write: uniqueSortedStrings(dataAccessRaw?.write),
    },
  };

  if (!scopes.rooms?.length) delete scopes.rooms;
  if (!scopes.tools?.length) delete scopes.tools;
  if (!scopes.egress_domains?.length) delete scopes.egress_domains;
  if (!scopes.action_types?.length) delete scopes.action_types;
  if (!scopes.data_access?.read?.length && !scopes.data_access?.write?.length) {
    delete scopes.data_access;
  } else {
    if (!scopes.data_access?.read?.length) delete scopes.data_access?.read;
    if (!scopes.data_access?.write?.length) delete scopes.data_access?.write;
  }

  return scopes;
}

function parseCostImpact(value: unknown): CostImpact {
  if (value === "medium" || value === "high") return value;
  return "low";
}

function parseRecoveryDifficulty(value: unknown): RecoveryDifficulty {
  if (value === "moderate" || value === "hard") return value;
  return "easy";
}

function readActionMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function actionCostImpact(row: ActionPolicyRow): CostImpact {
  return parseCostImpact(row.metadata.cost_impact);
}

function actionRecoveryDifficulty(row: ActionPolicyRow): RecoveryDifficulty {
  return parseRecoveryDifficulty(row.metadata.recovery_difficulty);
}

function isWriteAction(action: string): boolean {
  const v = action.toLowerCase();
  return (
    v.includes("write") ||
    v.includes("create") ||
    v.includes("update") ||
    v.includes("delete") ||
    v.includes("mutating")
  );
}

function isHighStakesAction(action: string): boolean {
  const v = action.toLowerCase();
  return (
    v.includes("high_stakes") ||
    v.includes("payment") ||
    v.includes("wallet") ||
    v.includes("transfer") ||
    v.includes("email.send") ||
    v.includes("delete") ||
    v.includes("mutating")
  );
}

function dedupeBasisCodes(items: ApprovalBasisCode[]): ApprovalBasisCode[] {
  return [...new Set(items)];
}

function emptyScopeUnion(): ScopeUnion {
  return {
    rooms: [],
    tools: [],
    data_read: [],
    data_write: [],
    egress: [],
    actions: [],
  };
}

function scopeUnionFromScopes(scopesList: CapabilityScopesV1[]): ScopeUnion {
  const rooms = new Set<string>();
  const tools = new Set<string>();
  const dataRead = new Set<string>();
  const dataWrite = new Set<string>();
  const egress = new Set<string>();
  const actions = new Set<string>();

  for (const scope of scopesList) {
    for (const v of scope.rooms ?? []) rooms.add(v);
    for (const v of scope.tools ?? []) tools.add(v);
    for (const v of scope.data_access?.read ?? []) dataRead.add(v);
    for (const v of scope.data_access?.write ?? []) dataWrite.add(v);
    for (const v of scope.egress_domains ?? []) egress.add(v);
    for (const v of scope.action_types ?? []) actions.add(v);
  }

  return {
    rooms: [...rooms].sort((a, b) => a.localeCompare(b)),
    tools: [...tools].sort((a, b) => a.localeCompare(b)),
    data_read: [...dataRead].sort((a, b) => a.localeCompare(b)),
    data_write: [...dataWrite].sort((a, b) => a.localeCompare(b)),
    egress: [...egress].sort((a, b) => a.localeCompare(b)),
    actions: [...actions].sort((a, b) => a.localeCompare(b)),
  };
}

async function loadActiveScopeUnion(pool: DbPool, workspace_id: string, principal_id: string): Promise<ScopeUnion> {
  const tokenRows = await pool.query<{ scopes: unknown }>(
    `SELECT scopes
     FROM sec_capability_tokens
     WHERE workspace_id = $1
       AND issued_to_principal_id = $2
       AND revoked_at IS NULL
       AND (valid_until IS NULL OR valid_until > now())`,
    [workspace_id, principal_id],
  );

  if (tokenRows.rowCount === 0) return emptyScopeUnion();
  const scopesList = tokenRows.rows.map((row) => normalizeScopes(row.scopes));
  return scopeUnionFromScopes(scopesList);
}

async function loadActionPolicyRows(
  pool: DbPool,
  actionTypes: string[],
): Promise<ActionPolicyRow[]> {
  if (!actionTypes.length) return [];

  const rows = await pool.query<{
    action_type: string;
    reversible: boolean;
    zone_required: string;
    requires_pre_approval: boolean;
    post_review_required: boolean;
    metadata: unknown;
  }>(
    `SELECT
       action_type,
       reversible,
       zone_required,
       requires_pre_approval,
       post_review_required,
       metadata
     FROM sec_action_registry
     WHERE action_type = ANY($1::text[])
     ORDER BY action_type ASC`,
    [actionTypes],
  );

  return rows.rows
    .filter((row) => row.zone_required === "sandbox" || row.zone_required === "supervised" || row.zone_required === "high_stakes")
    .map((row) => ({
      action_type: row.action_type,
      reversible: row.reversible,
      zone_required: row.zone_required as ActionZone,
      requires_pre_approval: row.requires_pre_approval,
      post_review_required: row.post_review_required,
      metadata: readActionMetadata(row.metadata),
    }));
}

function buildActionPolicyFlags(rows: ActionPolicyRow[]): ActionPolicyFlags {
  const highStakes = rows.filter((r) => r.zone_required === "high_stakes").length;
  const supervised = rows.filter((r) => r.zone_required === "supervised").length;
  const sandbox = rows.filter((r) => r.zone_required === "sandbox").length;
  const preRequired = rows.some((r) => r.requires_pre_approval);
  const postRequired = rows.some((r) => r.post_review_required);
  const irreversible = rows.some((r) => !r.reversible);
  const reversible = rows.filter((r) => r.reversible).length;
  const highCost = rows.filter((r) => actionCostImpact(r) === "high").length;
  const mediumCost = rows.filter((r) => actionCostImpact(r) === "medium").length;
  const hardRecovery = rows.filter((r) => actionRecoveryDifficulty(r) === "hard").length;
  const moderateRecovery = rows.filter((r) => actionRecoveryDifficulty(r) === "moderate").length;

  return {
    highStakes,
    supervised,
    sandbox,
    preRequired,
    postRequired,
    irreversible,
    reversible,
    highCost,
    mediumCost,
    hardRecovery,
    moderateRecovery,
  };
}

function computeApprovalModeRecommendations(input: {
  trustScore: number;
  scopeUnion: ScopeUnion;
  actionPolicyFlags: ActionPolicyFlags;
  isQuarantined: boolean;
  repeatedMistakes7d: number;
  autonomyRate7d: number | null;
  assessmentFailures7d: number;
  assessmentPassRate30d: number | null;
  assessmentCompleted30d: number;
}): Array<{ target: ApprovalTargetCode; mode: ApprovalModeCode; basis_codes: ApprovalBasisCode[] }> {
  const {
    trustScore,
    scopeUnion,
    actionPolicyFlags,
    isQuarantined,
    repeatedMistakes7d,
    autonomyRate7d,
    assessmentFailures7d,
    assessmentPassRate30d,
    assessmentCompleted30d,
  } = input;

  const hasWriteScope = scopeUnion.data_write.length > 0 || scopeUnion.actions.some((a) => isWriteAction(a));
  const hasExternalScope = scopeUnion.egress.length > 0;
  const hasHighStakesScope =
    actionPolicyFlags.highStakes > 0 || scopeUnion.actions.some((a) => isHighStakesAction(a));
  const hasRepeatedMistakeRisk = repeatedMistakes7d >= 2;
  const hasLowAutonomyRisk = autonomyRate7d != null && autonomyRate7d < 0.5;
  const hasAssessmentRegressionRisk =
    assessmentFailures7d >= 2 ||
    (assessmentCompleted30d >= 3 && assessmentPassRate30d != null && assessmentPassRate30d < 0.6);
  const hasHighCostRisk = actionPolicyFlags.highCost > 0;
  const hasMediumCostRisk = actionPolicyFlags.mediumCost > 0;
  const hasHardRecoveryRisk = actionPolicyFlags.hardRecovery > 0;

  let internalWriteMode: ApprovalModeCode = "blocked";
  let internalBasis: ApprovalBasisCode[] = [];
  if (hasWriteScope) {
    if (isQuarantined) {
      internalWriteMode = "pre";
      internalBasis = ["quarantine"];
    } else if (actionPolicyFlags.preRequired || actionPolicyFlags.highStakes > 0 || actionPolicyFlags.irreversible) {
      internalWriteMode = "pre";
      internalBasis = ["pre_required"];
      if (actionPolicyFlags.irreversible) internalBasis.push("irreversible");
      if (actionPolicyFlags.highStakes > 0) internalBasis.push("high_stakes");
    } else if (actionPolicyFlags.postRequired) {
      internalWriteMode = "post";
      internalBasis = ["post_required"];
    } else if (trustScore >= 0.75) {
      internalWriteMode = "auto";
      internalBasis = ["high_trust"];
    } else if (trustScore >= 0.45) {
      internalWriteMode = "post";
      internalBasis = ["default"];
    } else {
      internalWriteMode = "pre";
      internalBasis = ["default"];
    }

    if (hasHighCostRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      if (internalWriteMode === "post") internalWriteMode = "pre";
      internalBasis.push("high_cost");
    }
    if (hasHardRecoveryRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      if (internalWriteMode === "post") internalWriteMode = "pre";
      internalBasis.push("hard_recovery");
    }
    if (hasMediumCostRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      internalBasis.push("medium_cost");
    }
    if (hasRepeatedMistakeRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      internalBasis.push("repeated_mistakes");
    }
    if (hasLowAutonomyRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      if (internalWriteMode === "post") internalWriteMode = "pre";
      internalBasis.push("low_autonomy");
    }
    if (hasAssessmentRegressionRisk) {
      if (internalWriteMode === "auto") internalWriteMode = "post";
      if (internalWriteMode === "post") internalWriteMode = "pre";
      internalBasis.push("assessment_regression");
    }
    internalBasis = dedupeBasisCodes(internalBasis);
  } else {
    internalBasis = ["no_scope"];
  }

  let externalWriteMode: ApprovalModeCode = "blocked";
  let externalBasis: ApprovalBasisCode[] = [];
  if (hasExternalScope) {
    if (isQuarantined) {
      externalWriteMode = "blocked";
      externalBasis = ["quarantine"];
    } else if (actionPolicyFlags.preRequired || actionPolicyFlags.highStakes > 0) {
      externalWriteMode = "pre";
      externalBasis = ["pre_required"];
      if (actionPolicyFlags.highStakes > 0) externalBasis.push("high_stakes");
    } else if (actionPolicyFlags.postRequired) {
      externalWriteMode = "post";
      externalBasis = ["post_required"];
    } else if (trustScore >= 0.85 && !actionPolicyFlags.irreversible) {
      externalWriteMode = "auto";
      externalBasis = ["high_trust"];
    } else {
      externalWriteMode = "post";
      externalBasis = ["default"];
    }

    if (hasHighCostRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      if (externalWriteMode === "post") externalWriteMode = "pre";
      externalBasis.push("high_cost");
    }
    if (hasHardRecoveryRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      if (externalWriteMode === "post") externalWriteMode = "pre";
      externalBasis.push("hard_recovery");
    }
    if (hasMediumCostRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      externalBasis.push("medium_cost");
    }
    if (hasRepeatedMistakeRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      if (externalWriteMode === "post") externalWriteMode = "pre";
      externalBasis.push("repeated_mistakes");
    }
    if (hasLowAutonomyRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      if (externalWriteMode === "post") externalWriteMode = "pre";
      externalBasis.push("low_autonomy");
    }
    if (hasAssessmentRegressionRisk) {
      if (externalWriteMode === "auto") externalWriteMode = "post";
      if (externalWriteMode === "post") externalWriteMode = "pre";
      externalBasis.push("assessment_regression");
    }
    externalBasis = dedupeBasisCodes(externalBasis);
  } else {
    externalBasis = ["no_scope"];
  }

  let highStakesMode: ApprovalModeCode = "blocked";
  let highStakesBasis: ApprovalBasisCode[] = ["high_stakes"];
  if (hasHighStakesScope) {
    highStakesMode = isQuarantined ? "blocked" : "pre";
    if (isQuarantined) highStakesBasis.push("quarantine");
    if (hasHighCostRisk) highStakesBasis.push("high_cost");
    if (hasHardRecoveryRisk) highStakesBasis.push("hard_recovery");
    if (hasMediumCostRisk) highStakesBasis.push("medium_cost");
  } else {
    highStakesBasis = ["no_scope"];
  }

  return [
    { target: "internal_write", mode: internalWriteMode, basis_codes: dedupeBasisCodes(internalBasis) },
    { target: "external_write", mode: externalWriteMode, basis_codes: dedupeBasisCodes(externalBasis) },
    { target: "high_stakes", mode: highStakesMode, basis_codes: dedupeBasisCodes(highStakesBasis) },
  ];
}

function suggestionFromScore(score: number): CapabilityScopesV1 {
  if (score >= 0.7) {
    return {
      tools: ["web_search", "code_exec"],
      action_types: ["artifact.create", "artifact.update"],
      data_access: { write: ["artifacts"] },
    };
  }
  if (score >= 0.5) {
    return {
      tools: ["web_search"],
      action_types: ["artifact.create"],
    };
  }
  return {};
}

function daysSince(iso: string): number {
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return 0;
  const diffMs = Date.now() - start;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function computeTrustScore(components: TrustComponentsV1): number {
  const success = clamp01(components.success_rate_7d);
  const evalNorm = clamp01((components.eval_quality_trend + 1) / 2);
  const feedback = clamp01(components.user_feedback_score);
  const violationsPenalty = clamp01(components.policy_violations_7d / 10);
  const tenure = clamp01(components.time_in_service_days / 30);

  const raw = 0.4 * success + 0.2 * evalNorm + 0.2 * feedback + 0.2 * tenure - 0.3 * violationsPenalty;
  return clamp01(raw);
}

async function getAgent(
  pool: DbPool,
  _workspace_id: string,
  agent_id: string,
): Promise<{
  agent_id: string;
  principal_id: string;
  created_at: string;
  quarantined_at: string | null;
  quarantine_reason: string | null;
} | null> {
  const agent = await pool.query<{
    agent_id: string;
    principal_id: string;
    created_at: string;
    quarantined_at: string | null;
    quarantine_reason: string | null;
  }>(
    `SELECT agent_id, principal_id, created_at, quarantined_at, quarantine_reason
     FROM sec_agents
     WHERE agent_id = $1`,
    [agent_id],
  );
  if (agent.rowCount !== 1) return null;
  return agent.rows[0];
}

async function fallbackSuccessRate(pool: DbPool, workspace_id: string): Promise<number> {
  const res = await pool.query<{ total: string; succeeded: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type IN ('run.completed', 'run.failed')) AS total,
       COUNT(*) FILTER (WHERE event_type = 'run.completed') AS succeeded
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type IN ('run.completed', 'run.failed')
       AND occurred_at >= now() - interval '7 days'`,
    [workspace_id],
  );
  const total = Number(res.rows[0]?.total ?? "0");
  const succeeded = Number(res.rows[0]?.succeeded ?? "0");
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return clamp01(succeeded / total);
}

async function loadSignalDefaults(
  pool: DbPool,
  workspace_id: string,
  principal_id: string,
  created_at: string,
): Promise<TrustComponentsV1> {
  const runStats = await pool.query<{ total: string; succeeded: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type IN ('run.completed', 'run.failed')) AS total,
       COUNT(*) FILTER (WHERE event_type = 'run.completed') AS succeeded
     FROM evt_events
     WHERE workspace_id = $1
       AND actor_principal_id = $2
       AND event_type IN ('run.completed', 'run.failed')
       AND occurred_at >= now() - interval '7 days'`,
    [workspace_id, principal_id],
  );

  const totalRuns = Number(runStats.rows[0]?.total ?? "0");
  const succeededRuns = Number(runStats.rows[0]?.succeeded ?? "0");
  let success_rate_7d =
    Number.isFinite(totalRuns) && totalRuns > 0 ? clamp01(succeededRuns / totalRuns) : await fallbackSuccessRate(pool, workspace_id);

  if (!Number.isFinite(success_rate_7d)) success_rate_7d = 0.5;

  const violations = await pool.query<{ cnt: string }>(
    `WITH filtered AS (
       SELECT
         event_type,
         date_trunc('hour', occurred_at) AS hour_bucket,
         COALESCE(NULLIF(data->>'reason_code', ''), 'unknown') AS reason_code,
         COALESCE(NULLIF(data->>'action', ''), event_type) AS action_key
       FROM evt_events
       WHERE workspace_id = $1
         AND actor_principal_id = $2
         AND event_type IN ('egress.blocked', 'data.access.denied', 'policy.denied')
         AND occurred_at >= now() - interval '7 days'
         AND (
           NOT (data ? 'blocked')
           OR lower(COALESCE(data->>'blocked', 'true')) = 'true'
         )
         AND COALESCE(data->>'reason_code', '') NOT IN ('agent_quarantined', 'kill_switch_active')
     )
     SELECT COUNT(*)::text AS cnt
     FROM (
       SELECT DISTINCT event_type, reason_code, action_key, hour_bucket
       FROM filtered
     ) dedup`,
    [workspace_id, principal_id],
  );
  const policy_violations_7d = Math.max(0, Number(violations.rows[0]?.cnt ?? "0"));

  const feedback = await pool.query<{ approved: string; denied: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved') AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected') AS denied
     FROM sec_autonomy_recommendations
     WHERE workspace_id = $1
       AND recommended_by_principal_id = $2`,
    [workspace_id, principal_id],
  );
  const approved = Number(feedback.rows[0]?.approved ?? "0");
  const denied = Number(feedback.rows[0]?.denied ?? "0");
  const user_feedback_score = approved + denied > 0 ? clamp01(approved / (approved + denied)) : 0.5;

  return {
    success_rate_7d,
    eval_quality_trend: 0,
    user_feedback_score,
    policy_violations_7d,
    time_in_service_days: daysSince(created_at),
  };
}

function applySignalOverrides(
  defaults: TrustComponentsV1,
  overrides: Partial<TrustComponentsV1> | undefined,
): TrustComponentsV1 {
  if (!overrides) return defaults;

  return {
    success_rate_7d:
      overrides.success_rate_7d == null ? defaults.success_rate_7d : clamp01(overrides.success_rate_7d),
    eval_quality_trend:
      overrides.eval_quality_trend == null
        ? defaults.eval_quality_trend
        : clampSigned(overrides.eval_quality_trend, -1, 1),
    user_feedback_score:
      overrides.user_feedback_score == null ? defaults.user_feedback_score : clamp01(overrides.user_feedback_score),
    policy_violations_7d:
      overrides.policy_violations_7d == null
        ? defaults.policy_violations_7d
        : Math.max(0, Math.floor(overrides.policy_violations_7d)),
    time_in_service_days:
      overrides.time_in_service_days == null
        ? defaults.time_in_service_days
        : Math.max(0, Math.floor(overrides.time_in_service_days)),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSignalOverrides(raw: unknown): Partial<TrustComponentsV1> {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const success_rate_7d = parseMaybeNumber(obj.success_rate_7d);
  const eval_quality_trend = parseMaybeNumber(obj.eval_quality_trend);
  const user_feedback_score = parseMaybeNumber(obj.user_feedback_score);
  const policy_violations_7d = parseMaybeNumber(obj.policy_violations_7d);
  const time_in_service_days = parseMaybeNumber(obj.time_in_service_days);

  const out: Partial<TrustComponentsV1> = {};
  if (success_rate_7d != null) out.success_rate_7d = success_rate_7d;
  if (eval_quality_trend != null) out.eval_quality_trend = eval_quality_trend;
  if (user_feedback_score != null) out.user_feedback_score = user_feedback_score;
  if (policy_violations_7d != null) out.policy_violations_7d = policy_violations_7d;
  if (time_in_service_days != null) out.time_in_service_days = time_in_service_days;
  return out;
}

async function getCurrentTrust(
  pool: DbPool,
  workspace_id: string,
  agent: { agent_id: string; principal_id: string; created_at: string },
): Promise<{
  trust_score: number;
  success_rate_7d: number;
  eval_quality_trend: number;
  user_feedback_score: number;
  policy_violations_7d: number;
  time_in_service_days: number;
  components: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_recalculated_at: string;
}> {
  const existing = await pool.query<{
    trust_score: number;
    success_rate_7d: number;
    eval_quality_trend: number;
    user_feedback_score: number;
    policy_violations_7d: number;
    time_in_service_days: number;
    components: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    last_recalculated_at: string;
  }>(
    `SELECT
       trust_score,
       success_rate_7d,
       eval_quality_trend,
       user_feedback_score,
       policy_violations_7d,
       time_in_service_days,
       components,
       created_at,
       updated_at,
       last_recalculated_at
     FROM sec_agent_trust
     WHERE agent_id = $1`,
    [agent.agent_id],
  );
  if (existing.rowCount === 1) return existing.rows[0];

  const defaults = await loadSignalDefaults(pool, workspace_id, agent.principal_id, agent.created_at);
  const trust_score = computeTrustScore(defaults);
  const now = nowIso();

  await pool.query(
    `INSERT INTO sec_agent_trust (
       agent_id,
       workspace_id,
       trust_score,
       success_rate_7d,
       eval_quality_trend,
       user_feedback_score,
       policy_violations_7d,
       time_in_service_days,
       components,
       last_recalculated_at,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10,$10
     )`,
    [
      agent.agent_id,
      workspace_id,
      trust_score,
      defaults.success_rate_7d,
      defaults.eval_quality_trend,
      defaults.user_feedback_score,
      defaults.policy_violations_7d,
      defaults.time_in_service_days,
      JSON.stringify(defaults),
      now,
    ],
  );

  return {
    trust_score,
    success_rate_7d: defaults.success_rate_7d,
    eval_quality_trend: defaults.eval_quality_trend,
    user_feedback_score: defaults.user_feedback_score,
    policy_violations_7d: defaults.policy_violations_7d,
    time_in_service_days: defaults.time_in_service_days,
    components: { ...defaults },
    created_at: now,
    updated_at: now,
    last_recalculated_at: now,
  };
}

function recommendationRationale(scoreBefore: number, scoreAfter: number): string {
  if (scoreAfter > scoreBefore + TRUST_EPSILON) {
    return `Trust increased from ${scoreBefore.toFixed(3)} to ${scoreAfter.toFixed(3)}. Recommend autonomy upgrade.`;
  }
  if (scoreAfter + TRUST_EPSILON < scoreBefore) {
    return `Trust decreased from ${scoreBefore.toFixed(3)} to ${scoreAfter.toFixed(3)}. Keep upgrade narrow.`;
  }
  return `Trust is stable at ${scoreAfter.toFixed(3)}. Upgrade recommendation is conservative.`;
}

export async function registerTrustRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Params: { agentId: string };
  }>("/v1/agents/:agentId/trust", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await getAgent(pool, workspace_id, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const trust = await getCurrentTrust(pool, workspace_id, agent);
    return reply.code(200).send({
      trust: {
        agent_id,
        workspace_id,
        trust_score: trust.trust_score,
        success_rate_7d: trust.success_rate_7d,
        eval_quality_trend: trust.eval_quality_trend,
        user_feedback_score: trust.user_feedback_score,
        policy_violations_7d: trust.policy_violations_7d,
        time_in_service_days: trust.time_in_service_days,
        components: trust.components ?? {},
        last_recalculated_at: trust.last_recalculated_at,
        created_at: trust.created_at,
        updated_at: trust.updated_at,
      },
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: TrustRecalculateRequestV1;
  }>("/v1/agents/:agentId/trust/recalculate", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await getAgent(pool, workspace_id, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "system");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const current = await getCurrentTrust(pool, workspace_id, agent);
    const defaults = await loadSignalDefaults(pool, workspace_id, agent.principal_id, agent.created_at);
    const nextScore = computeTrustScore(defaults);
    const updatedAt = nowIso();

    await pool.query(
      `UPDATE sec_agent_trust
       SET trust_score = $3,
           success_rate_7d = $4,
           eval_quality_trend = $5,
           user_feedback_score = $6,
           policy_violations_7d = $7,
           time_in_service_days = $8,
           components = $9::jsonb,
           last_recalculated_at = $10,
           updated_at = $10
       WHERE agent_id = $1
         AND workspace_id = $2`,
      [
        agent_id,
        workspace_id,
        nextScore,
        defaults.success_rate_7d,
        defaults.eval_quality_trend,
        defaults.user_feedback_score,
        defaults.policy_violations_7d,
        defaults.time_in_service_days,
        JSON.stringify(defaults),
        updatedAt,
      ],
    );

    const delta = nextScore - current.trust_score;
    if (delta > TRUST_EPSILON) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.trust.increased",
        event_version: 1,
        occurred_at: updatedAt,
        workspace_id,
        actor: { actor_type, actor_id },
        actor_principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: {
          agent_id,
          previous_score: current.trust_score,
          trust_score: nextScore,
          components: defaults,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    } else if (delta < -TRUST_EPSILON) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.trust.decreased",
        event_version: 1,
        occurred_at: updatedAt,
        workspace_id,
        actor: { actor_type, actor_id },
        actor_principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: {
          agent_id,
          previous_score: current.trust_score,
          trust_score: nextScore,
          components: defaults,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    return reply.code(200).send({
      trust: {
        agent_id,
        workspace_id,
        trust_score: nextScore,
        success_rate_7d: defaults.success_rate_7d,
        eval_quality_trend: defaults.eval_quality_trend,
        user_feedback_score: defaults.user_feedback_score,
        policy_violations_7d: defaults.policy_violations_7d,
        time_in_service_days: defaults.time_in_service_days,
        components: defaults,
        last_recalculated_at: updatedAt,
        created_at: current.created_at,
        updated_at: updatedAt,
      },
    });
  });

  app.get<{
    Params: { agentId: string };
  }>("/v1/agents/:agentId/approval-recommendation", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await getAgent(pool, workspace_id, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const trust = await getCurrentTrust(pool, workspace_id, agent);
    const scopeUnion = await loadActiveScopeUnion(pool, workspace_id, agent.principal_id);
    const actionRows = await loadActionPolicyRows(pool, scopeUnion.actions);
    const actionPolicyFlags = buildActionPolicyFlags(actionRows);

    const latestSnapshot = await pool.query<{
      autonomy_rate_7d: number | null;
      repeated_mistakes_7d: number | null;
    }>(
      `SELECT autonomy_rate_7d, repeated_mistakes_7d
       FROM sec_daily_agent_snapshots
       WHERE workspace_id = $1
         AND agent_id = $2
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [workspace_id, agent_id],
    );

    const autonomy_rate_7d =
      latestSnapshot.rowCount === 1 && Number.isFinite(Number(latestSnapshot.rows[0].autonomy_rate_7d))
        ? Number(latestSnapshot.rows[0].autonomy_rate_7d)
        : null;
    const repeated_mistakes_7d =
      latestSnapshot.rowCount === 1 && Number.isFinite(Number(latestSnapshot.rows[0].repeated_mistakes_7d))
        ? Math.max(0, Math.floor(Number(latestSnapshot.rows[0].repeated_mistakes_7d)))
        : 0;

    const assessmentMetrics = await pool.query<{
      assessment_failed_7d: number | null;
      assessment_completed_30d: number | null;
      assessment_passed_30d: number | null;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND started_at >= (now() - interval '7 days')
         ) AS assessment_failed_7d,
         COUNT(*) FILTER (
           WHERE status IN ('passed', 'failed')
             AND started_at >= (now() - interval '30 days')
         ) AS assessment_completed_30d,
         COUNT(*) FILTER (
           WHERE status = 'passed'
             AND started_at >= (now() - interval '30 days')
         ) AS assessment_passed_30d
       FROM sec_skill_assessments
       WHERE workspace_id = $1
         AND agent_id = $2`,
      [workspace_id, agent_id],
    );
    const assessment_failed_7d =
      assessmentMetrics.rowCount === 1 && Number.isFinite(Number(assessmentMetrics.rows[0].assessment_failed_7d))
        ? Math.max(0, Math.floor(Number(assessmentMetrics.rows[0].assessment_failed_7d)))
        : 0;
    const assessment_completed_30d =
      assessmentMetrics.rowCount === 1 &&
      Number.isFinite(Number(assessmentMetrics.rows[0].assessment_completed_30d))
        ? Math.max(0, Math.floor(Number(assessmentMetrics.rows[0].assessment_completed_30d)))
        : 0;
    const assessment_passed_30d =
      assessmentMetrics.rowCount === 1 && Number.isFinite(Number(assessmentMetrics.rows[0].assessment_passed_30d))
        ? Math.max(0, Math.floor(Number(assessmentMetrics.rows[0].assessment_passed_30d)))
        : 0;
    const assessment_pass_rate_30d =
      assessment_completed_30d > 0 ? assessment_passed_30d / assessment_completed_30d : null;
    const is_quarantined = agent.quarantined_at != null;

    const targets = computeApprovalModeRecommendations({
      trustScore: trust.trust_score,
      scopeUnion,
      actionPolicyFlags,
      isQuarantined: is_quarantined,
      repeatedMistakes7d: repeated_mistakes_7d,
      autonomyRate7d: autonomy_rate_7d,
      assessmentFailures7d: assessment_failed_7d,
      assessmentPassRate30d: assessment_pass_rate_30d,
      assessmentCompleted30d: assessment_completed_30d,
    });

    return reply.code(200).send({
      recommendation: {
        workspace_id,
        agent_id,
        targets,
        context: {
          trust_score: trust.trust_score,
          repeated_mistakes_7d,
          autonomy_rate_7d,
          assessment_failed_7d,
          assessment_completed_30d,
          assessment_passed_30d,
          assessment_pass_rate_30d,
          is_quarantined,
          scope_union: scopeUnion,
          action_policy_flags: actionPolicyFlags,
        },
      },
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: AutonomyRecommendRequestV1;
  }>("/v1/agents/:agentId/autonomy/recommend", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const agent = await getAgent(pool, workspace_id, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const actor_type = normalizeActorType(req.body.actor_type);
    const actor_id =
      normalizeOptionalString(req.body.actor_id) || (actor_type === "service" ? "api" : "anon");
    const actor_principal_id = normalizeOptionalString(req.body.actor_principal_id);
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const current = await getCurrentTrust(pool, workspace_id, agent);
    const defaults = await loadSignalDefaults(pool, workspace_id, agent.principal_id, agent.created_at);
    const overrides = normalizeSignalOverrides(req.body.signals);
    const components = applySignalOverrides(defaults, overrides);
    const nextScore = computeTrustScore(components);

    const updatedAt = nowIso();
    await pool.query(
      `UPDATE sec_agent_trust
       SET trust_score = $3,
           success_rate_7d = $4,
           eval_quality_trend = $5,
           user_feedback_score = $6,
           policy_violations_7d = $7,
           time_in_service_days = $8,
           components = $9::jsonb,
           last_recalculated_at = $10,
           updated_at = $10
       WHERE agent_id = $1
         AND workspace_id = $2`,
      [
        agent_id,
        workspace_id,
        nextScore,
        components.success_rate_7d,
        components.eval_quality_trend,
        components.user_feedback_score,
        components.policy_violations_7d,
        components.time_in_service_days,
        JSON.stringify(components),
        updatedAt,
      ],
    );

    const delta = nextScore - current.trust_score;
    if (delta > TRUST_EPSILON) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.trust.increased",
        event_version: 1,
        occurred_at: updatedAt,
        workspace_id,
        actor: { actor_type, actor_id },
        actor_principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: {
          agent_id,
          previous_score: current.trust_score,
          trust_score: nextScore,
          components,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    } else if (delta < -TRUST_EPSILON) {
      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "agent.trust.decreased",
        event_version: 1,
        occurred_at: updatedAt,
        workspace_id,
        actor: { actor_type, actor_id },
        actor_principal_id,
        stream: { stream_type: "workspace", stream_id: workspace_id },
        correlation_id,
        data: {
          agent_id,
          previous_score: current.trust_score,
          trust_score: nextScore,
          components,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });
    }

    const scope_delta = normalizeScopes(req.body.scope_delta ?? suggestionFromScore(nextScore));
    const rationale =
      normalizeOptionalString(req.body.rationale) ?? recommendationRationale(current.trust_score, nextScore);

    const pendingExisting = await pool.query<{
      recommendation_id: string;
      created_at: string;
    }>(
      `SELECT recommendation_id, created_at
       FROM sec_autonomy_recommendations
       WHERE workspace_id = $1
         AND agent_id = $2
         AND status = 'pending'
       LIMIT 1`,
      [workspace_id, agent_id],
    );

    const recommendation_id =
      pendingExisting.rowCount === 1
        ? pendingExisting.rows[0].recommendation_id
        : `arec_${randomUUID().replaceAll("-", "")}`;
    const created_at = pendingExisting.rowCount === 1 ? pendingExisting.rows[0].created_at : updatedAt;

    if (pendingExisting.rowCount === 1) {
      await pool.query(
        `UPDATE sec_autonomy_recommendations
         SET scope_delta = $3::jsonb,
             rationale = $4,
             trust_score_before = $5,
             trust_score_after = $6,
             trust_components = $7::jsonb,
             recommended_by_type = $8,
             recommended_by_id = $9,
             recommended_by_principal_id = $10,
             updated_at = $11
         WHERE recommendation_id = $1
           AND workspace_id = $2`,
        [
          recommendation_id,
          workspace_id,
          JSON.stringify(scope_delta),
          rationale,
          current.trust_score,
          nextScore,
          JSON.stringify(components),
          actor_type,
          actor_id,
          actor_principal_id ?? null,
          updatedAt,
        ],
      );
    } else {
      await pool.query(
        `INSERT INTO sec_autonomy_recommendations (
           recommendation_id,
           workspace_id,
           agent_id,
           status,
           scope_delta,
           rationale,
           trust_score_before,
           trust_score_after,
           trust_components,
           recommended_by_type,
           recommended_by_id,
           recommended_by_principal_id,
           created_at,
           updated_at
         ) VALUES (
           $1,$2,$3,'pending',$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$12
         )`,
        [
          recommendation_id,
          workspace_id,
          agent_id,
          JSON.stringify(scope_delta),
          rationale,
          current.trust_score,
          nextScore,
          JSON.stringify(components),
          actor_type,
          actor_id,
          actor_principal_id ?? null,
          updatedAt,
        ],
      );
    }

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "autonomy.upgrade.recommended",
      event_version: 1,
      occurred_at: updatedAt,
      workspace_id,
      actor: { actor_type, actor_id },
      actor_principal_id,
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        recommendation_id,
        agent_id,
        scope_delta,
        rationale,
        trust_score_before: current.trust_score,
        trust_score_after: nextScore,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(pendingExisting.rowCount === 1 ? 200 : 201).send({
      recommendation: {
        recommendation_id,
        workspace_id,
        agent_id,
        status: "pending",
        scope_delta,
        rationale,
        trust_score_before: current.trust_score,
        trust_score_after: nextScore,
        trust_components: components,
        created_at,
        updated_at: updatedAt,
      },
      trust: {
        agent_id,
        workspace_id,
        trust_score: nextScore,
        success_rate_7d: components.success_rate_7d,
        eval_quality_trend: components.eval_quality_trend,
        user_feedback_score: components.user_feedback_score,
        policy_violations_7d: components.policy_violations_7d,
        time_in_service_days: components.time_in_service_days,
        components,
        last_recalculated_at: updatedAt,
        created_at: current.created_at,
        updated_at: updatedAt,
      },
    });
  });

  app.post<{
    Params: { agentId: string };
    Body: AutonomyApproveRequestV1;
  }>("/v1/agents/:agentId/autonomy/approve", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const agent_id = normalizeRequiredString(req.params.agentId);
    if (!agent_id) return reply.code(400).send({ error: "invalid_agent_id" });

    const recommendation_id = normalizeRequiredString(req.body.recommendation_id);
    const granted_by_principal_id = normalizeRequiredString(req.body.granted_by_principal_id);
    if (!recommendation_id) return reply.code(400).send({ error: "recommendation_id_required" });
    if (!granted_by_principal_id) {
      return reply.code(400).send({ error: "granted_by_principal_id_required" });
    }

    const valid_until = parseTimestamp(req.body.valid_until);
    if (req.body.valid_until && !valid_until) {
      return reply.code(400).send({ error: "invalid_valid_until" });
    }
    const correlation_id = normalizeOptionalString(req.body.correlation_id) ?? randomUUID();

    const agent = await getAgent(pool, workspace_id, agent_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });

    const grantPrincipal = await pool.query<{ principal_id: string }>(
      "SELECT principal_id FROM sec_principals WHERE principal_id = $1 AND revoked_at IS NULL",
      [granted_by_principal_id],
    );
    if (grantPrincipal.rowCount !== 1) {
      return reply.code(404).send({ error: "granted_by_principal_not_found" });
    }

    const rec = await pool.query<{
      recommendation_id: string;
      status: "pending" | "approved" | "rejected";
      scope_delta: CapabilityScopesV1;
      approved_token_id: string | null;
    }>(
      `SELECT recommendation_id, status, scope_delta, approved_token_id
       FROM sec_autonomy_recommendations
       WHERE workspace_id = $1
         AND agent_id = $2
         AND recommendation_id = $3`,
      [workspace_id, agent_id, recommendation_id],
    );
    if (rec.rowCount !== 1) return reply.code(404).send({ error: "recommendation_not_found" });

    const recommendation = rec.rows[0];
    if (recommendation.status === "approved" && recommendation.approved_token_id) {
      return reply.code(200).send({
        recommendation_id,
        token_id: recommendation.approved_token_id,
        already_approved: true,
      });
    }
    if (recommendation.status !== "pending") {
      return reply.code(409).send({ error: "recommendation_not_pending" });
    }

    const occurred_at = nowIso();
    const token_id = randomUUID();
    await pool.query(
      `INSERT INTO sec_capability_tokens (
         token_id,
         workspace_id,
         issued_to_principal_id,
         granted_by_principal_id,
         parent_token_id,
         scopes,
         valid_until,
         created_at
       ) VALUES (
         $1,$2,$3,$4,NULL,$5::jsonb,$6,$7
       )`,
      [
        token_id,
        workspace_id,
        agent.principal_id,
        granted_by_principal_id,
        JSON.stringify(normalizeScopes(recommendation.scope_delta ?? {})),
        valid_until,
        occurred_at,
      ],
    );

    await pool.query(
      `UPDATE sec_autonomy_recommendations
       SET status = 'approved',
           approved_by_principal_id = $4,
           approved_token_id = $5,
           approved_at = $6,
           updated_at = $6
       WHERE workspace_id = $1
         AND agent_id = $2
         AND recommendation_id = $3`,
      [workspace_id, agent_id, recommendation_id, granted_by_principal_id, token_id, occurred_at],
    );

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.capability.granted",
      event_version: 1,
      occurred_at,
      workspace_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        token_id,
        issued_to_principal_id: agent.principal_id,
        granted_by_principal_id,
        parent_token_id: null,
        scopes: normalizeScopes(recommendation.scope_delta ?? {}),
        valid_until,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "autonomy.upgrade.approved",
      event_version: 1,
      occurred_at,
      workspace_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        recommendation_id,
        agent_id,
        token_id,
        granted_by_principal_id,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({
      recommendation_id,
      token_id,
    });
  });
}
