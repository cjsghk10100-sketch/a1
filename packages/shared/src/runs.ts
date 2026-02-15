import type { EventEnvelopeV1 } from "./events.js";
import type { RunId, StepId } from "./ids.js";

export const RunStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
} as const;

export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const StepStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
} as const;

export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export interface RunCreatedDataV1 {
  run_id: RunId;
  title?: string;
  goal?: string;
  input?: Record<string, unknown>;
  tags?: string[];
}

export interface RunStartedDataV1 {
  run_id: RunId;
}

export interface RunCompletedDataV1 {
  run_id: RunId;
  summary?: string;
  output?: Record<string, unknown>;
}

export interface RunFailedDataV1 {
  run_id: RunId;
  error?: Record<string, unknown>;
  message?: string;
}

export interface StepCreatedDataV1 {
  step_id: StepId;
  kind: string;
  title?: string;
  input?: Record<string, unknown>;
}

export type RunCreatedV1 = EventEnvelopeV1<"run.created", RunCreatedDataV1>;
export type RunStartedV1 = EventEnvelopeV1<"run.started", RunStartedDataV1>;
export type RunCompletedV1 = EventEnvelopeV1<"run.completed", RunCompletedDataV1>;
export type RunFailedV1 = EventEnvelopeV1<"run.failed", RunFailedDataV1>;
export type StepCreatedV1 = EventEnvelopeV1<"step.created", StepCreatedDataV1>;

export type RunEventV1 = RunCreatedV1 | RunStartedV1 | RunCompletedV1 | RunFailedV1 | StepCreatedV1;

