import type { ApiErrorInfo } from "../api/types";
import type { I18nKey } from "../i18n/messages";
import { useI18n } from "../i18n/useI18n";
import { formatRelativeTime } from "../utils/format";

function readCategoryMessage(
  error: ApiErrorInfo,
  t: (key: I18nKey, values?: Record<string, string | number>) => string,
): string {
  if (error.category === "auth") {
    return t("error.auth");
  }
  if (error.category === "network") {
    return t("error.network");
  }
  if (error.category === "server") {
    return t("error.server");
  }
  if (error.category === "timeout") {
    return t("error.timeout");
  }
  return t("error.other");
}

export function ErrorBanner({
  error,
  stale,
  lastUpdatedAt,
}: {
  error: ApiErrorInfo;
  stale?: boolean;
  lastUpdatedAt?: Date | null;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div>{readCategoryMessage(error, t)}</div>
      {stale && lastUpdatedAt ? (
        <div>{t("error.showingDataFrom", { value: formatRelativeTime(lastUpdatedAt.toISOString()) })}</div>
      ) : null}
    </div>
  );
}
