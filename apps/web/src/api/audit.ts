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
