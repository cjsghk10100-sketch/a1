import type { EventEnvelopeV1 } from "./events.js";
import type { LessonId, ScorecardId, ExperimentId, RunId, EvidenceId, IncidentId } from "./ids.js";

export const ScoreDecision = {
  Pass: "pass",
  Warn: "warn",
  Fail: "fail",
} as const;

export type ScoreDecision = (typeof ScoreDecision)[keyof typeof ScoreDecision];

export interface ScoreMetricV1 {
  key: string;
  value: number;
  weight?: number;
}

export interface ScorecardRecordedDataV1 {
  scorecard_id: ScorecardId;
  experiment_id?: ExperimentId;
  run_id?: RunId;
  evidence_id?: EvidenceId;
  agent_id?: string;
  principal_id?: string;
  template_key: string;
  template_version: string;
  metrics: ScoreMetricV1[];
  metrics_hash: string;
  score: number;
  decision: ScoreDecision;
  rationale?: string;
  metadata?: Record<string, unknown>;
}

export interface LessonLoggedDataV1 {
  lesson_id: LessonId;
  experiment_id?: ExperimentId;
  run_id?: RunId;
  scorecard_id?: ScorecardId;
  incident_id?: IncidentId;
  category: string;
  summary: string;
  action_items?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScorecardRecordV1 {
  scorecard_id: ScorecardId;
  workspace_id: string;
  experiment_id: ExperimentId | null;
  run_id: RunId | null;
  evidence_id: EvidenceId | null;
  agent_id: string | null;
  principal_id: string | null;
  template_key: string;
  template_version: string;
  metrics: ScoreMetricV1[];
  metrics_hash: string;
  score: number;
  decision: ScoreDecision;
  rationale: string | null;
  metadata: Record<string, unknown>;
  created_by_type: "service" | "user" | "agent";
  created_by_id: string;
  created_at: string;
  updated_at: string;
  correlation_id: string;
  last_event_id: string;
}

export interface LessonRecordV1 {
  lesson_id: LessonId;
  workspace_id: string;
  experiment_id: ExperimentId | null;
  run_id: RunId | null;
  scorecard_id: ScorecardId | null;
  incident_id: IncidentId | null;
  category: string;
  summary: string;
  action_items: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  created_by_type: "service" | "user" | "agent";
  created_by_id: string;
  created_at: string;
  updated_at: string;
  correlation_id: string;
  last_event_id: string;
}

export type ScorecardRecordedV1 = EventEnvelopeV1<"scorecard.recorded", ScorecardRecordedDataV1>;
export type LessonLoggedV1 = EventEnvelopeV1<"lesson.logged", LessonLoggedDataV1>;
export type ScorecardEventV1 = ScorecardRecordedV1 | LessonLoggedV1;
