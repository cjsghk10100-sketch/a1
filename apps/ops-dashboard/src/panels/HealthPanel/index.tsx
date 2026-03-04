import { useCallback, useEffect, useMemo, useRef } from "react";

import type { HealthIssueKind, HealthResponse, TopIssue } from "../../api/types";
import { useConfig } from "../../config/ConfigContext";
import { useDashboardContext } from "../../config/DashboardContext";
import { useDrilldown } from "../../hooks/useDrilldown";
import { usePolling } from "../../hooks/usePolling";
import { useStatusAlerts } from "../../hooks/useStatusAlerts";
import { ErrorBanner } from "../../shared/ErrorBanner";
import { LoadingSkele } from "../../shared/LoadingSkele";
import { DataExport } from "../../shared/DataExport";
import { DrilldownPanel } from "./DrilldownPanel";
import { fetchDrilldown, fetchHealth } from "./api";
import { SignalsList } from "./SignalsList";
import { StatusHero } from "./StatusHero";
import { StatusTimeline } from "./StatusTimeline";
import { TopIssuesList } from "./TopIssuesList";

export interface HealthPanelProps {
  mode?: "summary" | "full";
}

type Thresholds = {
  cron_down_sec: number | null;
  projection_down_sec: number | null;
  dlq_degraded_count: number | null;
};

const DEFAULT_THRESHOLDS: Thresholds = {
  cron_down_sec: 600,
  projection_down_sec: 300,
  dlq_degraded_count: 10,
};

type NormalizedHealth = {
  status: "OK" | "DEGRADED" | "DOWN" | null;
  reasons: string[];
  signals: {
    cron_freshness_sec: number | null;
    projection_lag_sec: number | null;
    dlq_backlog_count: number;
    active_incidents_count: number;
    rate_limit_flood_detected: boolean;
  };
  thresholds: Thresholds;
  topIssues: TopIssue[];
};

function deriveHealthStatusFromSignals(
  input: {
    cron_freshness_sec: number | null;
    projection_lag_sec: number | null;
    dlq_backlog_count: number;
    active_incidents_count: number;
    rate_limit_flood_detected: boolean;
  },
  thresholds: Thresholds,
): "OK" | "DEGRADED" | "DOWN" | null {
  if (input.cron_freshness_sec == null || input.projection_lag_sec == null) {
    return "DOWN";
  }
  if (thresholds.cron_down_sec != null && input.cron_freshness_sec > thresholds.cron_down_sec) {
    return "DOWN";
  }
  if (thresholds.projection_down_sec != null && input.projection_lag_sec > thresholds.projection_down_sec) {
    return "DOWN";
  }
  if (
    (thresholds.dlq_degraded_count != null && input.dlq_backlog_count > thresholds.dlq_degraded_count) ||
    input.active_incidents_count > 0 ||
    input.rate_limit_flood_detected
  ) {
    return "DEGRADED";
  }
  return "OK";
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumber(
  obj: Record<string, number | boolean> | undefined,
  keys: string[],
): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readBoolean(
  obj: Record<string, number | boolean> | undefined,
  keys: string[],
): boolean | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function normalizeHealth(response: HealthResponse | null): NormalizedHealth {
  if (!response) {
    return {
      status: null,
      reasons: [],
      signals: {
        cron_freshness_sec: null,
        projection_lag_sec: null,
        dlq_backlog_count: 0,
        active_incidents_count: 0,
        rate_limit_flood_detected: false,
      },
      thresholds: {
        cron_down_sec: null,
        projection_down_sec: null,
        dlq_degraded_count: null,
      },
      topIssues: [],
    };
  }

  const summary = response.summary ?? {};
  const topIssues = response.top_issues ?? summary.top_issues ?? [];
  const reasons = summary.reasons ?? topIssues.map((issue) => issue.kind);
  const cronDetails = response.checks?.optional?.cron_watchdog?.details;
  const projectionDetails = response.checks?.optional?.projection_lag?.details;
  const dlqDetails = response.checks?.optional?.dlq_backlog?.details;

  const signals = response.signals ?? {
    cron_freshness_sec:
      summary.cron_freshness_sec ??
      readNumber(cronDetails, ["cron_freshness_sec", "age_sec"]),
    projection_lag_sec:
      summary.projection_lag_sec ??
      readNumber(projectionDetails, ["projection_lag_sec", "cursor_age_sec", "lag_sec"]),
    dlq_backlog_count:
      summary.dlq_backlog_count ??
      readNumber(dlqDetails, ["dlq_backlog_count", "pending_count"]) ??
      0,
    active_incidents_count: summary.active_incidents_count ?? 0,
    rate_limit_flood_detected:
      summary.rate_limit_flood_detected ??
      readBoolean(response.checks?.optional?.rate_limit_flood?.details, [
        "rate_limit_flood_detected",
      ]) ??
      false,
  };

  const thresholds: Thresholds = {
    cron_down_sec:
      pickNumber(summary.thresholds?.cron_down_sec) ??
      readNumber(cronDetails, ["down_threshold_sec", "cron_down_sec", "threshold_sec"]) ??
      DEFAULT_THRESHOLDS.cron_down_sec,
    projection_down_sec:
      pickNumber(summary.thresholds?.projection_down_sec) ??
      readNumber(projectionDetails, ["down_threshold_sec", "projection_down_sec", "threshold_sec"]) ??
      DEFAULT_THRESHOLDS.projection_down_sec,
    dlq_degraded_count:
      pickNumber(summary.thresholds?.dlq_degraded_count) ??
      readNumber(dlqDetails, ["degraded_threshold", "dlq_degraded_count", "threshold_count"]) ??
      DEFAULT_THRESHOLDS.dlq_degraded_count,
  };

  const status =
    summary.status ??
    summary.health_summary ??
    deriveHealthStatusFromSignals(
      {
        cron_freshness_sec: signals.cron_freshness_sec,
        projection_lag_sec: signals.projection_lag_sec,
        dlq_backlog_count: signals.dlq_backlog_count,
        active_incidents_count: signals.active_incidents_count,
        rate_limit_flood_detected: signals.rate_limit_flood_detected,
      },
      thresholds,
    );

  return {
    status,
    reasons,
    signals: {
      cron_freshness_sec: signals.cron_freshness_sec,
      projection_lag_sec: signals.projection_lag_sec,
      dlq_backlog_count: signals.dlq_backlog_count,
      active_incidents_count: signals.active_incidents_count,
      rate_limit_flood_detected: signals.rate_limit_flood_detected,
    },
    thresholds,
    topIssues,
  };
}

export default function HealthPanel({ mode = "full" }: HealthPanelProps): JSX.Element {
  const { config } = useConfig();
  const { client, workspaceId, registerRefresh, reportPanelStatus, reportPanelData, refreshNonce } = useDashboardContext();
  const healthFetcher = useCallback(
    (signal: AbortSignal) => fetchHealth(client, config.schemaVersion, signal),
    [client, config.schemaVersion],
  );
  const drilldownFetcher = useCallback(
    (kind: HealthIssueKind, limit: number, cursor?: string, signal?: AbortSignal) =>
      fetchDrilldown(client, config.schemaVersion, kind, limit, cursor, signal),
    [client, config.schemaVersion],
  );

  const polling = usePolling<HealthResponse>(
    healthFetcher,
    config.healthPollSec * 1000,
    {
      minIntervalMs: 15_000,
      resetKey: `${workspaceId}:${refreshNonce}`,
      cacheKey: `health:${workspaceId}`,
    },
  );

  const drilldown = useDrilldown(drilldownFetcher);

  const normalized = useMemo(() => normalizeHealth(polling.data), [polling.data]);
  const { history, requestPermission } = useStatusAlerts(normalized.status, normalized.reasons);
  const reportedPanelStatus = useMemo(() => {
    if (normalized.status) return normalized.status;
    if (!polling.error) return null;
    if (polling.error.category === "timeout" || polling.error.category === "network") {
      return "DEGRADED" as const;
    }
    return "DOWN" as const;
  }, [normalized.status, polling.error]);

  const previousServerTimeRef = useRef<string | null>(null);
  useEffect(() => {
    const currentServerTime = polling.data?.server_time ?? null;
    if (!currentServerTime || previousServerTimeRef.current === currentServerTime) {
      return;
    }
    previousServerTimeRef.current = currentServerTime;

    if (!drilldown.kind) return;

    const issueKinds = new Set(normalized.topIssues.map((issue) => issue.kind));
    if (issueKinds.has(drilldown.kind)) {
      drilldown.refresh();
    } else {
      drilldown.close();
    }
  }, [polling.data?.server_time, normalized.topIssues, drilldown.kind, drilldown.refresh, drilldown.close]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void requestPermission();
    }
  }, [requestPermission]);

  useEffect(() => {
    return registerRefresh("health", polling.forceRefresh);
  }, [registerRefresh, polling.forceRefresh]);

  useEffect(() => {
    reportPanelStatus({
      panelId: "health",
      status: reportedPanelStatus,
      lastUpdatedAt: polling.lastUpdatedAt,
      error: polling.error,
    });
  }, [reportedPanelStatus, polling.error, polling.lastUpdatedAt, reportPanelStatus]);

  useEffect(() => {
    if (!polling.data) return;
    reportPanelData("health", polling.data);
  }, [polling.data, reportPanelData]);

  if (!polling.data && !polling.error) {
    return <LoadingSkele lines={mode === "summary" ? 6 : 10} />;
  }

  return (
    <div className="space-y-3">
      {polling.error ? (
        <ErrorBanner error={polling.error} stale={polling.stale} lastUpdatedAt={polling.lastUpdatedAt} />
      ) : null}

      <div className="flex justify-end">
        <DataExport panelId="health" workspaceId={workspaceId} data={polling.data ?? {}} />
      </div>

      <StatusHero status={normalized.status} reasons={normalized.reasons} />

      <SignalsList
        cronFreshnessSec={normalized.signals.cron_freshness_sec}
        projectionLagSec={normalized.signals.projection_lag_sec}
        dlqBacklogCount={normalized.signals.dlq_backlog_count}
        activeIncidentsCount={normalized.signals.active_incidents_count}
        rateLimitFloodDetected={normalized.signals.rate_limit_flood_detected}
        thresholds={normalized.thresholds}
      />

      <TopIssuesList issues={normalized.topIssues} onOpen={(kind: HealthIssueKind) => drilldown.open(kind)} />

      {mode === "full" && drilldown.kind ? (
        <DrilldownPanel
          kind={drilldown.kind}
          items={drilldown.items}
          loading={drilldown.loading}
          truncated={drilldown.truncated}
          onLoadMore={drilldown.loadMore}
          onClose={drilldown.close}
          onRefresh={drilldown.refresh}
        />
      ) : null}

      {mode === "full" ? <StatusTimeline history={history} /> : null}
    </div>
  );
}
