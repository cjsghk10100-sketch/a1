import type { EventEnvelopeV1 } from "./events.js";
import type { ScorecardId } from "./ids.js";

export type PromotionDecisionV1 =
  | "none"
  | "recommend_upgrade"
  | "open_incident"
  | "request_revoke"
  | "quarantine";

export interface PromotionEvaluatedDataV1 {
  scorecard_id: ScorecardId;
  agent_id?: string;
  window_days: number;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  fail_ratio: number;
  decision: PromotionDecisionV1;
  reason?: string;
  recommendation_id?: string;
  incident_id?: string;
  approval_id?: string;
}

export type PromotionEvaluatedEventV1 = EventEnvelopeV1<
  "promotion.evaluated",
  PromotionEvaluatedDataV1
>;
