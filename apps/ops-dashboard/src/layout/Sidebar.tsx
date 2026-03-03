import { NavLink, useLocation } from "react-router-dom";

import type { PanelStatusSnapshot } from "../config/DashboardContext";
import type { PanelDefinition } from "../panels/registry";
import { StatusBadge } from "../shared/StatusBadge";

export function Sidebar({
  panels,
  statuses,
}: {
  panels: PanelDefinition[];
  statuses: Record<string, PanelStatusSnapshot>;
}): JSX.Element {
  const location = useLocation();
  const search = location.search;

  return (
    <aside className="w-64 shrink-0 border-r bg-white p-3">
      <div className="mb-2 text-sm font-semibold text-slate-700">Panels</div>
      <nav className="space-y-2">
        <NavLink
          to={`/overview${search}`}
          className={({ isActive }) =>
            `block rounded px-3 py-2 text-sm ${isActive ? "bg-slate-200 font-medium" : "hover:bg-slate-100"}`
          }
        >
          Overview
        </NavLink>

        {panels.map((panel) => {
          const status = statuses[panel.id]?.status ?? null;
          return (
            <NavLink
              key={panel.id}
              to={`${panel.route}${search}`}
              className={({ isActive }) =>
                `flex items-center justify-between rounded px-3 py-2 text-sm ${isActive ? "bg-slate-200 font-medium" : "hover:bg-slate-100"}`
              }
            >
              <span>{panel.label}</span>
              <StatusBadge status={status} />
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
