import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { ApiClient } from "../api/apiClient";
import type { ApiErrorInfo } from "../api/types";

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
  panelStatuses: Record<string, PanelStatusSnapshot>;
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
