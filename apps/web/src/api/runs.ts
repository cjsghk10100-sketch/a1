import { apiGet } from "./http";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";
export type StepStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunRow {
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  status: RunStatus;

  title: string | null;
  goal: string | null;
  input: unknown;
  output: unknown;
  error: unknown;
  tags: string[] | null;

  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;

  correlation_id: string;
  last_event_id: string | null;
}

export interface StepRow {
  step_id: string;
  run_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;

  kind: string;
  status: StepStatus;
  title: string | null;
  input: unknown;
  output: unknown;
  error: unknown;

  created_at: string;
  updated_at: string;
  last_event_id: string | null;
}

export async function getRun(runId: string): Promise<RunRow> {
  const res = await apiGet<{ run: RunRow }>(`/v1/runs/${runId}`);
  return res.run;
}

export async function listRunSteps(runId: string): Promise<StepRow[]> {
  const res = await apiGet<{ steps: StepRow[] }>(`/v1/runs/${runId}/steps`);
  return res.steps;
}

export async function listRuns(params?: {
  limit?: number;
  room_id?: string;
  status?: RunStatus;
}): Promise<RunRow[]> {
  const qs = new URLSearchParams();
  const limitRaw = Number(params?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  qs.set("limit", String(limit));
  if (params?.room_id) qs.set("room_id", params.room_id);
  if (params?.status) qs.set("status", params.status);

  const url = `/v1/runs?${qs.toString()}`;
  const res = await apiGet<{ runs: RunRow[] }>(url);
  return res.runs;
}
