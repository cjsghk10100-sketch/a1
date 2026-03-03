export type ApiErrorCategory = "auth" | "client" | "server" | "network" | "timeout";

export type ApiErrorInfo = {
  status: number;
  reason: string;
  category: ApiErrorCategory;
};

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      serverTime: string;
    }
  | {
      ok: false;
      error: ApiErrorInfo;
    };

export type HealthIssueKind =
  | "cron_stale"
  | "projection_lagging"
  | "projection_watermark_missing"
  | "dlq_backlog"
  | "rate_limit_flood"
  | "active_incidents";

export type TopIssue = {
  kind: HealthIssueKind;
  severity: "DOWN" | "DEGRADED";
  entity_id?: string;
  age_sec?: number | null;
  details?: Record<string, number | boolean>;
};

export type HealthResponse = {
  schema_version: string;
  server_time: string;
  workspace_id: string;
  summary?: {
    status?: "OK" | "DEGRADED" | "DOWN";
    reasons?: string[];
    thresholds?: {
      cron_down_sec?: number;
      projection_down_sec?: number;
      dlq_degraded_count?: number;
    };
    health_summary?: "OK" | "DEGRADED" | "DOWN";
    cron_freshness_sec?: number | null;
    projection_lag_sec?: number | null;
    dlq_backlog_count?: number;
    active_incidents_count?: number;
    rate_limit_flood_detected?: boolean;
    top_issues?: TopIssue[];
  };
  signals?: {
    cron_freshness_sec: number | null;
    projection_lag_sec: number | null;
    dlq_backlog_count: number;
    active_incidents_count: number;
    rate_limit_flood_detected: boolean;
  };
  top_issues?: TopIssue[];
  checks?: {
    optional?: {
      cron_watchdog?: { details?: Record<string, number | boolean> };
      projection_lag?: { details?: Record<string, number | boolean> };
      dlq_backlog?: { details?: Record<string, number | boolean> };
      rate_limit_flood?: { details?: Record<string, number | boolean> };
    };
  };
  meta?: {
    cached?: boolean;
    cache_ttl_sec?: number;
  };
};

export type DrilldownItem = {
  entity_id: string;
  updated_at: string;
  age_sec: number | null;
  details: Record<string, number | boolean>;
};

export type DrilldownResponse = {
  schema_version: string;
  server_time: string;
  kind: HealthIssueKind;
  applied_limit: number;
  truncated: boolean;
  next_cursor?: string | null;
  items: DrilldownItem[];
};

export type FinanceTopModel = {
  model: string;
  estimated_cost_units: string;
  total_tokens: string;
};

export type FinanceWarning = string | { kind: string; details?: Record<string, number | boolean> };

export type FinanceResponse = {
  schema_version: string;
  server_time: string;
  workspace_id: string;
  range: {
    days_back: number;
    from_day_utc: string;
    to_day_utc: string;
  };
  totals: {
    estimated_cost_units: string | null;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
  } | null;
  series_daily: Array<{
    day_utc: string;
    estimated_cost_units: string;
    prompt_tokens?: string | null;
    completion_tokens?: string | null;
    total_tokens: string | null;
  }>;
  warnings?: FinanceWarning[];
  top_models?: FinanceTopModel[];
  meta: {
    cached: boolean;
    cache_ttl_sec?: number;
    include_applied?: string[];
    applied_days_back?: number;
  };
};
