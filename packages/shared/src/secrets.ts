import type { ActorType, EventEnvelopeV1 } from "./events.js";

export interface SecretMetadataV1 {
  secret_id: string;
  workspace_id: string;
  secret_name: string;
  description?: string;
  algorithm: string;
  created_at: string;
  updated_at: string;
  last_accessed_at?: string;
  created_by_type: ActorType;
  created_by_id: string;
  created_by_principal_id?: string;
}

export interface SecretUpsertRequestV1 {
  secret_name: string;
  secret_value: string;
  description?: string;
}

export interface SecretUpsertResponseV1 extends SecretMetadataV1 {
  created: boolean;
}

export interface SecretListResponseV1 {
  secrets: SecretMetadataV1[];
}

export interface SecretAccessRequestV1 {
  actor_type?: ActorType;
  actor_id?: string;
  actor_principal_id?: string;
  correlation_id?: string;
}

export interface SecretAccessResponseV1 {
  secret_id: string;
  secret_name: string;
  secret_value: string;
}

export interface SecretAccessedDataV1 {
  secret_id: string;
  secret_name: string;
  accessed_by_principal_id: string;
}

export interface SecretLeakedDetectedDataV1 {
  source_event_id: string;
  source_event_type: string;
  scanner_version: string;
  match_count: number;
  rule_ids: string[];
  matches: Array<{ rule_id: string; match_preview: string }>;
}

export type SecretAccessedEventV1 = EventEnvelopeV1<"secret.accessed", SecretAccessedDataV1>;
export type SecretLeakedDetectedEventV1 = EventEnvelopeV1<
  "secret.leaked.detected",
  SecretLeakedDetectedDataV1
>;
