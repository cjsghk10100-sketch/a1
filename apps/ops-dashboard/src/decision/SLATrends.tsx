import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useDashboardContext } from "../config/DashboardContext";
import { useI18n } from "../i18n/useI18n";
import { toLocalTime } from "../utils/time";

export function SLATrends(): JSX.Element {
  const { slaSnapshots } = useDashboardContext();
  const { t } = useI18n();

  if (slaSnapshots.length < 4) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.trends.collecting")}</div>;
  }

  const data = slaSnapshots.map((snapshot) => ({
    ...snapshot,
    t: toLocalTime(snapshot.at),
    violation_min: Math.floor(snapshot.totalViolationSec / 60),
  }));

  return (
    <section className="rounded border bg-white p-3">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="violation_min" stroke="#dc2626" dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="openCount" stroke="#2563eb" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
