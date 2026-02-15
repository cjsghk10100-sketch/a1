import { apiGet } from "./http";

export interface ArtifactRow {
  artifact_id: string;
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string;
  step_id: string;

  kind: string;
  title: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;

  content_type: string | null;
  content_text: string | null;
  content_json: unknown;
  content_uri: string | null;

  metadata: unknown;
  created_at: string;
  updated_at: string;

  correlation_id: string;
  last_event_id: string | null;
}

export async function listArtifacts(params: {
  run_id?: string;
  step_id?: string;
  room_id?: string;
  limit?: number;
}): Promise<ArtifactRow[]> {
  const qs = new URLSearchParams();
  if (params.room_id) qs.set("room_id", params.room_id);
  if (params.run_id) qs.set("run_id", params.run_id);
  if (params.step_id) qs.set("step_id", params.step_id);
  if (params.limit) qs.set("limit", String(params.limit));
  const url = `/v1/artifacts${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await apiGet<{ artifacts: ArtifactRow[] }>(url);
  return res.artifacts;
}

