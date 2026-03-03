import { Outlet } from "react-router-dom";

import type { PanelStatusSnapshot } from "../config/DashboardContext";
import { useI18n } from "../i18n/useI18n";
import type { PanelDefinition } from "../panels/registry";
import type { PollingDotState } from "../shared/PollingDot";
import { GlobalHeader } from "./GlobalHeader";
import { Sidebar } from "./Sidebar";

export function OpsLayout({
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
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col">
      <GlobalHeader
        workspaceId={workspaceId}
        onWorkspaceChange={onWorkspaceChange}
        globalStatus={globalStatus}
        pollingState={pollingState}
        lastUpdatedAt={lastUpdatedAt}
        onRefreshAll={onRefreshAll}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar panels={panels} statuses={panelStatuses} />
        <main className="relative flex-1 p-4">
          {showGlobalError ? (
            <div className="mb-3 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <div className="font-medium">{t("layout.globalError.title")}</div>
              <div className="mt-1">{t("layout.globalError.baseUrl", { value: apiBaseUrl })}</div>
              <button type="button" className="mt-2 rounded border px-2 py-1" onClick={onRefreshAll}>
                {t("layout.globalError.retry")}
              </button>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
