import {
  PolicyDecision,
  PolicyReasonCode,
  type PolicyCheckInputV1,
  type PolicyCheckResultV1,
} from "@agentapp/shared";

import type { DbPool } from "../db/pool.js";

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function normalizeAction(action: string): string {
  const a = action.trim();
  if (a === "external_write") return "external.write";
  if (a === "data_read") return "data.read";
  if (a === "data_write") return "data.write";
  return a;
}

type DataAccessLabel =
  | "public"
  | "internal"
  | "restricted"
  | "confidential"
  | "sensitive_pii";

interface DataAccessContextV1 {
  label?: string;
  label_room_id?: string | null;
  purpose_hint_mismatch?: boolean;
  justification_provided?: boolean;
}

function normalizeDataAccessContext(raw: unknown): DataAccessContextV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const dac = obj.data_access;
  if (!dac || typeof dac !== "object") return null;
  const d = dac as Record<string, unknown>;

  const label = typeof d.label === "string" ? d.label.trim() : "";
  const label_room_id =
    d.label_room_id == null
      ? null
      : typeof d.label_room_id === "string"
        ? d.label_room_id.trim()
        : null;

  return {
    label: label.length ? label : undefined,
    label_room_id: label_room_id && label_room_id.length ? label_room_id : null,
    purpose_hint_mismatch: d.purpose_hint_mismatch === true,
    justification_provided: d.justification_provided === true,
  };
}

function isDataAccessLabel(value: string): value is DataAccessLabel {
  return (
    value === "public" ||
    value === "internal" ||
    value === "restricted" ||
    value === "confidential" ||
    value === "sensitive_pii"
  );
}

function scopeMatches(
  scope: unknown,
  input: PolicyCheckInputV1,
  fallback: { workspace_id: string; room_id: string | null; run_id: string | null },
): boolean {
  if (!scope || typeof scope !== "object") return false;
  const s = scope as { type?: unknown; workspace_id?: unknown; room_id?: unknown; run_id?: unknown };
  const type = s.type;
  if (type === "workspace") return true;

  if (type === "room") {
    const target = typeof s.room_id === "string" ? s.room_id : fallback.room_id;
    return !!input.room_id && !!target && input.room_id === target;
  }

  if (type === "run") {
    const target = typeof s.run_id === "string" ? s.run_id : fallback.run_id;
    return !!input.run_id && !!target && input.run_id === target;
  }

  // `once`/`template` scopes are intentionally not matched yet (safer default).
  return false;
}

export function evaluatePolicyV1(input: PolicyCheckInputV1): PolicyCheckResultV1 {
  const action = normalizeAction(input.action);

  // Establish a hard boundary early: anything that can affect the outside world
  // should be approved explicitly. Fine-grained scope/grants come in TASK-021+.
  if (action === "external.write") {
    return {
      decision: PolicyDecision.RequireApproval,
      reason_code: PolicyReasonCode.ExternalWriteRequiresApproval,
      reason: "External writes require approval.",
    };
  }

  if (action === "data.read" || action === "data.write") {
    const ctx = normalizeDataAccessContext(input.context);
    if (!ctx) {
      return {
        decision: PolicyDecision.Allow,
        reason_code: PolicyReasonCode.DefaultAllow,
      };
    }

    const label: DataAccessLabel = isDataAccessLabel(ctx.label ?? "")
      ? (ctx.label as DataAccessLabel)
      : "internal";

    if (label === "restricted") {
      const labelRoom = ctx.label_room_id;
      const requestRoom = input.room_id?.trim() || null;
      if (!labelRoom || !requestRoom || labelRoom !== requestRoom) {
        return {
          decision: PolicyDecision.Deny,
          reason_code: "data_access_restricted_room_mismatch",
          reason: "Restricted resource access requires matching room scope.",
        };
      }
      return {
        decision: PolicyDecision.Allow,
        reason_code: PolicyReasonCode.DefaultAllow,
      };
    }

    if (label === "confidential" || label === "sensitive_pii") {
      if (ctx.purpose_hint_mismatch && !ctx.justification_provided) {
        return {
          decision: PolicyDecision.RequireApproval,
          reason_code: "data_access_purpose_hint_mismatch",
          reason: "Purpose hint mismatch. Provide a justification before accessing this resource.",
        };
      }
    }

    return {
      decision: PolicyDecision.Allow,
      reason_code: PolicyReasonCode.DefaultAllow,
    };
  }

  return {
    decision: PolicyDecision.Allow,
    reason_code: PolicyReasonCode.DefaultAllow,
  };
}

export async function evaluatePolicyDbV1(
  pool: DbPool,
  input: PolicyCheckInputV1,
): Promise<PolicyCheckResultV1> {
  const action = normalizeAction(input.action);

  if (action !== "external.write") {
    return evaluatePolicyV1(input);
  }

  // Kill-switch: hard deny regardless of approvals.
  if (isTruthyEnv(process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE)) {
    return {
      decision: PolicyDecision.Deny,
      reason_code: PolicyReasonCode.KillSwitchActive,
      reason: "Kill-switch is active for external writes.",
    };
  }

  const res = await pool.query<{
    approval_id: string;
    room_id: string | null;
    run_id: string | null;
    scope: unknown;
  }>(
    `SELECT approval_id, room_id, run_id, scope
     FROM proj_approvals
     WHERE workspace_id = $1
       AND action = $2
       AND status = 'approved'
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY decided_at DESC
     LIMIT 50`,
    [input.workspace_id, action],
  );

  for (const row of res.rows) {
    if (
      scopeMatches(row.scope, input, {
        workspace_id: input.workspace_id,
        room_id: row.room_id,
        run_id: row.run_id,
      })
    ) {
      return {
        decision: PolicyDecision.Allow,
        reason_code: PolicyReasonCode.ApprovalAllowsAction,
      };
    }
  }

  return {
    decision: PolicyDecision.RequireApproval,
    reason_code: PolicyReasonCode.ExternalWriteRequiresApproval,
    reason: "External writes require approval.",
  };
}
