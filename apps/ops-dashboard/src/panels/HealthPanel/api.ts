import type { ApiClient } from "../../api/apiClient";
import type { ApiResult, DrilldownResponse, HealthIssueKind, HealthResponse } from "../../api/types";

export async function fetchHealth(
  client: ApiClient,
  schemaVersion: string,
  signal?: AbortSignal,
): Promise<ApiResult<HealthResponse>> {
  return client.post<HealthResponse>("/v1/system/health", { schema_version: schemaVersion }, signal);
}

export async function fetchDrilldown(
  client: ApiClient,
  schemaVersion: string,
  kind: HealthIssueKind,
  limit = 20,
  cursor?: string,
  signal?: AbortSignal,
): Promise<ApiResult<DrilldownResponse>> {
  const params: Record<string, string> = {
    kind,
    limit: String(limit),
    schema_version: schemaVersion,
  };
  if (cursor) {
    params.cursor = cursor;
  }
  return client.get<DrilldownResponse>("/v1/system/health/issues", params, signal);
}
