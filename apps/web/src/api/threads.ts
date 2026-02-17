import { apiGet, apiPost } from "./http";

export interface ThreadRow {
  thread_id: string;
  workspace_id: string;
  room_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_event_id: string | null;
}

export interface MessageRow {
  message_id: string;
  workspace_id: string;
  room_id: string;
  thread_id: string;
  sender_type: string;
  sender_id: string;
  content_md: string;
  lang: string;
  parent_message_id: string | null;
  run_id: string | null;
  step_id: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export async function listRoomThreads(roomId: string, params?: { limit?: number }): Promise<ThreadRow[]> {
  const id = roomId.trim();
  if (!id) return [];

  const qs = new URLSearchParams();
  if (typeof params?.limit === "number") qs.set("limit", String(params.limit));
  const url = `/v1/rooms/${encodeURIComponent(id)}/threads${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ threads: ThreadRow[] }>(url);
  return res.threads;
}

export async function createThread(roomId: string, payload: { title: string; status?: string }): Promise<string> {
  const id = roomId.trim();
  const title = payload.title.trim();
  if (!id) throw new Error("room_id_required");
  if (!title) throw new Error("title_required");

  const res = await apiPost<{ thread_id: string }>(`/v1/rooms/${encodeURIComponent(id)}/threads`, {
    title,
    status: payload.status,
  });
  return res.thread_id;
}

export async function listThreadMessages(
  threadId: string,
  params?: { limit?: number; before?: string },
): Promise<MessageRow[]> {
  const id = threadId.trim();
  if (!id) return [];

  const qs = new URLSearchParams();
  if (typeof params?.limit === "number") qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", params.before);
  const url = `/v1/threads/${encodeURIComponent(id)}/messages${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ messages: MessageRow[] }>(url);
  return res.messages;
}

export async function postThreadMessage(
  threadId: string,
  payload: { content_md: string; lang: string; sender_type?: string; sender_id?: string },
): Promise<string> {
  const id = threadId.trim();
  const content_md = payload.content_md.trim();
  const lang = payload.lang.trim();
  if (!id) throw new Error("thread_id_required");
  if (!content_md) throw new Error("content_required");
  if (!lang) throw new Error("lang_required");

  const res = await apiPost<{ message_id: string }>(`/v1/threads/${encodeURIComponent(id)}/messages`, {
    sender_type: payload.sender_type,
    sender_id: payload.sender_id,
    content_md,
    lang,
  });
  return res.message_id;
}

