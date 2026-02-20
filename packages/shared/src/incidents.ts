import type { EventEnvelopeV1 } from "./events.js";
import type { IncidentId } from "./ids.js";

export const IncidentStatus = {
  Open: "open",
  Closed: "closed",
} as const;

export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const IncidentSeverity = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
} as const;

export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export interface IncidentOpenedDataV1 {
  incident_id: IncidentId;
  title: string;
  summary?: string;
  severity?: IncidentSeverity;
  run_id?: string;
}

export interface IncidentRcaUpdatedDataV1 {
  incident_id: IncidentId;
  rca: Record<string, unknown>;
}

export interface IncidentLearningLoggedDataV1 {
  incident_id: IncidentId;
  learning_id: string;
  note: string;
  tags?: string[];
}

export interface IncidentClosedDataV1 {
  incident_id: IncidentId;
  reason?: string;
}

export type IncidentOpenedV1 = EventEnvelopeV1<"incident.opened", IncidentOpenedDataV1>;
export type IncidentRcaUpdatedV1 = EventEnvelopeV1<"incident.rca.updated", IncidentRcaUpdatedDataV1>;
export type IncidentLearningLoggedV1 = EventEnvelopeV1<
  "incident.learning.logged",
  IncidentLearningLoggedDataV1
>;
export type IncidentClosedV1 = EventEnvelopeV1<"incident.closed", IncidentClosedDataV1>;

export type IncidentEventV1 =
  | IncidentOpenedV1
  | IncidentRcaUpdatedV1
  | IncidentLearningLoggedV1
  | IncidentClosedV1;
