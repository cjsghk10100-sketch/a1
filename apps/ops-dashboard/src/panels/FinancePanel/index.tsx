import { useEffect, useMemo } from "react";

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
  const { client, workspaceId, refreshNonce, registerRefresh, reportPanelStatus } = useDashboardContext();

  const polling = usePolling<FinanceResponse>(
    (signal) => fetchFinance(client, config.schemaVersion, config.financeDaysBack, true, signal),
    config.financePollSec * 1000,
    {
      minIntervalMs: 30_000,
      resetKey: `${workspaceId}:${refreshNonce}`,
    },
  );

  useEffect(() => {
    return registerRefresh("finance", polling.forceRefresh);
  }, [registerRefresh, polling.forceRefresh]);

  const warnings = useMemo(() => normalizeWarnings(polling.data?.warnings), [polling.data?.warnings]);

  const panelStatus = useMemo(() => {
    if (!polling.data && polling.error) return "DOWN" as const;
    if (polling.error || warnings.length > 0) return "DEGRADED" as const;
    if (polling.data) return "OK" as const;
    return null;
  }, [polling.data, polling.error, warnings.length]);

  useEffect(() => {
    reportPanelStatus({
      panelId: "finance",
      status: panelStatus,
      lastUpdatedAt: polling.lastUpdatedAt,
      error: polling.error,
    });
  }, [panelStatus, polling.lastUpdatedAt, polling.error, reportPanelStatus]);

  if (polling.loading && !polling.data) {
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
