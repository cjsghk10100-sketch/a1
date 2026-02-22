import type { CapabilityScopesV1 } from "./capabilities.js";
import type { EventEnvelopeV1 } from "./events.js";

export interface TrustComponentsV1 {
  success_rate_7d: number;
  eval_quality_trend: number;
  user_feedback_score: number;
  policy_violations_7d: number;
  time_in_service_days: number;
}

export interface AgentTrustRecordV1 extends TrustComponentsV1 {
  agent_id: string;
  workspace_id: string;
  trust_score: number;
  components: Record<string, unknown>;
  last_recalculated_at: string;
  created_at: string;
  updated_at: string;
}

export interface AutonomyRecommendationV1 {
  recommendation_id: string;
  workspace_id: string;
  agent_id: string;
  status: "pending" | "approved" | "rejected";
  scope_delta: CapabilityScopesV1;
  rationale: string;
  trust_score_before: number;
  trust_score_after: number;
  trust_components: TrustComponentsV1;
  approved_token_id?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TrustReadResponseV1 {
  trust: AgentTrustRecordV1;
}

export interface AutonomyRecommendRequestV1 {
  scope_delta?: CapabilityScopesV1;
  rationale?: string;
  signals?: Partial<TrustComponentsV1>;
  actor_type?: "user" | "service";
  actor_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
}

export interface AutonomyRecommendResponseV1 {
  recommendation: AutonomyRecommendationV1;
  trust: AgentTrustRecordV1;
}

export interface TrustRecalculateRequestV1 {
  actor_type?: "user" | "service" | "agent";
  actor_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
}

export interface TrustRecalculateResponseV1 {
  trust: AgentTrustRecordV1;
}

export interface AutonomyApproveRequestV1 {
  recommendation_id: string;
  granted_by_principal_id: string;
  valid_until?: string;
  correlation_id?: string;
}

export interface AutonomyApproveResponseV1 {
  recommendation_id: string;
  token_id: string;
  already_approved?: boolean;
}

export interface AgentTrustChangedDataV1 {
  agent_id: string;
  previous_score: number;
  trust_score: number;
  components: TrustComponentsV1;
}

export interface AutonomyUpgradeRecommendedDataV1 {
  recommendation_id: string;
  agent_id: string;
  scope_delta: CapabilityScopesV1;
  rationale: string;
  trust_score_before: number;
  trust_score_after: number;
}

export interface AutonomyUpgradeApprovedDataV1 {
  recommendation_id: string;
  agent_id: string;
  token_id: string;
  granted_by_principal_id: string;
}

export type AgentTrustIncreasedEventV1 = EventEnvelopeV1<
  "agent.trust.increased",
  AgentTrustChangedDataV1
>;
export type AgentTrustDecreasedEventV1 = EventEnvelopeV1<
  "agent.trust.decreased",
  AgentTrustChangedDataV1
>;
export type AutonomyUpgradeRecommendedEventV1 = EventEnvelopeV1<
  "autonomy.upgrade.recommended",
  AutonomyUpgradeRecommendedDataV1
>;
export type AutonomyUpgradeApprovedEventV1 = EventEnvelopeV1<
  "autonomy.upgrade.approved",
  AutonomyUpgradeApprovedDataV1
>;
