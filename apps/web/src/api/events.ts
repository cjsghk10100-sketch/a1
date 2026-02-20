import { apiGet } from "./http";

export interface EventRow {
  event_id: string;
  event_type: string;
  event_version: number;
  occurred_at: string;
  recorded_at: string;

  workspace_id: string;
  mission_id: string | null;
  room_id: string | null;
  thread_id: string | null;

  actor_type: string;
  actor_id: string;
  actor_principal_id: string | null;
  zone: string;

  run_id: string | null;
  step_id: string | null;

  stream_type: string;
  stream_id: string;
  stream_seq: number;

  correlation_id: string;
  causation_id: string | null;

  redaction_level: string;
  contains_secrets: boolean;
  data: unknown;
}

export interface EventDetail extends EventRow {
  policy_context: unknown;
  model_context: unknown;
  display: unknown;
  idempotency_key: string | null;
}

export async function listEvents(params: {
  stream_type?: "room" | "thread" | "workspace";
  stream_id?: string;
  from_seq?: number;

  room_id?: string;
  thread_id?: string;
  run_id?: string;
  step_id?: string;
  correlation_id?: string;
  event_type?: string;
  event_types?: string[];
  subject_agent_id?: string;
  subject_principal_id?: string;
  before_recorded_at?: string;
  limit?: number;
}): Promise<EventRow[]> {
  const qs = new URLSearchParams();
  if (params.stream_type) qs.set("stream_type", params.stream_type);
  if (params.stream_id) qs.set("stream_id", params.stream_id);
  if (typeof params.from_seq === "number") qs.set("from_seq", String(params.from_seq));
  if (params.room_id) qs.set("room_id", params.room_id);
  if (params.thread_id) qs.set("thread_id", params.thread_id);
  if (params.run_id) qs.set("run_id", params.run_id);
  if (params.step_id) qs.set("step_id", params.step_id);
  if (params.correlation_id) qs.set("correlation_id", params.correlation_id);
  if (params.event_type) qs.set("event_type", params.event_type);
  if (params.event_types && params.event_types.length > 0) {
    qs.set("event_types", params.event_types.join(","));
  }
  if (params.subject_agent_id) qs.set("subject_agent_id", params.subject_agent_id);
  if (params.subject_principal_id) qs.set("subject_principal_id", params.subject_principal_id);
  if (params.before_recorded_at) qs.set("before_recorded_at", params.before_recorded_at);
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/events${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ events: EventRow[] }>(url);
  return res.events;
}

export async function getEvent(eventId: string): Promise<EventDetail> {
  const res = await apiGet<{ event: EventDetail }>(`/v1/events/${eventId}`);
  return res.event;
}
