import { formatDuration } from "../../utils/format";
import { useI18n } from "../../i18n/useI18n";

type SignalState = "ok" | "warn" | "critical";

function signalIcon(state: SignalState): string {
  if (state === "ok") return "✓";
  if (state === "warn") return "⚠";
  return "✕";
}

function signalClass(state: SignalState): string {
  if (state === "ok") return "text-green-600";
  if (state === "warn") return "text-amber-500";
  return "text-red-600";
}

function downThresholdState(value: number | null, threshold: number | null): SignalState {
  if (value == null || threshold == null) return "critical";
  if (value > threshold) return "critical";
  return "ok";
}

function degradedThresholdState(value: number | null, threshold: number | null): SignalState {
  if (value == null || threshold == null) return "critical";
  if (value > threshold) return "warn";
  return "ok";
}

export function SignalsList({
  cronFreshnessSec,
  projectionLagSec,
  dlqBacklogCount,
  activeIncidentsCount,
  rateLimitFloodDetected,
  thresholds,
}: {
  cronFreshnessSec: number | null;
  projectionLagSec: number | null;
  dlqBacklogCount: number;
  activeIncidentsCount: number;
  rateLimitFloodDetected: boolean;
  thresholds: {
    cron_down_sec: number | null;
    projection_down_sec: number | null;
    dlq_degraded_count: number | null;
  };
}): JSX.Element {
  const { t } = useI18n();
  const cronState = downThresholdState(cronFreshnessSec, thresholds.cron_down_sec);
  const projectionState = downThresholdState(projectionLagSec, thresholds.projection_down_sec);
  const dlqState = degradedThresholdState(dlqBacklogCount, thresholds.dlq_degraded_count);
  const incidentsState: SignalState = activeIncidentsCount > 0 ? "warn" : "ok";
  const floodState: SignalState = rateLimitFloodDetected ? "warn" : "ok";

  const rows = [
    [t("signals.cron"), cronFreshnessSec == null ? "—" : formatDuration(cronFreshnessSec), cronState],
    [t("signals.projection"), projectionLagSec == null ? "—" : formatDuration(projectionLagSec), projectionState],
    [t("signals.dlq"), String(dlqBacklogCount), dlqState],
    [t("signals.incidents"), String(activeIncidentsCount), incidentsState],
    [t("signals.flood"), rateLimitFloodDetected ? t("signals.yes") : t("signals.no"), floodState],
  ] as const;

  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("signals.title")}</div>
      <ul className="space-y-1 text-sm">
        {rows.map(([label, value, state]) => (
          <li key={label} className="flex items-center justify-between">
            <span>{label}</span>
            <span className={`inline-flex items-center gap-1 ${signalClass(state)}`}>
              <span>{value}</span>
              <span>{signalIcon(state)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
