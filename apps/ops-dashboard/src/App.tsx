import { BrowserRouter } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClient } from "./api/apiClient";
import type { FinanceResponse, HealthResponse, TopIssue } from "./api/types";
import { ConfigProvider } from "./config/ConfigContext";
import {
  DashboardProvider,
  type DashboardIncident,
  type DashboardSlaSnapshot,
  type PanelStatusSnapshot,
} from "./config/DashboardContext";
import type { AppConfig } from "./config/loadConfig";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  activeIncidentCount,
  appendSlaSnapshot,
  syncTopIssues,
  tickIncidentSla,
  totalViolationSec,
} from "./incidents/store";
import { PANEL_REGISTRY } from "./panels/registry";
import { DashboardRouter } from "./router";
import type { PollingDotState } from "./shared/PollingDot";

function reduceGlobalStatus(statuses: Record<string, PanelStatusSnapshot>): "OK" | "DEGRADED" | "DOWN" | null {
  const values = Object.values(statuses)
    .map((item) => item.status)
    .filter((status): status is "OK" | "DEGRADED" | "DOWN" => status != null);

  if (values.includes("DOWN")) return "DOWN";
  if (values.includes("DEGRADED")) return "DEGRADED";
  if (values.includes("OK")) return "OK";
  return null;
}

function latestTimestamp(statuses: Record<string, PanelStatusSnapshot>): Date | null {
  return Object.values(statuses).reduce<Date | null>((latest, current) => {
    if (!current.lastUpdatedAt) return latest;
    if (!latest || current.lastUpdatedAt.getTime() > latest.getTime()) {
      return current.lastUpdatedAt;
    }
    return latest;
  }, null);
}

function shouldShowGlobalError(
  statuses: Record<string, PanelStatusSnapshot>,
  requiredCount: number,
): boolean {
  const snapshots = Object.values(statuses);
  if (snapshots.length < requiredCount) return false;
  if (!snapshots.every((snapshot) => snapshot.error != null)) return false;

  const now = Date.now();
  const hasRecentSuccess = snapshots.some((snapshot) => {
    if (!snapshot.lastUpdatedAt) return false;
    return now - snapshot.lastUpdatedAt.getTime() <= 120_000;
  });
  return !hasRecentSuccess;
}

export function App({ config }: { config: AppConfig }): JSX.Element {
  const { workspaceId, setWorkspace } = useWorkspace(config);
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelStatusSnapshot>>({});
  const [panelData, setPanelData] = useState<{
    health: HealthResponse | null;
    finance: FinanceResponse | null;
  }>({
    health: null,
    finance: null,
  });
  const [incidents, setIncidents] = useState<DashboardIncident[]>([]);
  const [slaSnapshots, setSlaSnapshots] = useState<DashboardSlaSnapshot[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);

  const refreshHandlersRef = useRef<Map<string, () => void>>(new Map());
  const lastSlaTickMsRef = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl: config.apiBaseUrl,
        workspaceId,
        bearerToken: config.bearerToken,
        schemaVersion: config.schemaVersion,
        timeoutMs: 15_000,
      }),
    [config.apiBaseUrl, config.bearerToken, config.schemaVersion, workspaceId],
  );

  useEffect(() => {
    if (panelData.health && panelData.finance) return;

    const healthAbort = new AbortController();
    const financeAbort = new AbortController();
    let cancelled = false;

    const preload = async () => {
      const [healthResult, financeResult] = await Promise.all([
        panelData.health
          ? Promise.resolve({ ok: false as const })
          : client.post<HealthResponse>(
              "/v1/system/health",
              { schema_version: config.schemaVersion },
              healthAbort.signal,
            ),
        panelData.finance
          ? Promise.resolve({ ok: false as const })
          : client.post<FinanceResponse>(
              "/v1/finance/projection",
              {
                schema_version: config.schemaVersion,
                days_back: config.financeDaysBack,
                include: ["top_models"],
              },
              financeAbort.signal,
            ),
      ]);

      if (cancelled) return;
      setPanelData((prev) => ({
        health: healthResult.ok ? healthResult.data : prev.health,
        finance: financeResult.ok ? financeResult.data : prev.finance,
      }));
    };

    void preload();
    return () => {
      cancelled = true;
      healthAbort.abort();
      financeAbort.abort();
    };
  }, [client, config.financeDaysBack, config.schemaVersion, panelData.finance, panelData.health]);

  const registerRefresh = useCallback((panelId: string, cb: () => void) => {
    refreshHandlersRef.current.set(panelId, cb);
    return () => {
      refreshHandlersRef.current.delete(panelId);
    };
  }, []);

  const reportPanelStatus = useCallback((snapshot: PanelStatusSnapshot) => {
    setPanelStatuses((prev) => {
      const previous = prev[snapshot.panelId];
      // Ignore transient mount/loading snapshots so route switches don't downgrade to UNKNOWN.
      if (snapshot.status == null && snapshot.error == null && snapshot.lastUpdatedAt == null && previous) {
        return prev;
      }
      return {
        ...prev,
        [snapshot.panelId]: {
          ...snapshot,
          status: snapshot.status ?? previous?.status ?? null,
          lastUpdatedAt: snapshot.lastUpdatedAt ?? previous?.lastUpdatedAt ?? null,
          error: snapshot.error ?? null,
        },
      };
    });
  }, []);

  const reportPanelData = useCallback((panelId: "health" | "finance", data: HealthResponse | FinanceResponse) => {
    setPanelData((prev) => ({
      ...prev,
      [panelId]: data,
    }));

    if (panelId !== "health") return;

    const health = data as HealthResponse;
    const topIssues: TopIssue[] = health.top_issues ?? health.summary?.top_issues ?? [];
    const nowIso = health.server_time ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const lastTickMs = lastSlaTickMsRef.current ?? nowMs;
    lastSlaTickMsRef.current = nowMs;
    const elapsedSec = Math.max(0, Math.floor((nowMs - lastTickMs) / 1000));

    setIncidents((prev) => {
      const ticked = tickIncidentSla(prev, elapsedSec);
      const next = syncTopIssues(ticked, topIssues, nowIso);
      const summaryStatus = health.summary?.status ?? health.summary?.health_summary ?? "OK";
      setSlaSnapshots((snapshots) =>
        appendSlaSnapshot(snapshots, {
          at: nowIso,
          totalViolationSec: totalViolationSec(next),
          openCount: activeIncidentCount(next),
          systemStatus: summaryStatus,
        }),
      );
      return next;
    });
  }, []);

  const onWorkspaceChange = useCallback(
    (nextWorkspaceId: string) => {
      const normalized = nextWorkspaceId.trim();
      if (!normalized || normalized === workspaceId) return;
      setWorkspace(normalized);
      setPanelStatuses({});
      setPanelData({ health: null, finance: null });
      setIncidents([]);
      setSlaSnapshots([]);
      lastSlaTickMsRef.current = null;
      refreshHandlersRef.current.clear();
      setRefreshNonce((prev) => prev + 1);
    },
    [setWorkspace, workspaceId],
  );

  const onRefreshAll = useCallback(() => {
    for (const refresh of refreshHandlersRef.current.values()) {
      refresh();
    }
  }, []);

  const globalStatus = useMemo(() => reduceGlobalStatus(panelStatuses), [panelStatuses]);
  const lastUpdatedAt = useMemo(() => latestTimestamp(panelStatuses), [panelStatuses]);
  const showGlobalError = useMemo(() => {
    return shouldShowGlobalError(panelStatuses, PANEL_REGISTRY.length);
  }, [panelStatuses]);

  const pollingState: PollingDotState = useMemo(() => {
    if (hidden) return "paused";
    const snapshots = Object.values(panelStatuses);
    if (snapshots.some((item) => item.error != null)) return "error";
    if (snapshots.length === 0 || snapshots.some((item) => item.lastUpdatedAt == null)) return "active";
    return "idle";
  }, [hidden, panelStatuses]);

  const dashboardContextValue = useMemo(
    () => ({
      client,
      workspaceId,
      refreshNonce,
      registerRefresh,
      reportPanelStatus,
      reportPanelData,
      panelStatuses,
      panelData,
      incidents,
      slaSnapshots,
    }),
    [
      client,
      workspaceId,
      refreshNonce,
      registerRefresh,
      reportPanelStatus,
      reportPanelData,
      panelStatuses,
      panelData,
      incidents,
      slaSnapshots,
    ],
  );

  return (
    <ConfigProvider value={{ config }}>
      <DashboardProvider value={dashboardContextValue}>
        <BrowserRouter>
          <DashboardRouter
            panels={PANEL_REGISTRY}
            panelStatuses={panelStatuses}
            workspaceId={workspaceId}
            onWorkspaceChange={onWorkspaceChange}
            globalStatus={globalStatus}
            pollingState={pollingState}
            lastUpdatedAt={lastUpdatedAt}
            onRefreshAll={onRefreshAll}
            showGlobalError={showGlobalError}
            apiBaseUrl={config.apiBaseUrl}
          />
        </BrowserRouter>
      </DashboardProvider>
    </ConfigProvider>
  );
}
