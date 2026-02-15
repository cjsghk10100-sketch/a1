import type { EventEnvelopeV1 } from "./events.js";
import type { ApprovalId } from "./ids.js";

export const ApprovalDecision = {
  Approve: "approve",
  Deny: "deny",
  Hold: "hold",
} as const;

export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const ApprovalStatus = {
  Pending: "pending",
  Held: "held",
  Approved: "approved",
  Denied: "denied",
} as const;

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalScopeType = {
  Once: "once",
  Run: "run",
  Room: "room",
  Workspace: "workspace",
  Template: "template",
} as const;

export type ApprovalScopeType = (typeof ApprovalScopeType)[keyof typeof ApprovalScopeType];

export interface ApprovalScopeV1 {
  type: ApprovalScopeType;

  // Scope targets (optional, depending on type).
  workspace_id?: string;
  room_id?: string;
  run_id?: string;

  // For `once`-scoped approvals: typically bind to a correlation_id.
  correlation_id?: string;

  // For templates: a stable reference string (future).
  template_ref?: string;
}

export interface ApprovalRequestFormV1 {
  purpose?: string;
  external_impact?: string;
  risks?: string[];
  rollback_plan?: string;
  cost_cap_usd?: number;
  recommended_decision?: ApprovalDecision;
  notes_md?: string;

  // Open set for future additions.
  [k: string]: unknown;
}

export interface ApprovalRequestedDataV1 {
  approval_id: ApprovalId;
  action: string;

  title?: string;
  request?: ApprovalRequestFormV1;
  context?: Record<string, unknown>;

  // Suggested scope/ttl (policy enforcement is a later task).
  scope?: ApprovalScopeV1;
  expires_at?: string; // RFC3339
}

export interface ApprovalDecidedDataV1 {
  approval_id: ApprovalId;
  decision: ApprovalDecision;
  reason?: string;

  // For approved decisions, optional grant scope/ttl.
  scope?: ApprovalScopeV1;
  expires_at?: string; // RFC3339

  // Open set for future additions.
  [k: string]: unknown;
}

export type ApprovalRequestedV1 = EventEnvelopeV1<"approval.requested", ApprovalRequestedDataV1>;
export type ApprovalDecidedV1 = EventEnvelopeV1<"approval.decided", ApprovalDecidedDataV1>;
export type ApprovalEventV1 = ApprovalRequestedV1 | ApprovalDecidedV1;

