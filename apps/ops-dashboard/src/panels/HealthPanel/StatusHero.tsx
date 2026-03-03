import { StatusBadge } from "../../shared/StatusBadge";
import { useI18n } from "../../i18n/useI18n";

export function StatusHero({
  status,
  reasons,
}: {
  status: "OK" | "DEGRADED" | "DOWN" | null;
  reasons: string[];
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="rounded border p-3">
      <div className="mb-2 flex items-center gap-2">
        <StatusBadge status={status} />
        <span className="text-sm text-slate-700">{t("statusHero.systemStatus")}</span>
      </div>
      {reasons.length > 0 ? (
        <ul className="list-inside list-disc text-sm text-slate-700">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-slate-500">{t("statusHero.noReasons")}</div>
      )}
    </section>
  );
}
