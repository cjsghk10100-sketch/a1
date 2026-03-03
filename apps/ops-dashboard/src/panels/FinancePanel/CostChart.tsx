import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatCost, formatTokens } from "../../utils/format";

type ChartRow = {
  day_utc: string;
  estimated_cost_units: string;
  total_tokens: string | null;
};

function toChartValue(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / 1_000_000;
}

function formatDay(dayUtc: string): string {
  const d = new Date(`${dayUtc}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dayUtc;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CostChart({ series }: { series: ChartRow[] }): JSX.Element {
  if (series.length === 0) {
    return <div className="text-sm text-slate-500">No cost data for this period</div>;
  }

  const data = series.map((row) => ({
    ...row,
    day_label: formatDay(row.day_utc),
    cost_dollar: toChartValue(row.estimated_cost_units),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day_label" />
          <YAxis />
          <Tooltip
            formatter={(_, __, item) => {
              const payload = item.payload as ChartRow & { estimated_cost_units: string; total_tokens: string | null };
              return [
                `${formatCost(payload.estimated_cost_units)} — ${formatTokens(payload.total_tokens)}`,
                "Cost",
              ];
            }}
          />
          <Bar dataKey="cost_dollar" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
