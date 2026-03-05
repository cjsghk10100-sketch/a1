import type { ComponentType } from "react";

import type { I18nKey } from "../i18n/messages";
import HealthPanel from "./HealthPanel";
import FinancePanel from "./FinancePanel";

export type PanelMode = "summary" | "full";

export type PanelComponentProps = {
  mode?: PanelMode;
};

export type PanelDefinition = {
  id: string;
  labelKey: I18nKey;
  icon?: ComponentType;
  route: `/${string}`;
  component: ComponentType<PanelComponentProps>;
  pollIntervalMs?: number;
  gridSpan?: 1 | 2;
};

export const PANEL_REGISTRY: PanelDefinition[] = [
  {
    id: "health",
    labelKey: "panel.health.label",
    route: "/health",
    component: HealthPanel,
    pollIntervalMs: 15_000,
    gridSpan: 1,
  },
  {
    id: "finance",
    labelKey: "panel.finance.label",
    route: "/finance",
    component: FinancePanel,
    pollIntervalMs: 30_000,
    gridSpan: 1,
  },
];
