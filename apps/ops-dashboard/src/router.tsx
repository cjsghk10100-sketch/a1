import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import type { PanelStatusSnapshot } from "./config/DashboardContext";
import { OpsLayout } from "./layout/OpsLayout";
import type { PanelDefinition } from "./panels/registry";
import { OpsOverview } from "./pages/OpsOverview";
import { PanelPage } from "./pages/PanelPage";
import type { PollingDotState } from "./shared/PollingDot";

export function buildPanelRoutes(panels: PanelDefinition[]): string[] {
  return panels.map((panel) => panel.route);
}

function DefaultRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/health${location.search}`} replace />;
}

export function DashboardRouter({
  panels,
  panelStatuses,
  workspaceId,
  onWorkspaceChange,
  globalStatus,
  pollingState,
  lastUpdatedAt,
  onRefreshAll,
  showGlobalError,
  apiBaseUrl,
}: {
  panels: PanelDefinition[];
  panelStatuses: Record<string, PanelStatusSnapshot>;
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  globalStatus: "OK" | "DEGRADED" | "DOWN" | null;
  pollingState: PollingDotState;
  lastUpdatedAt: Date | null;
  onRefreshAll: () => void;
  showGlobalError: boolean;
  apiBaseUrl: string;
}): JSX.Element {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <OpsLayout
            panels={panels}
            panelStatuses={panelStatuses}
            workspaceId={workspaceId}
            onWorkspaceChange={onWorkspaceChange}
            globalStatus={globalStatus}
            pollingState={pollingState}
            lastUpdatedAt={lastUpdatedAt}
            onRefreshAll={onRefreshAll}
            showGlobalError={showGlobalError}
            apiBaseUrl={apiBaseUrl}
          />
        }
      >
        <Route index element={<DefaultRedirect />} />
        <Route path="overview" element={<OpsOverview panels={panels} />} />
        {panels.map((panel) => (
          <Route key={panel.id} path={panel.route.slice(1)} element={<PanelPage panel={panel} />} />
        ))}
      </Route>
    </Routes>
  );
}
