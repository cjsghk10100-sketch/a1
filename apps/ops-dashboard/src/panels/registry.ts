import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

import type { I18nKey } from "../i18n/messages";

export type PanelMode = "summary" | "full";

export type PanelComponentProps = {
  mode?: PanelMode;
};

export type PanelDefinition = {
  id: string;
  labelKey: I18nKey;
  icon?: ComponentType;
  route: `/${string}`;
  component: LazyExoticComponent<ComponentType<PanelComponentProps>>;
  pollIntervalMs?: number;
  gridSpan?: 1 | 2;
};

export const PANEL_REGISTRY: PanelDefinition[] = [
  {
    id: "health",
    labelKey: "panel.health.label",
    route: "/health",
    component: lazy(() => import("./HealthPanel")),
    pollIntervalMs: 15_000,
    gridSpan: 1,
  },
  {
    id: "finance",
    labelKey: "panel.finance.label",
    route: "/finance",
    component: lazy(() => import("./FinancePanel")),
    pollIntervalMs: 30_000,
    gridSpan: 1,
  },
];
