import type { TopIssue } from "../../api/types";
import { useI18n } from "../../i18n/useI18n";
import { formatDuration } from "../../utils/format";

export function TopIssuesList({
  issues,
  onOpen,
}: {
  issues: TopIssue[];
  onOpen: (kind: TopIssue["kind"]) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("topIssues.title")}</div>
      {issues.length === 0 ? (
        <div className="text-sm text-slate-500">{t("topIssues.empty")}</div>
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
