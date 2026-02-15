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
  run_id?: string;
  step_id?: string;
  correlation_id?: string;
  event_type?: string;
  limit?: number;
}): Promise<EventRow[]> {
  const qs = new URLSearchParams();
  if (params.run_id) qs.set("run_id", params.run_id);
  if (params.step_id) qs.set("step_id", params.step_id);
  if (params.correlation_id) qs.set("correlation_id", params.correlation_id);
  if (params.event_type) qs.set("event_type", params.event_type);
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/events${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ events: EventRow[] }>(url);
  return res.events;
}

export async function getEvent(eventId: string): Promise<EventDetail> {
  const res = await apiGet<{ event: EventDetail }>(`/v1/events/${eventId}`);
  return res.event;
}

