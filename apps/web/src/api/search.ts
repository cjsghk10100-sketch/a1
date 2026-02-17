import { apiGet } from "./http";

export interface SearchDocRow {
  doc_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  doc_type: string;
  content_text: string;
  lang: string;
  updated_at: string;
}

export async function searchDocs(params: {
  q: string;
  room_id?: string;
  thread_id?: string;
  doc_type?: string;
  limit?: number;
}): Promise<SearchDocRow[]> {
  const q = params.q.trim();
  if (!q) return [];

  const qs = new URLSearchParams();
  qs.set("q", q);
  if (params.room_id) qs.set("room_id", params.room_id);
  if (params.thread_id) qs.set("thread_id", params.thread_id);
  if (params.doc_type) qs.set("doc_type", params.doc_type);
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));

  const res = await apiGet<{ docs: SearchDocRow[] }>(`/v1/search?${qs.toString()}`);
  return res.docs;
}

