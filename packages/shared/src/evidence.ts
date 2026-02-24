import type { EventEnvelopeV1 } from "./events.js";
import type { EvidenceId, RunId, StepId, ToolCallId, ArtifactId } from "./ids.js";

export interface EvidenceEventPointerV1 {
  event_id: string;
  event_type: string;
  occurred_at: string;
  stream_seq: number;
  event_hash: string;
}

export interface EvidenceManifestV1 {
  schema_version: 1;
  evidence_id: EvidenceId;
  workspace_id: string;
  run_id: RunId;
  room_id?: string | null;
  thread_id?: string | null;
  correlation_id: string;
  run_status: "succeeded" | "failed";
  stream_window: {
    stream_type: "room" | "workspace";
    stream_id: string;
    from_seq: number;
    to_seq: number;
    event_count: number;
  };
  pointers: {
    step_ids: StepId[];
    tool_call_ids: ToolCallId[];
    artifact_ids: ArtifactId[];
    events: EvidenceEventPointerV1[];
  };
  completeness: {
    terminal_event_present: boolean;
    all_toolcalls_terminal: boolean;
    artifact_count: number;
  };
  generated_at: string;
}

export interface EvidenceManifestCreatedDataV1 {
  evidence_id: EvidenceId;
  run_id: RunId;
  room_id?: string;
  thread_id?: string;
  correlation_id: string;
  run_status: "succeeded" | "failed";
  manifest: EvidenceManifestV1;
  manifest_hash: string;
  event_hash_root: string;
  stream_type: "room" | "workspace";
  stream_id: string;
  from_seq: number;
  to_seq: number;
  event_count: number;
  finalized_at: string;
}

export interface EvidenceManifestRecordV1 {
  evidence_id: EvidenceId;
  workspace_id: string;
  run_id: RunId;
  room_id: string | null;
  thread_id: string | null;
  correlation_id: string;
  run_status: "succeeded" | "failed";
  manifest: EvidenceManifestV1;
  manifest_hash: string;
  event_hash_root: string;
  stream_type: "room" | "workspace";
  stream_id: string;
  from_seq: number;
  to_seq: number;
  event_count: number;
  finalized_at: string;
  created_at: string;
  updated_at: string;
  last_event_id: string;
}

export interface EvidenceReadResponseV1 {
  evidence: EvidenceManifestRecordV1;
}

export interface EvidenceFinalizeResponseV1 {
  created: boolean;
  evidence: EvidenceManifestRecordV1;
}

export type EvidenceManifestCreatedV1 = EventEnvelopeV1<
  "evidence.manifest.created",
  EvidenceManifestCreatedDataV1
>;
export type EvidenceEventV1 = EvidenceManifestCreatedV1;
