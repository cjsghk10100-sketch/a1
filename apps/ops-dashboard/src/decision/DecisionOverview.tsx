import { Link, useLocation } from "react-router-dom";

import { useDashboardContext } from "../config/DashboardContext";
import { useI18n } from "../i18n/useI18n";

function Card({
  title,
  value,
  to,
  detailLabel,
}: {
  title: string;
  value: string;
  to: string;
  detailLabel: string;
}): JSX.Element {
  const location = useLocation();
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-xl font-semibold text-slate-800">{value}</div>
      <div className="mt-2">
        <Link to={`${to}${location.search}`} className="text-sm text-blue-600 hover:underline">
          {detailLabel}
        </Link>
      </div>
    </div>
  );
}

export function DecisionOverview(): JSX.Element {
  const { incidents, slaSnapshots, panelData } = useDashboardContext();
  const { t } = useI18n();

  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const totalViolation = activeIncidents.reduce((sum, incident) => sum + incident.slaViolationSec, 0);
  const financeWarnings = panelData.finance?.warnings?.length ?? 0;
  const topIssueKinds = new Set(activeIncidents.map((incident) => incident.kind)).size;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">{t("decision.overview.title")}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Card
          title={t("decision.overview.cards.timeline")}
          value={String(incidents.length)}
          to="/decision/timeline"
          detailLabel={t("decision.openDetail")}
        />
        <Card
          title={t("decision.overview.cards.causes")}
          value={String(topIssueKinds)}
          to="/decision/causes"
          detailLabel={t("decision.openDetail")}
        />
        <Card
          title={t("decision.overview.cards.sla")}
          value={t("decision.minutesValue", { value: Math.floor(totalViolation / 60) })}
          to="/decision/trends"
          detailLabel={t("decision.openDetail")}
        />
        <Card
          title={t("decision.overview.cards.finance")}
          value={String(financeWarnings)}
          to="/decision/finance"
          detailLabel={t("decision.openDetail")}
        />
      </div>
      {slaSnapshots.length === 0 ? (
        <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.overview.collecting")}</div>
      ) : null}
    </section>
  );
}
