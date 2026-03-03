import { formatCost, formatTokens } from "../../utils/format";
import { useI18n } from "../../i18n/useI18n";

export function TotalsSummary({
  totals,
}: {
  totals: {
    estimated_cost_units: string | null;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
  } | null;
}): JSX.Element {
  const { t } = useI18n();
  if (!totals) {
    return <div className="text-sm text-slate-500">{t("finance.totals.empty")}</div>;
  }

  const rows = [
    [t("finance.totals.estimatedCost"), formatCost(totals.estimated_cost_units)],
    [t("finance.totals.promptTokens"), formatTokens(totals.prompt_tokens)],
    [t("finance.totals.completionTokens"), formatTokens(totals.completion_tokens)],
    [t("finance.totals.totalTokens"), formatTokens(totals.total_tokens)],
  ] as const;

  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("finance.totals.title")}</div>
      <ul className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-center justify-between">
            <span>{label}</span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
