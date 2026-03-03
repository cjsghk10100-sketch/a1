import { Suspense } from "react";
import { Link, useLocation } from "react-router-dom";

import { useDashboardContext } from "../config/DashboardContext";
import { PanelCard } from "../layout/PanelCard";
import type { PanelDefinition } from "../panels/registry";
import { LoadingSkele } from "../shared/LoadingSkele";

export function OpsOverview({ panels }: { panels: PanelDefinition[] }): JSX.Element {
  const { panelStatuses } = useDashboardContext();
  const location = useLocation();

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(480px, 1fr))" }}>
      {panels.map((panel) => {
        const Component = panel.component;
        const status = panelStatuses[panel.id]?.status ?? null;

        return (
          <PanelCard
            key={panel.id}
            title={panel.label}
            status={status}
            action={
              <Link to={`${panel.route}${location.search}`} className="text-xs text-blue-600 hover:underline">
                Open
              </Link>
            }
          >
            <Suspense fallback={<LoadingSkele lines={6} />}>
              <Component mode="summary" />
            </Suspense>
          </PanelCard>
        );
      })}
    </div>
  );
}
