import type { EngineRecordV1, EngineTokenRecordV1 } from "@agentapp/shared";

import { apiGet, apiPost } from "./http";

export async function listEngines(): Promise<EngineRecordV1[]> {
  const res = await apiGet<{ engines: EngineRecordV1[] }>("/v1/engines");
  return res.engines ?? [];
}

export async function listEngineTokens(engine_id: string): Promise<EngineTokenRecordV1[]> {
  const res = await apiGet<{ tokens: EngineTokenRecordV1[] }>(
    `/v1/engines/${encodeURIComponent(engine_id)}/tokens`,
  );
  return res.tokens ?? [];
}

export async function deactivateEngine(
  engine_id: string,
  reason?: string,
): Promise<{ ok: true }> {
  return await apiPost<{ ok: true }>(`/v1/engines/${encodeURIComponent(engine_id)}/deactivate`, {
    reason,
  });
}
