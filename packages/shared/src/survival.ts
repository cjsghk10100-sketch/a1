import type { EventEnvelopeV1 } from "./events.js";

export const SurvivalLedgerTargetType = {
  Workspace: "workspace",
  Agent: "agent",
} as const;

export type SurvivalLedgerTargetType =
  (typeof SurvivalLedgerTargetType)[keyof typeof SurvivalLedgerTargetType];

export interface SurvivalLedgerRecordV1 {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  snapshot_date: string;

  success_count: number;
  failure_count: number;
  incident_opened_count: number;
  incident_closed_count: number;
  learning_count: number;
  repeated_mistakes_count: number;
  egress_requests_count: number;
  blocked_requests_count: number;

  estimated_cost_units: number;
  value_units: number;
  budget_cap_units: number;
  budget_utilization: number;
  survival_score: number;

  extras: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SurvivalLedgerRolledUpDataV1 {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  snapshot_date: string;

  success_count: number;
  failure_count: number;
  incident_opened_count: number;
  incident_closed_count: number;
  learning_count: number;
  repeated_mistakes_count: number;
  egress_requests_count: number;
  blocked_requests_count: number;

  estimated_cost_units: number;
  value_units: number;
  budget_cap_units: number;
  budget_utilization: number;
  survival_score: number;
  extras: Record<string, unknown>;
}

export type SurvivalLedgerRolledUpEventV1 = EventEnvelopeV1<
  "survival.ledger.rolled_up",
  SurvivalLedgerRolledUpDataV1
>;
