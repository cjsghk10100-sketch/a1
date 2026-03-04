import { useCallback, useEffect, useMemo } from "react";

import type { FinanceWarning, HealthResponse } from "../api/types";
import { useConfig } from "../config/ConfigContext";
import { useDashboardContext } from "../config/DashboardContext";
import { usePolling } from "../hooks/usePolling";
import { fetchFinance } from "../panels/FinancePanel/api";
import { fetchHealth } from "../panels/HealthPanel/api";

function warningKind(warning: FinanceWarning): string {
  if (typeof warning === "string") return warning;
  return warning.kind;
}

export function DecisionPollers(): null {
  const { config } = useConfig();
  const { client, workspaceId, refreshNonce, registerRefresh, reportPanelStatus, reportPanelData } = useDashboardContext();

  const healthPolling = usePolling(
    useCallback(
      (signal: AbortSignal) => fetchHealth(client, config.schemaVersion, signal),
      [client, config.schemaVersion],
    ),
    config.healthPollSec * 1000,
    {
      minIntervalMs: 15_000,
      resetKey: `${workspaceId}:${refreshNonce}:decision`,
      cacheKey: `health:${workspaceId}`,
    },
  );

  const financePolling = usePolling(
    useCallback(
      (signal: AbortSignal) => fetchFinance(client, config.schemaVersion, config.financeDaysBack, true, signal),
      [client, config.schemaVersion, config.financeDaysBack],
    ),
    config.financePollSec * 1000,
    {
      minIntervalMs: 30_000,
      resetKey: `${workspaceId}:${refreshNonce}:decision`,
      cacheKey: `finance:${workspaceId}:${config.financeDaysBack}:top_models`,
    },
  );

  const healthStatus = useMemo(() => {
    const data = healthPolling.data as HealthResponse | null;
    if (data) return data.summary?.status ?? data.summary?.health_summary ?? "OK";
    if (!healthPolling.error) return null;
    if (healthPolling.error.category === "timeout" || healthPolling.error.category === "network") return "DEGRADED" as const;
    return "DOWN" as const;
  }, [healthPolling.data, healthPolling.error]);

  const financeStatus = useMemo(() => {
    const warnings = financePolling.data?.warnings ?? [];
    const nonBlocking = warnings.length > 0 && warnings.every((warning) => warningKind(warning) === "top_models_unsupported");
    if (!financePolling.data && financePolling.error) {
      if (financePolling.error.category === "timeout" || financePolling.error.category === "network") return "DEGRADED" as const;
      return "DOWN" as const;
    }
    if (financePolling.error && !financePolling.data) return "DEGRADED" as const;
    if (warnings.length > 0 && !nonBlocking) return "DEGRADED" as const;
    if (financePolling.data) return "OK" as const;
    return null;
  }, [financePolling.data, financePolling.error]);

  useEffect(() => registerRefresh("health", healthPolling.forceRefresh), [registerRefresh, healthPolling.forceRefresh]);
  useEffect(() => registerRefresh("finance", financePolling.forceRefresh), [registerRefresh, financePolling.forceRefresh]);

  useEffect(() => {
    reportPanelStatus({
      panelId: "health",
      status: healthStatus,
      lastUpdatedAt: healthPolling.lastUpdatedAt,
      error: healthPolling.error,
    });
  }, [healthStatus, healthPolling.lastUpdatedAt, healthPolling.error, reportPanelStatus]);

  useEffect(() => {
    if (!healthPolling.data) return;
    reportPanelData("health", healthPolling.data);
  }, [healthPolling.data, reportPanelData]);

  useEffect(() => {
    reportPanelStatus({
      panelId: "finance",
      status: financeStatus,
      lastUpdatedAt: financePolling.lastUpdatedAt,
      error: financePolling.error,
    });
  }, [financeStatus, financePolling.lastUpdatedAt, financePolling.error, reportPanelStatus]);

  useEffect(() => {
    if (!financePolling.data) return;
    reportPanelData("finance", financePolling.data);
  }, [financePolling.data, reportPanelData]);

  return null;
}
