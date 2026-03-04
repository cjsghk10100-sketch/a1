import { useCallback, useEffect, useMemo } from "react";

import type { FinanceResponse, FinanceWarning } from "../../api/types";
import { useConfig } from "../../config/ConfigContext";
import { useDashboardContext } from "../../config/DashboardContext";
import { usePolling } from "../../hooks/usePolling";
import { DataExport } from "../../shared/DataExport";
import { ErrorBanner } from "../../shared/ErrorBanner";
import { LoadingSkele } from "../../shared/LoadingSkele";
import { CostChart } from "./CostChart";
import { fetchFinance } from "./api";
import { TopModelsList } from "./TopModelsList";
import { TotalsSummary } from "./TotalsSummary";
import { WarningsBanner } from "./WarningsBanner";

export interface FinancePanelProps {
  mode?: "summary" | "full";
}

function normalizeWarnings(input: FinanceResponse["warnings"] | undefined): FinanceWarning[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [];
}

export default function FinancePanel({ mode = "full" }: FinancePanelProps): JSX.Element {
  const { config } = useConfig();
  const { client, workspaceId, refreshNonce, registerRefresh, reportPanelStatus, reportPanelData } = useDashboardContext();
  const financeFetcher = useCallback(
    (signal: AbortSignal) =>
      fetchFinance(client, config.schemaVersion, config.financeDaysBack, true, signal),
    [client, config.schemaVersion, config.financeDaysBack],
  );

  const polling = usePolling<FinanceResponse>(
    financeFetcher,
    config.financePollSec * 1000,
    {
      minIntervalMs: 30_000,
      resetKey: `${workspaceId}:${refreshNonce}`,
      cacheKey: `finance:${workspaceId}:${config.financeDaysBack}:top_models`,
    },
  );

  useEffect(() => {
    return registerRefresh("finance", polling.forceRefresh);
  }, [registerRefresh, polling.forceRefresh]);

  const warnings = useMemo(() => normalizeWarnings(polling.data?.warnings), [polling.data?.warnings]);
  const nonBlockingWarningsOnly = useMemo(() => {
    if (warnings.length === 0) return false;
    return warnings.every((warning) => warningKind(warning) === "top_models_unsupported");
  }, [warnings]);

  const panelStatus = useMemo(() => {
    if (!polling.data && polling.error) {
      if (polling.error.category === "timeout" || polling.error.category === "network") {
        return "DEGRADED" as const;
      }
      return "DOWN" as const;
    }
    if (polling.error) {
      const isTransient = polling.error.category === "timeout" || polling.error.category === "network";
      // Keep panel status stable when stale data exists and only transient poll failure happened.
      if (!polling.data || !isTransient) return "DEGRADED" as const;
    }
    if (warnings.length > 0 && !nonBlockingWarningsOnly) return "DEGRADED" as const;
    if (polling.data) return "OK" as const;
    return null;
  }, [polling.data, polling.error, warnings.length, nonBlockingWarningsOnly]);

  useEffect(() => {
    reportPanelStatus({
      panelId: "finance",
      status: panelStatus,
      lastUpdatedAt: polling.lastUpdatedAt,
      error: polling.error,
    });
  }, [panelStatus, polling.lastUpdatedAt, polling.error, reportPanelStatus]);

  useEffect(() => {
    if (!polling.data) return;
    reportPanelData("finance", polling.data);
  }, [polling.data, reportPanelData]);

  if (!polling.data && !polling.error) {
    return <LoadingSkele lines={mode === "summary" ? 6 : 9} />;
  }

  return (
    <div className="space-y-3">
      {polling.error ? (
        <ErrorBanner error={polling.error} stale={polling.stale} lastUpdatedAt={polling.lastUpdatedAt} />
      ) : null}

      <div className="flex justify-end">
        <DataExport panelId="finance" workspaceId={workspaceId} data={polling.data ?? {}} />
      </div>

      <WarningsBanner warnings={warnings} />
      <TotalsSummary totals={polling.data?.totals ?? null} />
      <CostChart series={polling.data?.series_daily ?? []} />

      {mode === "full" ? <TopModelsList models={polling.data?.top_models ?? []} /> : null}
    </div>
  );
}

function warningKind(warning: FinanceWarning): string {
  if (typeof warning === "string") return warning;
  return warning.kind;
}
