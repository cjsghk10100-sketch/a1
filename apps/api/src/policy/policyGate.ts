import {
  PolicyDecision,
  PolicyReasonCode,
  type PolicyCheckInputV1,
  type PolicyCheckResultV1,
} from "@agentapp/shared";

export function evaluatePolicyV1(input: PolicyCheckInputV1): PolicyCheckResultV1 {
  const action = input.action.trim();

  // Establish a hard boundary early: anything that can affect the outside world
  // should be approved explicitly. Fine-grained scope/grants come in TASK-021+.
  if (action === "external.write" || action === "external_write") {
    return {
      decision: PolicyDecision.RequireApproval,
      reason_code: PolicyReasonCode.ExternalWriteRequiresApproval,
      reason: "External writes require approval.",
    };
  }

  return {
    decision: PolicyDecision.Allow,
    reason_code: PolicyReasonCode.DefaultAllow,
  };
}

