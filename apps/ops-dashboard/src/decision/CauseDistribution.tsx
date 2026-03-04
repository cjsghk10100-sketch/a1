import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useI18n } from "../i18n/useI18n";
import { useIncidents } from "../incidents/useIncidents";
import { formatDuration } from "../utils/format";

type Row = {
  kind: string;
  open: number;
  ack: number;
  resolved: number;
  avg_resolve_sec: number | null;
};

export function CauseDistribution(): JSX.Element {
  const { incidents } = useIncidents();
  const { t } = useI18n();

  const rows: Row[] = Object.values(
    incidents.reduce<Record<string, Row>>((acc, incident) => {
      const current =
        acc[incident.kind] ??
        ({
          kind: incident.kind,
          open: 0,
          ack: 0,
          resolved: 0,
          avg_resolve_sec: null,
        } satisfies Row);

      current[incident.status] += 1;
      acc[incident.kind] = current;
      return acc;
    }, {}),
  ).map((row) => {
    const resolved = incidents.filter((incident) => incident.kind === row.kind && incident.status === "resolved");
    if (resolved.length === 0) return row;
    const avg =
      resolved.reduce((sum, incident) => {
        if (!incident.resolvedAt) return sum;
        const opened = Date.parse(incident.openedAt);
        const closed = Date.parse(incident.resolvedAt);
        if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed <= opened) return sum;
        return sum + Math.floor((closed - opened) / 1000);
      }, 0) / resolved.length;
    return {
      ...row,
      avg_resolve_sec: Number.isFinite(avg) ? Math.floor(avg) : null,
    };
  });

  if (rows.length === 0) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.causes.empty")}</div>;
  }

  return (
    <section className="space-y-3">
      <div className="h-72 rounded border bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis dataKey="kind" type="category" width={140} />
            <Tooltip />
            <Legend />
            <Bar dataKey="open" stackId="count" fill="#dc2626" />
            <Bar dataKey="ack" stackId="count" fill="#2563eb" />
            <Bar dataKey="resolved" stackId="count" fill="#64748b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 rounded border bg-white p-3 text-sm">
        {rows.map((row) => (
          <li key={row.kind} className="flex items-center justify-between">
            <span className="font-medium">{row.kind}</span>
            <span className="text-slate-500">{formatDuration(row.avg_resolve_sec)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
