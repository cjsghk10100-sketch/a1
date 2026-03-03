import type { TopIssue } from "../../api/types";
import { formatDuration } from "../../utils/format";

export function TopIssuesList({
  issues,
  onOpen,
}: {
  issues: TopIssue[];
  onOpen: (kind: TopIssue["kind"]) => void;
}): JSX.Element {
  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">Top issues</div>
      {issues.length === 0 ? (
        <div className="text-sm text-slate-500">No active issues</div>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={`${issue.kind}:${issue.entity_id ?? "none"}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                onClick={() => onOpen(issue.kind)}
              >
                <span className="font-medium">{issue.kind}</span>
                <span className="text-xs text-slate-500">
                  {issue.severity} · {formatDuration(issue.age_sec ?? null)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
