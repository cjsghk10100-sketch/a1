import type { CapabilityScopesV1 } from "./capabilities.js";

export interface EngineRecordV1 {
  engine_id: string;
  workspace_id: string;
  engine_name: string;
  actor_id: string;
  principal_id: string;
  metadata: Record<string, unknown>;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivated_reason: string | null;
}

export interface EngineTokenRecordV1 {
  token_id: string;
  workspace_id: string;
  engine_id: string;
  principal_id: string;
  capability_token_id: string;
  token_label: string | null;
  issued_at: string;
  last_seen_at: string | null;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_by_principal_id: string | null;
}

export interface EngineRegisterRequestV1 {
  engine_name?: string;
  actor_id: string;
  metadata?: Record<string, unknown>;
  scopes?: CapabilityScopesV1;
  valid_until?: string;
  token_label?: string;
}

export interface EngineRegisterResponseV1 {
  engine: EngineRecordV1;
  token: EngineTokenRecordV1 & {
    engine_token: string;
  };
}

export interface EngineDeactivateRequestV1 {
  reason?: string;
}

export interface EngineIssueTokenRequestV1 {
  scopes?: CapabilityScopesV1;
  valid_until?: string;
  token_label?: string;
}

export interface EngineIssueTokenResponseV1 {
  engine: EngineRecordV1;
  token: EngineTokenRecordV1 & {
    engine_token: string;
  };
}

export interface EngineRevokeTokenRequestV1 {
  reason?: string;
}

export interface EngineListResponseV1 {
  engines: EngineRecordV1[];
}

export interface EngineTokenListResponseV1 {
  tokens: EngineTokenRecordV1[];
}
