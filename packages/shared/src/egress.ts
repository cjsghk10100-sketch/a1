import type { ActorType, Zone } from "./events.js";
import type { PolicyDecision, PolicyReasonCode } from "./policy.js";

export interface EgressRequestCreateV1 {
  action: string;
  target_url: string;
  method?: string;
  room_id?: string;
  run_id?: string;
  step_id?: string;
  actor_type?: ActorType;
  actor_id?: string;
  principal_id?: string;
  zone?: Zone;
  context?: Record<string, unknown>;
  correlation_id?: string;
}

export interface EgressRequestDecisionV1 {
  egress_request_id: string;
  decision: PolicyDecision;
  reason_code: PolicyReasonCode;
  reason?: string;
  approval_id?: string;
}

export interface EgressRequestRecordV1 {
  egress_request_id: string;
  workspace_id: string;
  room_id?: string;
  run_id?: string;
  step_id?: string;

  requested_by_type: ActorType;
  requested_by_id: string;
  requested_by_principal_id?: string;
  zone?: Zone;

  action: string;
  method?: string;
  target_url: string;
  target_domain: string;

  policy_decision: PolicyDecision;
  policy_reason_code: PolicyReasonCode;
  policy_reason?: string;
  enforcement_mode: "shadow" | "enforce";
  blocked: boolean;
  approval_id?: string;
  correlation_id: string;
  created_at: string;
}

