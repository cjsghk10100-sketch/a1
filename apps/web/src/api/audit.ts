import { apiGet } from "./http";

export type RedactionAction = "shadow_flagged" | "event_emitted";
export type RedactionStreamType = "room" | "thread" | "workspace";

export interface RedactionLogRow {
  redaction_log_id: string;
  workspace_id: string;
  event_id: string | null;
  event_type: string;
  stream_type: RedactionStreamType;
  stream_id: string;
  rule_id: string;
  match_preview: string;
  detector_version: string;
  action: RedactionAction;
  details: unknown;
  created_at: string;
}

export interface HashChainMismatch {
  stream_seq: number;
  event_id: string;
  event_type: string;
  kind: "prev_hash_mismatch" | "event_hash_mismatch" | "event_hash_missing";
  expected_prev_event_hash: string | null;
  actual_prev_event_hash: string | null;
  expected_event_hash: string | null;
  actual_event_hash: string | null;
}

export interface HashChainVerifyResult {
  stream_type: RedactionStreamType;
  stream_id: string;
  checked: number;
  valid: boolean;
  first_mismatch: HashChainMismatch | null;
  last_event_hash: string | null;
}

export async function listRedactionLogs(params: {
  event_id?: string;
  rule_id?: string;
  action?: RedactionAction;
  stream_type?: RedactionStreamType;
  stream_id?: string;
  limit?: number;
}): Promise<RedactionLogRow[]> {
  const qs = new URLSearchParams();
  if (params.event_id) qs.set("event_id", params.event_id);
  if (params.rule_id) qs.set("rule_id", params.rule_id);
  if (params.action) qs.set("action", params.action);
  if (params.stream_type) qs.set("stream_type", params.stream_type);
  if (params.stream_id) qs.set("stream_id", params.stream_id);
  if (typeof params.limit === "number") {
    const raw = Number(params.limit);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, Math.floor(raw))) : 50;
    qs.set("limit", String(limit));
  }

  const url = `/v1/audit/redactions${qs.size ? `?${qs.toString()}` : ""}`;
  const res = await apiGet<{ redactions: RedactionLogRow[] }>(url);
  return res.redactions;
}

export async function verifyHashChain(params: {
  stream_type?: RedactionStreamType;
  stream_id?: string;
  limit?: number;
}): Promise<HashChainVerifyResult> {
  const qs = new URLSearchParams();
  if (params.stream_type) qs.set("stream_type", params.stream_type);
  if (params.stream_id) qs.set("stream_id", params.stream_id);
  if (typeof params.limit === "number") {
    const raw = Number(params.limit);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(10000, Math.floor(raw))) : 2000;
    qs.set("limit", String(limit));
  }

  const url = `/v1/audit/hash-chain/verify${qs.size ? `?${qs.toString()}` : ""}`;
  return apiGet<HashChainVerifyResult>(url);
}
