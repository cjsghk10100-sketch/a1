import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import type { PanelStatusSnapshot } from "./config/DashboardContext";
import { ActionStats } from "./decision/ActionStats";
import { CauseDistribution } from "./decision/CauseDistribution";
import { DecisionOverview } from "./decision/DecisionOverview";
import { DecisionPage } from "./decision/DecisionPage";
import { FinanceTrends } from "./decision/FinanceTrends";
import { IncidentTimeline } from "./decision/IncidentTimeline";
import { SLATrends } from "./decision/SLATrends";
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
  return <Navigate to={`/overview${location.search}`} replace />;
}

function CoreDefaultRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/overview${location.search}`} replace />;
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
        <Route path="core">
          <Route index element={<CoreDefaultRedirect />} />
          <Route path="overview" element={<OpsOverview panels={panels} />} />
          {panels.map((panel) => (
            <Route key={`core:${panel.id}`} path={panel.route.slice(1)} element={<PanelPage panel={panel} />} />
          ))}
        </Route>
        <Route path="decision" element={<DecisionPage />}>
          <Route index element={<DecisionOverview />} />
          <Route path="timeline" element={<IncidentTimeline />} />
          <Route path="causes" element={<CauseDistribution />} />
          <Route
            path="trends"
            element={
              <div className="space-y-3">
                <SLATrends />
                <ActionStats />
              </div>
            }
          />
          <Route path="finance" element={<FinanceTrends />} />
        </Route>
        {panels.map((panel) => (
          <Route key={panel.id} path={panel.route.slice(1)} element={<PanelPage panel={panel} />} />
        ))}
      </Route>
    </Routes>
  );
}
