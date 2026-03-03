import { useEffect, useState } from "react";

import { useI18n } from "../i18n/useI18n";
import { StatusBadge } from "../shared/StatusBadge";
import { PollingDot, type PollingDotState } from "../shared/PollingDot";
import { formatRelativeTime } from "../utils/format";

export function GlobalHeader({
  workspaceId,
  onWorkspaceChange,
  globalStatus,
  pollingState,
  lastUpdatedAt,
  onRefreshAll,
}: {
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  globalStatus: "OK" | "DEGRADED" | "DOWN" | null;
  pollingState: PollingDotState;
  lastUpdatedAt: Date | null;
  onRefreshAll: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [input, setInput] = useState(workspaceId);

  useEffect(() => {
    setInput(workspaceId);
  }, [workspaceId]);

  return (
    <header className="flex items-center justify-between border-b bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-600" htmlFor="workspace-input">
          {t("header.workspace")}
        </label>
        <input
          id="workspace-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => onWorkspaceChange(input)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onWorkspaceChange(input);
            }
          }}
          className="rounded border px-2 py-1 text-sm"
        />
        <StatusBadge status={globalStatus} />
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1">
          <PollingDot state={pollingState} />
          {t("header.polling")}
        </span>
        <span>{lastUpdatedAt ? formatRelativeTime(lastUpdatedAt.toISOString()) : "—"}</span>
        <button type="button" className="rounded border px-2 py-1" onClick={onRefreshAll}>
          {t("header.refreshAll")}
        </button>
      </div>
    </header>
  );
}
