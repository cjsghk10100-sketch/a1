export function formatCost(microStr: string | null): string {
  if (microStr == null) return "N/A";
  const micros = Number.parseFloat(microStr);
  if (!Number.isFinite(micros)) return "N/A";
  const dollars = micros / 1_000_000;
  return dollars.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTokens(tokenStr: string | null): string {
  if (tokenStr == null) return "N/A";
  const value = Number.parseFloat(tokenStr);
  if (!Number.isFinite(value)) return "N/A";
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
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}h ago`;
}
