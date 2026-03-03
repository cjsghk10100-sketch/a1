export function toLocalTime(isoUtcString: string): string {
  const date = new Date(isoUtcString);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function toLocalDate(isoUtcString: string): string {
  const date = new Date(`${isoUtcString}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "—";

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  return `${y}-${m}-${d} (${weekday})`;
}
