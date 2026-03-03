import type { ApiClient } from "../../api/apiClient";
import type { ApiResult, FinanceResponse } from "../../api/types";

export async function fetchFinance(
  client: ApiClient,
  schemaVersion: string,
  daysBack: number,
  includeTopModels: boolean,
  signal?: AbortSignal,
): Promise<ApiResult<FinanceResponse>> {
  const body: Record<string, unknown> = {
    schema_version: schemaVersion,
    days_back: daysBack,
  };
  if (includeTopModels) {
    body.include = ["top_models"];
  }
  return client.post<FinanceResponse>("/v1/finance/projection", body, signal);
}
