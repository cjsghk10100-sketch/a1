import type { EventEnvelopeV1 } from "./events.js";

export const SkillType = {
  Tool: "tool",
  Workflow: "workflow",
  Cognitive: "cognitive",
} as const;

export type SkillType = (typeof SkillType)[keyof typeof SkillType];

export const SkillRiskClass = {
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export type SkillRiskClass = (typeof SkillRiskClass)[keyof typeof SkillRiskClass];

export interface SkillCatalogRecordV1 {
  workspace_id: string;
  skill_id: string;
  name: string;
  description?: string;
  skill_type: SkillType;
  risk_class: SkillRiskClass;
  assessment_suite: Record<string, unknown>;
  required_manifest_caps: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillRecordV1 {
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  level: number;
  learned_at?: string;
  last_used_at?: string;
  usage_total: number;
  usage_7d: number;
  usage_30d: number;
  reliability_score: number;
  impact_score: number;
  assessment_total: number;
  assessment_passed: number;
  is_primary: boolean;
  source_skill_package_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SkillAssessmentRecordV1 {
  assessment_id: string;
  workspace_id: string;
  agent_id: string;
  skill_id: string;
  status: "started" | "passed" | "failed";
  trigger_reason?: string;
  suite: Record<string, unknown>;
  results: Record<string, unknown>;
  score?: number;
  run_id?: string;
  started_at: string;
  ended_at?: string;
  created_by_type: "user" | "agent" | "service";
  created_by_id: string;
  created_by_principal_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillLearnedDataV1 {
  agent_id: string;
  skill_id: string;
  level: number;
}

export interface AgentSkillUsedDataV1 {
  agent_id: string;
  skill_id: string;
  usage_total: number;
  run_id?: string;
  step_id?: string;
}

export interface AgentSkillPrimarySetDataV1 {
  agent_id: string;
  skill_id: string;
}

export interface SkillAssessmentEventDataV1 {
  assessment_id: string;
  agent_id: string;
  skill_id: string;
  score?: number;
}

export type AgentSkillLearnedEventV1 = EventEnvelopeV1<"agent.skill.learned", AgentSkillLearnedDataV1>;
export type AgentSkillUsedEventV1 = EventEnvelopeV1<"agent.skill.used", AgentSkillUsedDataV1>;
export type AgentSkillPrimarySetEventV1 = EventEnvelopeV1<
  "agent.skill.primary_set",
  AgentSkillPrimarySetDataV1
>;
export type SkillAssessmentStartedEventV1 = EventEnvelopeV1<
  "skill.assessment.started",
  SkillAssessmentEventDataV1
>;
export type SkillAssessmentPassedEventV1 = EventEnvelopeV1<
  "skill.assessment.passed",
  SkillAssessmentEventDataV1
>;
export type SkillAssessmentFailedEventV1 = EventEnvelopeV1<
  "skill.assessment.failed",
  SkillAssessmentEventDataV1
>;
