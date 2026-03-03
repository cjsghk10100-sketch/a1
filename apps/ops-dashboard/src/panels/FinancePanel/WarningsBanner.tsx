import type { FinanceWarning } from "../../api/types";
import type { I18nKey } from "../../i18n/messages";
import { useI18n } from "../../i18n/useI18n";

function warningKind(warning: FinanceWarning): string {
  if (typeof warning === "string") return warning;
  return warning.kind;
}

export function WarningsBanner({ warnings }: { warnings: FinanceWarning[] }): JSX.Element | null {
  const { t } = useI18n();
  if (warnings.length === 0) return null;

  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="font-medium">{t("finance.warnings.title")}</div>
      <ul className="mt-1 list-inside list-disc">
        {warnings.map((warning, index) => (
          <li key={`${warningKind(warning)}:${index}`}>{warningLabel(t, warningKind(warning))}</li>
        ))}
      </ul>
    </div>
  );
}

function warningLabel(
  t: (key: I18nKey, values?: Record<string, string | number>) => string,
  kind: string,
): string {
  switch (kind) {
    case "top_models_unsupported":
      return t("finance.warning.top_models_unsupported");
    case "top_models_error":
      return t("finance.warning.top_models_error");
    case "finance_source_not_found":
      return t("finance.warning.finance_source_not_found");
    case "finance_db_error":
      return t("finance.warning.finance_db_error");
    default:
      return kind;
  }
}
