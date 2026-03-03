import type { StatusTransition } from "../../hooks/useStatusAlerts";
import { formatRelativeTime } from "../../utils/format";

export function StatusTimeline({ history }: { history: StatusTransition[] }): JSX.Element {
  return (
    <div className="mt-4 rounded border p-3">
      <div className="mb-2 text-sm font-semibold">Status transitions</div>
      <ul className="space-y-1 text-xs text-slate-600">
        {history.length === 0 ? (
          <li>No transitions yet</li>
        ) : (
          history.map((entry, idx) => (
            <li key={`${entry.timestamp}-${idx}`}>
              {entry.status} · {formatRelativeTime(entry.timestamp)} · {entry.reasons.join(", ") || "no reasons"}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
