import type { EventEnvelopeV1 } from "./events.js";
import type { SurvivalLedgerTargetType } from "./survival.js";

export const LifecycleState = {
  Active: "active",
  Probation: "probation",
  Sunset: "sunset",
} as const;

export type LifecycleState = (typeof LifecycleState)[keyof typeof LifecycleState];

export interface LifecycleStateRecordV1 {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  current_state: LifecycleState;
  recommended_state: LifecycleState;
  last_snapshot_date: string;
  last_survival_score: number;
  last_budget_utilization: number;
  consecutive_healthy_days: number;
  consecutive_risky_days: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_transition_at: string | null;
  last_event_id: string | null;
}

export interface LifecycleTransitionRecordV1 {
  transition_id: string;
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  from_state: LifecycleState | null;
  to_state: LifecycleState;
  recommended_state: LifecycleState;
  reason_codes: string[];
  snapshot_date: string;
  survival_score: number;
  budget_utilization: number;
  correlation_id: string;
  event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LifecycleStateChangedDataV1 {
  workspace_id: string;
  target_type: SurvivalLedgerTargetType;
  target_id: string;
  from_state?: LifecycleState;
  to_state: LifecycleState;
  recommended_state: LifecycleState;
  reason_codes: string[];
  snapshot_date: string;
  survival_score: number;
  budget_utilization: number;
  counters: {
    consecutive_healthy_days: number;
    consecutive_risky_days: number;
  };
  metadata: Record<string, unknown>;
}

export type LifecycleStateChangedEventV1 = EventEnvelopeV1<
  "lifecycle.state.changed",
  LifecycleStateChangedDataV1
>;
