import type { StatusTransition } from "../../hooks/useStatusAlerts";
import { useI18n } from "../../i18n/useI18n";
import { formatRelativeTime } from "../../utils/format";

export function StatusTimeline({ history }: { history: StatusTransition[] }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("timeline.title")}</div>
      <ul className="space-y-1 text-xs text-slate-600">
        {history.length === 0 ? (
          <li>{t("timeline.empty")}</li>
        ) : (
          history.map((entry, idx) => (
            <li key={`${entry.timestamp}-${idx}`}>
              {entry.status} · {formatRelativeTime(entry.timestamp)} · {entry.reasons.join(", ") || t("timeline.noReasons")}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
