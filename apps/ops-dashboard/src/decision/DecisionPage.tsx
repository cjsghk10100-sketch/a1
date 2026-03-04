import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useDashboardContext } from "../config/DashboardContext";
import { useI18n } from "../i18n/useI18n";
import { DecisionPollers } from "./DecisionPollers";

export function DecisionPage(): JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const { workspaceId } = useDashboardContext();

  const links: Array<{ to: string; label: string; exact?: boolean }> = [
    { to: "/decision", label: t("decision.nav.overview"), exact: true },
    { to: "/decision/timeline", label: t("decision.nav.timeline") },
    { to: "/decision/causes", label: t("decision.nav.causes") },
    { to: "/decision/trends", label: t("decision.nav.trends") },
    { to: "/decision/finance", label: t("decision.nav.finance") },
  ] as const;

  return (
    <section className="space-y-3">
      <DecisionPollers />
      <div className="text-xs text-slate-500">{t("decision.scopeHint", { value: workspaceId })}</div>
      <nav className="flex flex-wrap gap-2 rounded border bg-white p-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={`${link.to}${location.search}`}
            end={link.exact}
            className={({ isActive }) =>
              `rounded px-2 py-1 text-sm ${isActive ? "bg-slate-200 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-100"}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
