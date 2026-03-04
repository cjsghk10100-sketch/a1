import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import type { TopIssue } from "../../api/types";
import { useI18n } from "../../i18n/useI18n";
import { DeepLink } from "../../shared/DeepLink";
import { formatDuration } from "../../utils/format";

export function TopIssuesList({
  issues,
  onOpen,
}: {
  issues: TopIssue[];
  onOpen: (kind: TopIssue["kind"]) => void;
}): JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const highlightParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("highlight");
  }, [location.search]);
  const [highlight, setHighlight] = useState<string | null>(highlightParam);

  useEffect(() => {
    setHighlight(highlightParam);
    if (!highlightParam) return;
    const timer = window.setTimeout(() => setHighlight(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightParam]);

  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-semibold">{t("topIssues.title")}</div>
      {issues.length === 0 ? (
        <div className="text-sm text-slate-500">{t("topIssues.empty")}</div>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={`${issue.kind}:${issue.entity_id ?? "none"}`}>
              <div
                className={`rounded px-2 py-1 hover:bg-slate-100 ${
                  highlight && (highlight === issue.kind || highlight === issue.entity_id) ? "ring-2 ring-yellow-400" : ""
                }`}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-sm"
                  onClick={() => onOpen(issue.kind)}
                >
                  <span className="font-medium">{issue.kind}</span>
                  <span className="text-xs text-slate-500">
                    {issue.severity} · {formatDuration(issue.age_sec ?? null)}
                  </span>
                </button>
                {issue.entity_id ? (
                  <div className="mt-1 text-right">
                    <DeepLink
                      to="/decision/timeline"
                      incidentId={issue.entity_id}
                      label={t("topIssues.openDecision")}
                      className="text-xs text-blue-600 hover:underline"
                    />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
