import { apiGet, apiPost } from "./http";

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

export async function createToolCall(
  stepId: string,
  input: { tool_name: string; title?: string; input?: unknown; agent_id?: string },
): Promise<{ tool_call_id: string }> {
  return await apiPost<{ tool_call_id: string }>(`/v1/steps/${encodeURIComponent(stepId)}/toolcalls`, input);
}

export async function succeedToolCall(toolCallId: string, input: { output?: unknown }): Promise<{ ok: true }> {
  return await apiPost<{ ok: true }>(`/v1/toolcalls/${encodeURIComponent(toolCallId)}/succeed`, input);
}

export async function failToolCall(
  toolCallId: string,
  input: { message?: string; error?: unknown },
): Promise<{ ok: true }> {
  return await apiPost<{ ok: true }>(`/v1/toolcalls/${encodeURIComponent(toolCallId)}/fail`, input);
}
