import { apiGet } from "./http";

export type ToolCallStatus = "running" | "succeeded" | "failed";

export interface ToolCallRow {
  tool_call_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string;
  step_id: string;

  tool_name: string;
  title: string | null;
  status: ToolCallStatus;

  input: unknown;
  output: unknown;
  error: unknown;

  started_at: string;
  ended_at: string | null;
  updated_at: string;

  correlation_id: string;
  last_event_id: string | null;
}

export async function listToolCalls(params: { run_id?: string; step_id?: string; limit?: number }): Promise<ToolCallRow[]> {
  const qs = new URLSearchParams();
  if (params.run_id) qs.set("run_id", params.run_id);
  if (params.step_id) qs.set("step_id", params.step_id);
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/toolcalls${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ tool_calls: ToolCallRow[] }>(url);
  return res.tool_calls;
}

