import type { ActorRefV1 } from "./events.js";

export const PolicyDecision = {
  Allow: "allow",
  Deny: "deny",
  RequireApproval: "require_approval",
} as const;

export type PolicyDecision = (typeof PolicyDecision)[keyof typeof PolicyDecision];

export const PolicyReasonCode = {
  DefaultAllow: "default_allow",
  ExternalWriteRequiresApproval: "external_write_requires_approval",
} as const;

// Open set: callers may introduce new reason codes without breaking the contract.
export type PolicyReasonCode = (typeof PolicyReasonCode)[keyof typeof PolicyReasonCode] | (string & {});

export interface PolicyCheckInputV1 {
  action: string;
  actor: ActorRefV1;

  workspace_id: string;
  room_id?: string;
  thread_id?: string;
  run_id?: string;
  step_id?: string;

  // Free-form context for policy decisions; add stable fields over time as needed.
  context?: Record<string, unknown>;
}

export interface PolicyCheckResultV1 {
  decision: PolicyDecision;
  reason_code: PolicyReasonCode;
  reason?: string;
}

