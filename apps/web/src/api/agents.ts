import type {
  AgentGetResponseV1,
  AgentListResponseV1,
  AgentQuarantineRequestV1,
  AgentQuarantineResponseV1,
  AgentRecordV1,
  AgentRegisterRequestV1,
  AgentRegisterResponseV1,
  AgentSkillCertifyImportedRequestV1,
  AgentSkillCertifyImportedResponseV1,
  AgentSkillAssessImportedRequestV1,
  AgentSkillAssessImportedResponseV1,
  AgentSkillImportRequestV1,
  AgentSkillImportCertifyRequestV1,
  AgentSkillImportCertifyResponseV1,
  AgentSkillOnboardingStatusItemV1,
  AgentSkillOnboardingStatusListResponseV1,
  AgentSkillImportResponseV1,
  AgentSkillOnboardingStatusResponseV1,
  AgentSkillReviewPendingRequestV1,
  AgentSkillReviewPendingResponseV1,
  AgentUnquarantineResponseV1,
  AutonomyApproveRequestV1,
  AutonomyApproveResponseV1,
  AutonomyRecommendRequestV1,
  AutonomyRecommendResponseV1,
  CapabilityScopesV1,
} from "@agentapp/shared";

import type { EventRow } from "./events";
import { listEvents } from "./events";
import { apiGet, apiPost } from "./http";

export type RegisteredAgent = AgentRecordV1;

export interface RegisteredAgentPage {
  agents: RegisteredAgent[];
  next_cursor?: string;
  has_more: boolean;
}

export async function listRegisteredAgentsPage(params?: {
  limit?: number;
  cursor?: string;
  q?: string;
}): Promise<RegisteredAgentPage> {
  const query = new URLSearchParams();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params?.limit ?? 200))));
  query.set("limit", String(limit));
  if (typeof params?.cursor === "string" && params.cursor.trim().length) {
    query.set("cursor", params.cursor.trim());
  }
  if (typeof params?.q === "string" && params.q.trim().length) {
    query.set("q", params.q.trim().slice(0, 128));
  }
  const res = await apiGet<AgentListResponseV1>(`/v1/agents?${query.toString()}`);
  const next_cursor =
    typeof res.next_cursor === "string" && res.next_cursor.trim().length ? res.next_cursor.trim() : undefined;
  return {
    agents: res.agents ?? [],
    next_cursor,
    has_more: res.has_more === true && Boolean(next_cursor),
  };
}

export async function listRegisteredAgents(params?: {
  limit?: number;
  cursor?: string;
  q?: string;
}): Promise<RegisteredAgent[]> {
  const res = await listRegisteredAgentsPage(params);
  return res.agents;
}

export async function getAgent(agent_id: string): Promise<AgentRecordV1> {
  const res = await apiGet<AgentGetResponseV1>(`/v1/agents/${encodeURIComponent(agent_id)}`);
  return res.agent;
}

export async function registerAgent(payload: AgentRegisterRequestV1): Promise<AgentRegisterResponseV1> {
  return await apiPost<AgentRegisterResponseV1>("/v1/agents", payload);
}

export async function quarantineAgent(
  agent_id: string,
  payload: AgentQuarantineRequestV1,
): Promise<AgentQuarantineResponseV1> {
  return await apiPost<AgentQuarantineResponseV1>(`/v1/agents/${encodeURIComponent(agent_id)}/quarantine`, payload);
}

export async function unquarantineAgent(agent_id: string): Promise<AgentUnquarantineResponseV1> {
  return await apiPost<AgentUnquarantineResponseV1>(`/v1/agents/${encodeURIComponent(agent_id)}/unquarantine`, {});
}

export async function importAgentSkills(
  agent_id: string,
  payload: AgentSkillImportRequestV1,
): Promise<AgentSkillImportResponseV1> {
  return await apiPost<AgentSkillImportResponseV1>(`/v1/agents/${encodeURIComponent(agent_id)}/skills/import`, payload);
}

export async function importAndCertifyAgentSkills(
  agent_id: string,
  payload: AgentSkillImportCertifyRequestV1,
): Promise<AgentSkillImportCertifyResponseV1> {
  return await apiPost<AgentSkillImportCertifyResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/skills/import-certify`,
    payload,
  );
}

export async function getAgentSkillOnboardingStatus(
  agent_id: string,
): Promise<AgentSkillOnboardingStatusResponseV1> {
  return await apiGet<AgentSkillOnboardingStatusResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/skills/onboarding-status`,
  );
}

export async function listAgentSkillOnboardingStatuses(params?: {
  limit?: number;
  only_with_work?: boolean;
  agent_ids?: string[];
}): Promise<AgentSkillOnboardingStatusItemV1[]> {
  const query = new URLSearchParams();
  const limit = params?.limit;
  if (typeof limit === "number" && Number.isFinite(limit)) {
    query.set("limit", String(Math.max(1, Math.min(500, Math.floor(limit)))));
  }
  if (params?.only_with_work) query.set("only_with_work", "1");
  if (Array.isArray(params?.agent_ids)) {
    const unique = new Set<string>();
    for (const agent_id of params.agent_ids) {
      if (typeof agent_id !== "string") continue;
      const normalized = agent_id.trim();
      if (!normalized) continue;
      if (unique.has(normalized)) continue;
      unique.add(normalized);
      query.append("agent_ids", normalized);
      if (unique.size >= 500) break;
    }
  }
  const path = query.toString().length
    ? `/v1/agents/skills/onboarding-statuses?${query.toString()}`
    : "/v1/agents/skills/onboarding-statuses";
  const res = await apiGet<AgentSkillOnboardingStatusListResponseV1>(path);
  return res.items ?? [];
}

export async function reviewPendingAgentSkills(
  agent_id: string,
  payload: AgentSkillReviewPendingRequestV1 = {},
): Promise<AgentSkillReviewPendingResponseV1> {
  return await apiPost<AgentSkillReviewPendingResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/skills/review-pending`,
    payload,
  );
}

export async function assessImportedAgentSkills(
  agent_id: string,
  payload: AgentSkillAssessImportedRequestV1 = {},
): Promise<AgentSkillAssessImportedResponseV1> {
  return await apiPost<AgentSkillAssessImportedResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/skills/assess-imported`,
    payload,
  );
}

export async function certifyImportedAgentSkills(
  agent_id: string,
  payload: AgentSkillCertifyImportedRequestV1 = {},
): Promise<AgentSkillCertifyImportedResponseV1> {
  return await apiPost<AgentSkillCertifyImportedResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/skills/certify-imported`,
    payload,
  );
}

export interface AgentTrustRow {
  agent_id: string;
  workspace_id: string;
  trust_score: number;
  success_rate_7d: number;
  eval_quality_trend: number;
  user_feedback_score: number;
  policy_violations_7d: number;
  time_in_service_days: number;
  components: Record<string, unknown>;
  last_recalculated_at: string;
  created_at: string;
  updated_at: string;
}

export async function getAgentTrust(agent_id: string): Promise<AgentTrustRow> {
  const res = await apiGet<{ trust: AgentTrustRow }>(`/v1/agents/${encodeURIComponent(agent_id)}/trust`);
  return res.trust;
}

export type ApprovalRecommendationMode = "auto" | "post" | "pre" | "blocked";
export type ApprovalRecommendationTarget = "internal_write" | "external_write" | "high_stakes";
export type ApprovalRecommendationBasisCode =
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

export interface AgentApprovalRecommendationTargetRow {
  target: ApprovalRecommendationTarget;
  mode: ApprovalRecommendationMode;
  basis_codes: ApprovalRecommendationBasisCode[];
}

export interface AgentApprovalRecommendationContext {
  trust_score: number;
  repeated_mistakes_7d: number;
  autonomy_rate_7d: number | null;
  assessment_failed_7d: number;
  assessment_completed_30d: number;
  assessment_passed_30d: number;
  assessment_pass_rate_30d: number | null;
  is_quarantined: boolean;
  scope_union: {
    rooms: string[];
    tools: string[];
    data_read: string[];
    data_write: string[];
    egress: string[];
    actions: string[];
  };
  action_policy_flags: {
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
}

export interface AgentApprovalRecommendationRow {
  workspace_id: string;
  agent_id: string;
  targets: AgentApprovalRecommendationTargetRow[];
  context: AgentApprovalRecommendationContext;
}

export async function getAgentApprovalRecommendation(agent_id: string): Promise<AgentApprovalRecommendationRow> {
  const res = await apiGet<{ recommendation: AgentApprovalRecommendationRow }>(
    `/v1/agents/${encodeURIComponent(agent_id)}/approval-recommendation`,
  );
  return res.recommendation;
}

export async function recommendAutonomyUpgrade(
  agent_id: string,
  payload: AutonomyRecommendRequestV1,
): Promise<AutonomyRecommendResponseV1> {
  return await apiPost<AutonomyRecommendResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/autonomy/recommend`,
    payload,
  );
}

export async function approveAutonomyUpgrade(
  agent_id: string,
  payload: AutonomyApproveRequestV1,
): Promise<AutonomyApproveResponseV1> {
  return await apiPost<AutonomyApproveResponseV1>(
    `/v1/agents/${encodeURIComponent(agent_id)}/autonomy/approve`,
    payload,
  );
}

export interface CapabilityTokenRow {
  token_id: string;
  workspace_id: string;
  issued_to_principal_id: string;
  granted_by_principal_id: string;
  parent_token_id: string | null;
  scopes: CapabilityScopesV1;
  valid_until: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function listCapabilityTokens(principal_id: string): Promise<CapabilityTokenRow[]> {
  const res = await apiGet<{ tokens: CapabilityTokenRow[] }>(
    `/v1/capabilities?principal_id=${encodeURIComponent(principal_id)}`,
  );
  return res.tokens;
}

export interface AgentSkillRow {
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  level: number;
  learned_at: string | null;
  last_used_at: string | null;
  usage_total: number;
  usage_7d: number;
  usage_30d: number;
  assessment_total: number;
  assessment_passed: number;
  reliability_score: number;
  impact_score: number;
  is_primary: boolean;
  source_skill_package_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAgentSkills(params: { agent_id: string; limit?: number }): Promise<AgentSkillRow[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/agents/${encodeURIComponent(params.agent_id)}/skills${qs.size ? `?${qs.toString()}` : ""}`;
  const res = await apiGet<{ skills: AgentSkillRow[] }>(url);
  return res.skills;
}

export interface AgentSkillAssessmentRow {
  assessment_id: string;
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  status: "started" | "passed" | "failed";
  trigger_reason: string | null;
  suite: Record<string, unknown>;
  results: Record<string, unknown>;
  score: number | null;
  run_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_by_type: "user" | "agent" | "service";
  created_by_id: string;
  created_by_principal_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAgentSkillAssessments(params: {
  agent_id: string;
  limit?: number;
  skill_id?: string;
  status?: "started" | "passed" | "failed";
}): Promise<AgentSkillAssessmentRow[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.skill_id?.trim()) qs.set("skill_id", params.skill_id.trim());
  if (params.status) qs.set("status", params.status);
  const url = `/v1/agents/${encodeURIComponent(params.agent_id)}/skills/assessments${
    qs.size ? `?${qs.toString()}` : ""
  }`;
  const res = await apiGet<{ assessments: AgentSkillAssessmentRow[] }>(url);
  return res.assessments;
}

export interface DailyAgentSnapshotRow {
  workspace_id: string;
  agent_id: string;
  snapshot_date: string;
  trust_score: number;
  autonomy_rate_7d: number;
  new_skills_learned_7d: number;
  constraints_learned_7d: number;
  repeated_mistakes_7d: number;
  extras: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listAgentSnapshots(params: { agent_id: string; days?: number }): Promise<DailyAgentSnapshotRow[]> {
  const qs = new URLSearchParams();
  if (params.days) qs.set("days", String(params.days));
  const url = `/v1/agents/${encodeURIComponent(params.agent_id)}/snapshots${qs.size ? `?${qs.toString()}` : ""}`;
  const res = await apiGet<{ snapshots: DailyAgentSnapshotRow[] }>(url);
  return res.snapshots;
}

export interface ConstraintLearnedRow {
  event_id: string;
  occurred_at: string;
  room_id: string | null;
  run_id: string | null;
  constraint_id: string;
  category: string;
  action: string;
  reason_code: string;
  repeat_count: number;
  guidance: unknown;
  raw: EventRow;
}

type ConstraintLearnedEventData = {
  agent_id?: unknown;
  constraint_id?: unknown;
  category?: unknown;
  action?: unknown;
  reason_code?: unknown;
  repeat_count?: unknown;
  guidance?: unknown;
};

function parseConstraintLearned(agent_id: string, event: EventRow): ConstraintLearnedRow | null {
  if (event.event_type !== "constraint.learned") return null;
  const data = (event.data && typeof event.data === "object" ? (event.data as ConstraintLearnedEventData) : {}) as ConstraintLearnedEventData;
  if (data.agent_id !== agent_id) return null;

  const constraint_id = typeof data.constraint_id === "string" ? data.constraint_id : null;
  const category = typeof data.category === "string" ? data.category : null;
  const action = typeof data.action === "string" ? data.action : null;
  const reason_code = typeof data.reason_code === "string" ? data.reason_code : null;
  const repeat_count = Number(data.repeat_count ?? 0);

  if (!constraint_id || !category || !action || !reason_code) return null;
  return {
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    room_id: event.room_id,
    run_id: event.run_id,
    constraint_id,
    category,
    action,
    reason_code,
    repeat_count: Number.isFinite(repeat_count) ? Math.max(0, Math.floor(repeat_count)) : 0,
    guidance: data.guidance,
    raw: event,
  };
}

export async function listConstraintLearnedEvents(params: {
  agent_id: string;
  limit?: number;
}): Promise<ConstraintLearnedRow[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params.limit ?? 200))));
  const events = await listEvents({ event_type: "constraint.learned", limit });
  const rows: ConstraintLearnedRow[] = [];
  for (const ev of events) {
    const parsed = parseConstraintLearned(params.agent_id, ev);
    if (parsed) rows.push(parsed);
  }
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export interface MistakeRepeatedRow {
  event_id: string;
  occurred_at: string;
  room_id: string | null;
  run_id: string | null;
  reason_code: string;
  action: string;
  repeat_count: number;
  raw: EventRow;
}

type MistakeRepeatedEventData = {
  agent_id?: unknown;
  reason_code?: unknown;
  action?: unknown;
  repeat_count?: unknown;
};

function parseMistakeRepeated(agent_id: string, event: EventRow): MistakeRepeatedRow | null {
  if (event.event_type !== "mistake.repeated") return null;
  const data = (event.data && typeof event.data === "object" ? (event.data as MistakeRepeatedEventData) : {}) as MistakeRepeatedEventData;
  if (data.agent_id !== agent_id) return null;

  const reason_code = typeof data.reason_code === "string" ? data.reason_code : null;
  const action = typeof data.action === "string" ? data.action : null;
  const repeat_count = Number(data.repeat_count ?? 0);
  if (!reason_code || !action) return null;

  return {
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    room_id: event.room_id,
    run_id: event.run_id,
    reason_code,
    action,
    repeat_count: Number.isFinite(repeat_count) ? Math.max(0, Math.floor(repeat_count)) : 0,
    raw: event,
  };
}

export async function listMistakeRepeatedEvents(params: { agent_id: string; limit?: number }): Promise<MistakeRepeatedRow[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params.limit ?? 200))));
  const events = await listEvents({ event_type: "mistake.repeated", limit });
  const rows: MistakeRepeatedRow[] = [];
  for (const ev of events) {
    const parsed = parseMistakeRepeated(params.agent_id, ev);
    if (parsed) rows.push(parsed);
  }
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
