import type { EventEnvelopeV1 } from "./events.js";
import type { ExperimentId } from "./ids.js";

export const ExperimentStatus = {
  Open: "open",
  Closed: "closed",
  Stopped: "stopped",
} as const;

export type ExperimentStatus = (typeof ExperimentStatus)[keyof typeof ExperimentStatus];

export const ExperimentRiskTier = {
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export type ExperimentRiskTier = (typeof ExperimentRiskTier)[keyof typeof ExperimentRiskTier];

export interface ExperimentCreatedDataV1 {
  experiment_id: ExperimentId;
  title: string;
  hypothesis: string;
  success_criteria: Record<string, unknown>;
  stop_conditions: Record<string, unknown>;
  budget_cap_units: number;
  risk_tier: ExperimentRiskTier;
  metadata?: Record<string, unknown>;
}

export interface ExperimentUpdatedDataV1 {
  experiment_id: ExperimentId;
  title?: string;
  hypothesis?: string;
  success_criteria?: Record<string, unknown>;
  stop_conditions?: Record<string, unknown>;
  budget_cap_units?: number;
  risk_tier?: ExperimentRiskTier;
  metadata?: Record<string, unknown>;
}

export interface ExperimentClosedDataV1 {
  experiment_id: ExperimentId;
  status: "closed" | "stopped";
  reason?: string;
  force?: boolean;
  active_run_count?: number;
}

export type ExperimentCreatedV1 = EventEnvelopeV1<"experiment.created", ExperimentCreatedDataV1>;
export type ExperimentUpdatedV1 = EventEnvelopeV1<"experiment.updated", ExperimentUpdatedDataV1>;
export type ExperimentClosedV1 = EventEnvelopeV1<"experiment.closed", ExperimentClosedDataV1>;
export type ExperimentEventV1 = ExperimentCreatedV1 | ExperimentUpdatedV1 | ExperimentClosedV1;
