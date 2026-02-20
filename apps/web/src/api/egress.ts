import { apiGet } from "./http";

export interface EgressRequestRow {
  egress_request_id: string;
  workspace_id: string;
  room_id: string | null;
  run_id: string | null;
  step_id: string | null;
  requested_by_type: string;
  requested_by_id: string;
  requested_by_principal_id: string | null;
  zone: "sandbox" | "supervised" | "high_stakes" | null;
  action: string;
  method: string | null;
  target_url: string;
  target_domain: string;
  policy_decision: string;
  policy_reason_code: string;
  policy_reason: string | null;
  enforcement_mode: string;
  blocked: boolean;
  approval_id: string | null;
  correlation_id: string;
  created_at: string;
}

export async function listEgressRequests(params?: {
  room_id?: string;
  limit?: number;
}): Promise<EgressRequestRow[]> {
  const qs = new URLSearchParams();
  if (params?.room_id) qs.set("room_id", params.room_id);
  const limitRaw = Number(params?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  qs.set("limit", String(limit));

  const res = await apiGet<{ requests: EgressRequestRow[] }>(`/v1/egress/requests?${qs.toString()}`);
  return res.requests;
}
