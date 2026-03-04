import { useMemo, useState } from "react";

import { useI18n } from "../i18n/useI18n";
import { useIncidents } from "../incidents/useIncidents";
import { DeepLink } from "../shared/DeepLink";
import { toLocalDateTime } from "../utils/time";

type FilterStatus = "all" | "open" | "ack" | "resolved";
type FilterSeverity = "all" | "DOWN" | "DEGRADED";

export function IncidentTimeline(): JSX.Element {
  const { timeline, incidents } = useIncidents();
  const { t } = useI18n();
  const [status, setStatus] = useState<FilterStatus>("all");
  const [severity, setSeverity] = useState<FilterSeverity>("all");
  const [kind, setKind] = useState<string>("all");

  const kinds = useMemo(() => Array.from(new Set(incidents.map((incident) => incident.kind))).sort(), [incidents]);

  const filtered = useMemo(() => {
    return timeline.filter((event) => {
      if (status !== "all" && event.status !== status) return false;
      if (severity !== "all" && event.severity !== severity) return false;
      if (kind !== "all" && event.kind !== kind) return false;
      return true;
    });
  }, [timeline, status, severity, kind]);

  if (incidents.length === 0) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.timeline.empty")}</div>;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded border bg-white p-3 text-sm">
        <select value={status} onChange={(e) => setStatus(e.target.value as FilterStatus)} className="rounded border px-2 py-1">
          <option value="all">{t("decision.timeline.filters.statusAll")}</option>
          <option value="open">{t("decision.timeline.filters.statusOpen")}</option>
          <option value="ack">{t("decision.timeline.filters.statusAck")}</option>
          <option value="resolved">{t("decision.timeline.filters.statusResolved")}</option>
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as FilterSeverity)}
          className="rounded border px-2 py-1"
        >
          <option value="all">{t("decision.timeline.filters.severityAll")}</option>
          <option value="DOWN">DOWN</option>
          <option value="DEGRADED">DEGRADED</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border px-2 py-1">
          <option value="all">{t("decision.timeline.filters.kindAll")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <ul className="space-y-2">
        {filtered.map((event) => (
          <li key={event.id} className="rounded border bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-800">
                {event.kind} · {event.label}
              </div>
              <div className="text-xs text-slate-500">{toLocalDateTime(event.at)}</div>
            </div>
            <div className="mt-2 text-right">
              <DeepLink
                to="/health"
                incidentId={event.kind}
                label={t("decision.timeline.openCore")}
                className="text-xs text-blue-600 hover:underline"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
