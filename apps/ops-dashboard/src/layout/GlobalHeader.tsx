import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

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
  engineConnectionStatus,
  engineLastCheckedAt,
  managedEngineActorId,
  engineBusyAction,
  engineErrorReason,
  lastIssuedEngineId,
  maskedTokenPreview,
  engineSnippetCopyReady,
  engineSnippetCopyState,
  engineSnippetLastCopiedAt,
  snippetErrorReason,
  onConnectEngine,
  onDisconnectEngine,
  onCopyEngineSnippet,
}: {
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  globalStatus: "OK" | "DEGRADED" | "DOWN" | null;
  pollingState: PollingDotState;
  lastUpdatedAt: Date | null;
  onRefreshAll: () => void;
  engineConnectionStatus: "connected" | "disconnected" | "checking";
  engineLastCheckedAt: Date | null;
  managedEngineActorId: string;
  engineBusyAction: "connect" | "disconnect" | null;
  engineErrorReason: string | null;
  lastIssuedEngineId: string | null;
  maskedTokenPreview: string | null;
  engineSnippetCopyReady: boolean;
  engineSnippetCopyState: "idle" | "copied" | "failed" | "reconnect_required";
  engineSnippetLastCopiedAt: Date | null;
  snippetErrorReason: string | null;
  onConnectEngine: () => void;
  onDisconnectEngine: () => void;
  onCopyEngineSnippet: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const [input, setInput] = useState(workspaceId);
  const search = location.search;
  const isDecisionMode = location.pathname.startsWith("/decision");
  const isConnected = engineConnectionStatus === "connected";
  const statusToneClass =
    engineConnectionStatus === "connected"
      ? "bg-green-100 text-green-700"
      : engineConnectionStatus === "checking"
        ? "bg-slate-100 text-slate-700"
        : "bg-rose-100 text-rose-700";
  const statusLabel =
    engineConnectionStatus === "connected"
      ? t("header.engine.status.connected")
      : engineConnectionStatus === "checking"
        ? t("header.engine.status.checking")
        : t("header.engine.status.disconnected");
  const engineActionBusy = engineBusyAction != null;
  const engineActionLabel = engineActionBusy
    ? t("header.engine.busy")
    : isConnected
      ? t("header.engine.disconnect")
      : t("header.engine.connect");
  const engineLastCheckLabel = engineLastCheckedAt
    ? formatRelativeTime(engineLastCheckedAt.toISOString())
    : t("format.na");
  const snippetStatusLabel =
    engineSnippetCopyState === "copied"
      ? t("header.engine.copySnippet.done")
      : engineSnippetCopyState === "failed"
        ? t("header.engine.copySnippet.failed")
        : engineSnippetCopyState === "reconnect_required"
          ? t("header.engine.copySnippet.needReconnect")
          : null;
  const snippetLastCopiedLabel = engineSnippetLastCopiedAt
    ? t("header.engine.copySnippet.lastCopied", { value: formatRelativeTime(engineSnippetLastCopiedAt.toISOString()) })
    : null;

  useEffect(() => {
    setInput(workspaceId);
  }, [workspaceId]);

  return (
    <header className="border-b bg-white px-4 py-3">
      <div className="flex items-center justify-between">
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
          <div className="ml-2 hidden items-center gap-1 rounded border bg-slate-50 p-1 md:inline-flex">
            <Link
              to={`/core${search}`}
              className={`rounded px-2 py-1 text-xs ${!isDecisionMode ? "bg-slate-200 font-medium text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t("header.mode.core")}
            </Link>
            <Link
              to={`/decision${search}`}
              className={`rounded px-2 py-1 text-xs ${isDecisionMode ? "bg-slate-200 font-medium text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t("header.mode.decision")}
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusToneClass}`}>{statusLabel}</span>
            <span className="text-xs text-slate-500">{t("header.engine.lastCheck", { value: engineLastCheckLabel })}</span>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              disabled={engineActionBusy}
              onClick={isConnected ? onDisconnectEngine : onConnectEngine}
            >
              {engineActionLabel}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              disabled={!engineSnippetCopyReady || engineActionBusy}
              onClick={onCopyEngineSnippet}
            >
              {t("header.engine.copySnippet")}
            </button>
          </div>
          <span className="inline-flex items-center gap-1">
            <PollingDot state={pollingState} />
            {t("header.polling")}
          </span>
          <span>{lastUpdatedAt ? formatRelativeTime(lastUpdatedAt.toISOString()) : "—"}</span>
          <button type="button" className="rounded border px-2 py-1" onClick={onRefreshAll}>
            {t("header.refreshAll")}
          </button>
        </div>
      </div>
      <div className="hidden items-center gap-3 text-xs text-slate-500 lg:flex">
        <span className="font-mono">{t("header.engine.actor", { value: managedEngineActorId })}</span>
        {engineErrorReason ? (
          <span className="text-rose-600">{t("header.engine.error", { value: engineErrorReason })}</span>
        ) : null}
        {snippetErrorReason ? (
          <span className="text-rose-600">{t("header.engine.error", { value: snippetErrorReason })}</span>
        ) : null}
        {snippetStatusLabel ? <span className="text-slate-600">{snippetStatusLabel}</span> : null}
        {snippetLastCopiedLabel ? <span className="text-slate-600">{snippetLastCopiedLabel}</span> : null}
        {maskedTokenPreview && lastIssuedEngineId ? (
          <details>
            <summary className="cursor-pointer text-slate-600">{t("header.engine.snippetPreview")}</summary>
            <div className="mt-1 max-w-[28rem] rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
              <div className="font-mono">
                {t("header.engine.engineId", { value: lastIssuedEngineId })}
              </div>
              <div className="mt-1 font-mono">
                {t("header.engine.engineTokenMasked", { value: maskedTokenPreview })}
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </header>
  );
}
