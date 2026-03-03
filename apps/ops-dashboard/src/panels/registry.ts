import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

export type PanelMode = "summary" | "full";

export type PanelComponentProps = {
  mode?: PanelMode;
};

export type PanelDefinition = {
  id: string;
  label: string;
  icon?: ComponentType;
  route: `/${string}`;
  component: LazyExoticComponent<ComponentType<PanelComponentProps>>;
  pollIntervalMs?: number;
  gridSpan?: 1 | 2;
};

export const PANEL_REGISTRY: PanelDefinition[] = [
  {
    id: "health",
    label: "System Health",
    route: "/health",
    component: lazy(() => import("./HealthPanel")),
    pollIntervalMs: 15_000,
    gridSpan: 1,
  },
  {
    id: "finance",
    label: "Finance",
    route: "/finance",
    component: lazy(() => import("./FinancePanel")),
    pollIntervalMs: 30_000,
    gridSpan: 1,
  },
];
