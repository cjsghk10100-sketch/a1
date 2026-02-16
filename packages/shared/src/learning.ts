import type { EventEnvelopeV1 } from "./events.js";

export const ConstraintCategory = {
  Tool: "tool",
  Data: "data",
  Egress: "egress",
  Action: "action",
} as const;

export type ConstraintCategory = (typeof ConstraintCategory)[keyof typeof ConstraintCategory];

export interface LearningFromFailureDataV1 {
  category: ConstraintCategory;
  action: string;
  decision: "deny" | "require_approval";
  reason_code: string;
  reason?: string;
  enforcement_mode: "shadow" | "enforce";
  blocked: boolean;
  subject_key: string;
  principal_id?: string;
  agent_id?: string;
  pattern_hash: string;
  guidance: string;
  context: Record<string, unknown>;
  capability_token_id?: string;
  policy_event_id: string;
}

export interface ConstraintLearnedDataV1 {
  constraint_id: string;
  category: ConstraintCategory;
  action: string;
  reason_code: string;
  pattern_hash: string;
  guidance: string;
  seen_count: number;
  repeat_count: number;
  subject_key: string;
  principal_id?: string;
  agent_id?: string;
  learned_from_event_id: string;
}

export interface MistakeRepeatedDataV1 {
  constraint_id: string;
  category: ConstraintCategory;
  action: string;
  reason_code: string;
  repeat_count: number;
  pattern_hash: string;
  guidance: string;
  subject_key: string;
  principal_id?: string;
  agent_id?: string;
  learned_from_event_id: string;
}

export type LearningFromFailureEventV1 = EventEnvelopeV1<
  "learning.from_failure",
  LearningFromFailureDataV1
>;
export type ConstraintLearnedEventV1 = EventEnvelopeV1<"constraint.learned", ConstraintLearnedDataV1>;
export type MistakeRepeatedEventV1 = EventEnvelopeV1<"mistake.repeated", MistakeRepeatedDataV1>;
