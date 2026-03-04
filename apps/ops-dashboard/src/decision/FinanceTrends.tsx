import { Bar, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useDashboardContext } from "../config/DashboardContext";
import { useI18n } from "../i18n/useI18n";
import { formatCost, formatTokens } from "../utils/format";

function toDollar(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / 1_000_000;
}

export function FinanceTrends(): JSX.Element {
  const { panelData } = useDashboardContext();
  const { t } = useI18n();

  const series = panelData.finance?.series_daily ?? [];
  const warnings = panelData.finance?.warnings ?? [];

  if (series.length === 0) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-500">{t("decision.finance.empty")}</div>;
  }

  const data = series.map((row) => ({
    ...row,
    day: row.day_utc,
    cost_dollar: toDollar(row.estimated_cost_units),
    total_tokens_num: Number.parseFloat(row.total_tokens ?? "0") || 0,
  }));

  return (
    <section className="space-y-3">
      {warnings.length > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("decision.finance.warningCount", { value: warnings.length })}
        </div>
      ) : null}
      <div className="h-80 rounded border bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <XAxis dataKey="day" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip
              formatter={(_, __, item) => {
                const payload = item.payload as { estimated_cost_units: string; total_tokens: string | null };
                return `${formatCost(payload.estimated_cost_units)} / ${formatTokens(payload.total_tokens)}`;
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="cost_dollar" fill="#2563eb" />
            <Line yAxisId="right" type="monotone" dataKey="total_tokens_num" stroke="#16a34a" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
