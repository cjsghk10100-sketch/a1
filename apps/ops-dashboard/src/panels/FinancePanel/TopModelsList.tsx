import type { FinanceTopModel } from "../../api/types";
import { useI18n } from "../../i18n/useI18n";
import { formatCost, formatTokens } from "../../utils/format";

export function TopModelsList({ models }: { models: FinanceTopModel[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("finance.topModels.title")}</div>
      {models.length === 0 ? (
        <div className="text-sm text-slate-500">{t("finance.topModels.empty")}</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {models.map((model) => (
            <li key={model.model} className="flex items-center justify-between gap-2">
              <span className="truncate" title={model.model}>
                {model.model}
              </span>
              <span className="text-right text-xs text-slate-600">
                {formatCost(model.estimated_cost_units)} · {formatTokens(model.total_tokens)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
