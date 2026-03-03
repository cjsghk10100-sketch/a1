import type { DrilldownItem, HealthIssueKind } from "../../api/types";
import { useI18n } from "../../i18n/useI18n";
import { formatDuration } from "../../utils/format";
import { toLocalTime } from "../../utils/time";

function truncateEntity(value: string): string {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}

function renderDetails(details: Record<string, number | boolean>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(", ");
}

export function DrilldownPanel({
  kind,
  items,
  loading,
  truncated,
  onLoadMore,
  onClose,
  onRefresh,
}: {
  kind: HealthIssueKind;
  items: DrilldownItem[];
  loading: boolean;
  truncated: boolean;
  onLoadMore: () => void;
  onClose: () => void;
  onRefresh: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="mt-4 rounded border bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">{t("drilldown.title", { kind })}</div>
        <div className="flex gap-2">
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={onRefresh}>
            {t("drilldown.refresh")}
          </button>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={onClose}>
            {t("drilldown.back")}
          </button>
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <div className="text-sm text-slate-500">{t("drilldown.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left">{t("drilldown.col.entityId")}</th>
                <th className="px-2 py-1 text-left">{t("drilldown.col.updatedAt")}</th>
                <th className="px-2 py-1 text-left">{t("drilldown.col.age")}</th>
                <th className="px-2 py-1 text-left">{t("drilldown.col.details")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.entity_id}:${item.updated_at}`} className="border-b">
                  <td className="px-2 py-1" title={item.entity_id}>
                    {truncateEntity(item.entity_id)}
                  </td>
                  <td className="px-2 py-1" title={item.updated_at}>
                    {toLocalTime(item.updated_at)}
                  </td>
                  <td className="px-2 py-1">{formatDuration(item.age_sec)}</td>
                  <td className="px-2 py-1">{renderDetails(item.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {truncated ? (
        <button
          type="button"
          className="mt-3 rounded border px-2 py-1 text-xs"
          onClick={onLoadMore}
          disabled={loading}
        >
          {t("drilldown.loadMore")}
        </button>
      ) : null}
    </section>
  );
}
