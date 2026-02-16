import type { EventEnvelopeV1 } from "./events.js";

export interface DailyAgentSnapshotRecordV1 {
  workspace_id: string;
  agent_id: string;
  snapshot_date: string; // YYYY-MM-DD
  trust_score: number;
  autonomy_rate_7d: number;
  new_skills_learned_7d: number;
  constraints_learned_7d: number;
  repeated_mistakes_7d: number;
  extras: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DailyAgentSnapshotEventDataV1 {
  workspace_id: string;
  agent_id: string;
  snapshot_date: string;
  trust_score: number;
  autonomy_rate_7d: number;
  new_skills_learned_7d: number;
  constraints_learned_7d: number;
  repeated_mistakes_7d: number;
  extras: Record<string, unknown>;
}

export type DailyAgentSnapshotEventV1 = EventEnvelopeV1<
  "daily.agent.snapshot",
  DailyAgentSnapshotEventDataV1
>;
