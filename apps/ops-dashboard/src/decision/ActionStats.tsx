import { useMemo } from "react";

import { useI18n } from "../i18n/useI18n";
import { useIncidents } from "../incidents/useIncidents";
import { formatDuration } from "../utils/format";

type Row = {
  kind: string;
  total: number;
  resolved: number;
  unresolved: number;
  avgResolveSec: number | null;
  recurrenceRate: number;
};

export function ActionStats(): JSX.Element {
  const { incidents } = useIncidents();
  const { t } = useI18n();

  const rows = useMemo<Row[]>(() => {
    const byKind = new Map<string, Row>();
    for (const incident of incidents) {
      const row =
        byKind.get(incident.kind) ??
        ({
          kind: incident.kind,
          total: 0,
          resolved: 0,
          unresolved: 0,
          avgResolveSec: null,
          recurrenceRate: 0,
        } satisfies Row);
      row.total += 1;
      if (incident.status === "resolved") row.resolved += 1;
      else row.unresolved += 1;
      byKind.set(incident.kind, row);
    }

    return Array.from(byKind.values()).map((row) => {
      const resolved = incidents.filter((incident) => incident.kind === row.kind && incident.status === "resolved");
      const reopen = incidents.filter((incident) => incident.kind === row.kind && incident.reopenCount > 0).length;
      const avgResolveSec =
        resolved.length === 0
          ? null
          : Math.floor(
              resolved.reduce((sum, incident) => {
                if (!incident.resolvedAt) return sum;
                const opened = Date.parse(incident.openedAt);
                const closed = Date.parse(incident.resolvedAt);
                if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed <= opened) return sum;
                return sum + Math.floor((closed - opened) / 1000);
              }, 0) / resolved.length,
            );

      return {
        ...row,
        avgResolveSec,
        recurrenceRate: row.total > 0 ? Math.round((reopen / row.total) * 100) : 0,
      };
    });
  }, [incidents]);

  if (rows.length === 0) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.actionStats.empty")}</div>;
  }

  return (
    <section className="rounded border bg-white p-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-2 py-1">{t("decision.actionStats.columns.kind")}</th>
              <th className="px-2 py-1">{t("decision.actionStats.columns.total")}</th>
              <th className="px-2 py-1">{t("decision.actionStats.columns.resolved")}</th>
              <th className="px-2 py-1">{t("decision.actionStats.columns.unresolved")}</th>
              <th className="px-2 py-1">{t("decision.actionStats.columns.avgResolve")}</th>
              <th className="px-2 py-1">{t("decision.actionStats.columns.recurrence")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} className="border-t">
                <td className="px-2 py-1 font-medium">{row.kind}</td>
                <td className="px-2 py-1">{row.total}</td>
                <td className="px-2 py-1">{row.resolved}</td>
                <td className="px-2 py-1">{row.unresolved}</td>
                <td className="px-2 py-1">{formatDuration(row.avgResolveSec)}</td>
                <td className="px-2 py-1">{row.recurrenceRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
