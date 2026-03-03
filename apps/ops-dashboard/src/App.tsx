import { BrowserRouter } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClient } from "./api/apiClient";
import { ConfigProvider } from "./config/ConfigContext";
import { DashboardProvider, type PanelStatusSnapshot } from "./config/DashboardContext";
import type { AppConfig } from "./config/loadConfig";
import { useWorkspace } from "./hooks/useWorkspace";
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

export function App({ config }: { config: AppConfig }): JSX.Element {
  const { workspaceId, setWorkspace } = useWorkspace(config);
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PanelStatusSnapshot>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);

  const refreshHandlersRef = useRef<Map<string, () => void>>(new Map());

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

  const registerRefresh = useCallback((panelId: string, cb: () => void) => {
    refreshHandlersRef.current.set(panelId, cb);
    return () => {
      refreshHandlersRef.current.delete(panelId);
    };
  }, []);

  const reportPanelStatus = useCallback((snapshot: PanelStatusSnapshot) => {
    setPanelStatuses((prev) => ({
      ...prev,
      [snapshot.panelId]: snapshot,
    }));
  }, []);

  const onWorkspaceChange = useCallback(
    (nextWorkspaceId: string) => {
      const normalized = nextWorkspaceId.trim();
      if (!normalized || normalized === workspaceId) return;
      setWorkspace(normalized);
      setPanelStatuses({});
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
    const snapshots = Object.values(panelStatuses);
    if (snapshots.length < PANEL_REGISTRY.length) return false;
    return snapshots.every((snapshot) => snapshot.error != null);
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
      panelStatuses,
    }),
    [client, workspaceId, refreshNonce, registerRefresh, reportPanelStatus, panelStatuses],
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
