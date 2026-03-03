import { translate } from "../i18n/messages";

export function formatCost(microStr: string | null): string {
  if (microStr == null) return translate("format.na");
  const micros = Number.parseFloat(microStr);
  if (!Number.isFinite(micros)) return translate("format.na");
  const dollars = micros / 1_000_000;
  return dollars.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTokens(tokenStr: string | null): string {
  if (tokenStr == null) return translate("format.na");
  const value = Number.parseFloat(tokenStr);
  if (!Number.isFinite(value)) return translate("format.na");
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatRelativeTime(isoString: string): string {
  const target = new Date(isoString).getTime();
  if (!Number.isFinite(target)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - target) / 1000));
  if (diffSec < 60) return translate("format.ago.seconds", { value: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return translate("format.ago.minutes", { value: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  return translate("format.ago.hours", { value: diffHour });
}
