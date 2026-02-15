import { apiGet, apiPost } from "./http";

export type ApprovalStatus = "pending" | "held" | "approved" | "denied";
export type ApprovalDecision = "approve" | "deny" | "hold";

export interface ApprovalRow {
  approval_id: string;
  action: string;
  status: ApprovalStatus;

  title: string | null;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  step_id: string | null;

  request: unknown;
  context: unknown;
  scope: unknown;
  expires_at: string | null;

  requested_by_type: string | null;
  requested_by_id: string | null;
  requested_at: string | null;

  decided_by_type: string | null;
  decided_by_id: string | null;
  decided_at: string | null;
  decision: ApprovalDecision | null;
  decision_reason: string | null;

  correlation_id: string;

  created_at: string;
  updated_at: string;
  last_event_id: string | null;
}

export async function listApprovals(params: {
  status?: ApprovalStatus;
  room_id?: string;
  limit?: number;
}): Promise<ApprovalRow[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.room_id) qs.set("room_id", params.room_id);
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/approvals${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ approvals: ApprovalRow[] }>(url);
  return res.approvals;
}

export async function getApproval(approvalId: string): Promise<ApprovalRow> {
  const res = await apiGet<{ approval: ApprovalRow }>(`/v1/approvals/${approvalId}`);
  return res.approval;
}

export async function decideApproval(params: {
  approvalId: string;
  decision: ApprovalDecision;
  reason?: string;
}): Promise<void> {
  await apiPost(`/v1/approvals/${params.approvalId}/decide`, {
    decision: params.decision,
    reason: params.reason,
  });
}

