import type { SupportedSchemaVersion } from "./schemaVersion.js";

export const PIPELINE_CONTRACT_VERSION = "2.1" as const;

export type PipelineStageKey =
  | "1_inbox"
  | "2_pending_approval"
  | "3_execute_workspace"
  | "4_review_evidence"
  | "5_promoted"
  | "6_demoted";

export type PipelineItemLinks = {
  experiment_id: string | null;
  approval_id: string | null;
  run_id: string | null;
  evidence_id: string | null;
  scorecard_id: string | null;
  incident_id: string | null;
};

export type PipelineApprovalItem = {
  entity_type: "approval";
  entity_id: string;
  title: string;
  status: "pending" | "held";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

export type PipelineRunItem = {
  entity_type: "run";
  entity_id: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  updated_at: string;
  last_event_id: string | null;
  links: PipelineItemLinks;
};

export type PipelineStageStats = Record<
  PipelineStageKey,
  {
    returned: number;
    truncated: boolean;
  }
>;

export type PipelineProjectionStages = {
  "1_inbox": Array<Record<string, never>>;
  "2_pending_approval": PipelineApprovalItem[];
  "3_execute_workspace": PipelineRunItem[];
  "4_review_evidence": PipelineRunItem[];
  "5_promoted": Array<Record<string, never>>;
  "6_demoted": PipelineRunItem[];
};

export type PipelineProjectionResponseV2_1 = {
  meta: {
    schema_version: typeof PIPELINE_CONTRACT_VERSION;
    generated_at: string;
    limit: number;
    stage_stats: PipelineStageStats;
    watermark_event_id: string | null;
  };
  stages: PipelineProjectionStages;
};

export type VersionedWriteBody = {
  schema_version?: SupportedSchemaVersion;
};
