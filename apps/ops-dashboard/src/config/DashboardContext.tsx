import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { ApiClient } from "../api/apiClient";
import type { ApiErrorInfo } from "../api/types";
import type { FinanceResponse, HealthResponse } from "../api/types";

export type DashboardIncident = {
  id: string;
  kind: string;
  severity: "DOWN" | "DEGRADED";
  status: "open" | "ack" | "resolved";
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  lastSeenAt: string;
  reopenCount: number;
  slaViolationSec: number;
  entityId: string | null;
};

export type DashboardSlaSnapshot = {
  at: string;
  totalViolationSec: number;
  openCount: number;
  systemStatus: "OK" | "DEGRADED" | "DOWN";
};

export type PanelStatusSnapshot = {
  panelId: string;
  status: "OK" | "DEGRADED" | "DOWN" | null;
  lastUpdatedAt: Date | null;
  error: ApiErrorInfo | null;
};

export type DashboardContextValue = {
  client: ApiClient;
  workspaceId: string;
  refreshNonce: number;
  registerRefresh: (panelId: string, cb: () => void) => () => void;
  reportPanelStatus: (snapshot: PanelStatusSnapshot) => void;
  reportPanelData: (panelId: "health" | "finance", data: HealthResponse | FinanceResponse) => void;
  panelStatuses: Record<string, PanelStatusSnapshot>;
  panelData: {
    health: HealthResponse | null;
    finance: FinanceResponse | null;
  };
  incidents: DashboardIncident[];
  slaSnapshots: DashboardSlaSnapshot[];
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardContextValue;
  children: ReactNode;
}): JSX.Element {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("DashboardContext is unavailable");
  return ctx;
}
