import type { ActorType, Zone } from "./events.js";
import type { PolicyDecision, PolicyReasonCode } from "./policy.js";

export const ResourceLabel = {
  Public: "public",
  Internal: "internal",
  Restricted: "restricted",
  Confidential: "confidential",
  SensitivePii: "sensitive_pii",
} as const;

export type ResourceLabel = (typeof ResourceLabel)[keyof typeof ResourceLabel];

export interface ResourceLabelRecordV1 {
  workspace_id: string;
  resource_type: string;
  resource_id: string;
  label: ResourceLabel;
  room_id: string | null;
  purpose_tags: string[];
  created_at: string;
  updated_at: string;
}

export interface UpsertResourceLabelRequestV1 {
  resource_type: string;
  resource_id: string;
  label: ResourceLabel;
  room_id?: string;
  purpose_tags?: string[];

  actor_type?: ActorType;
  actor_id?: string;
}

export interface UpsertResourceLabelResponseV1 {
  label: ResourceLabelRecordV1;
}

export interface ListResourceLabelsResponseV1 {
  labels: ResourceLabelRecordV1[];
}

export interface DataAccessRequestV1 {
  action: string;
  resource_type: string;
  resource_id: string;

  room_id?: string;
  purpose_tags?: string[];
  justification?: string;

  actor_type?: ActorType;
  actor_id?: string;

  // Optional OS-level identity context.
  principal_id?: string;
  capability_token_id?: string;
  zone?: Zone;

  context?: Record<string, unknown>;
}

export interface DataAccessDecisionResponseV1 {
  decision: PolicyDecision;
  reason_code: PolicyReasonCode;
  reason?: string;

  resolved_label: ResourceLabel;
  resolved_room_id: string | null;
  resolved_purpose_tags: string[];
}
