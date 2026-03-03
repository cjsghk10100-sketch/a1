export function StatusBadge({ status }: { status: "OK" | "DEGRADED" | "DOWN" | null }): JSX.Element {
  if (status === "DOWN") {
    return <span className="rounded px-2 py-1 text-xs font-semibold bg-red-600 text-white animate-pulse">DOWN</span>;
  }
  if (status === "DEGRADED") {
    return <span className="rounded px-2 py-1 text-xs font-semibold bg-amber-500 text-gray-900">DEGRADED</span>;
  }
  if (status === "OK") {
    return <span className="rounded px-2 py-1 text-xs font-semibold bg-green-600 text-white">OK</span>;
  }
  return <span className="rounded px-2 py-1 text-xs font-semibold bg-gray-400 text-white">—</span>;
}
