import type { FastifyInstance } from "fastify";

import {
  buildContractError,
  httpStatusForReasonCode,
} from "../../contracts/pipeline_v2_contract.js";
import {
  SCHEMA_VERSION,
  assertSupportedSchemaVersion,
} from "../../contracts/schemaVersion.js";
import type { DbClient, DbPool } from "../../db/pool.js";
import { getRequestAuth } from "../../security/requestAuth.js";

type CronWatchdogSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.cron_health";
      checkNameColumn: "check_name";
      lastSuccessColumn: "last_success_at";
    };

type ProjectionLagSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.projector_watermarks";
      workspaceColumn: "workspace_id";
      watermarkColumn: "last_applied_event_occurred_at";
    };

type DlqBacklogSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.dead_letter_messages" | "public.dlq_messages";
      workspaceColumn: "workspace_id";
      pendingColumns: Array<"reviewed_at" | "handled_at" | "resolved_at">;
    };

type RateLimitFloodSupport =
  | { supported: false }
  | {
      supported: true;
      mode: "streaks";
      tableName: "public.rate_limit_streaks";
      workspaceColumn: "workspace_id";
      consecutiveColumn: "consecutive_429";
      last429Column: "last_429_at";
    }
  | {
      supported: true;
      mode: "buckets";
      tableName: "public.rate_limit_buckets";
      bucketKeyColumn: "bucket_key";
      windowStartColumn: "window_start";
      countColumn: "count";
    };

type ActiveIncidentsSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.proj_incidents";
      workspaceColumn: "workspace_id";
      statusColumn: "status";
    };

type SchemaCheckCache = {
  refreshedAtMs: number;
  kernelSchemaVersions: {
    tableExists: boolean;
    hasRows: boolean;
    currentVersion: string | null;
  };
  evtEvents: {
    tableExists: boolean;
    missingColumns: string[];
    requiredColumnsPresent: boolean;
    idempotencyIndexExists: boolean;
  };
  support: {
    cronWatchdog: CronWatchdogSupport;
    projectionLag: ProjectionLagSupport;
    projectionLagFallbackTables: string[];
    dlqBacklog: DlqBacklogSupport;
    rateLimitFlood: RateLimitFloodSupport;
    activeIncidents: ActiveIncidentsSupport;
  };
};

export const HEALTH_ISSUE_KINDS = [
  "cron_stale",
  "projection_lagging",
  "projection_watermark_missing",
  "dlq_backlog",
  "rate_limit_flood",
  "active_incidents",
] as const;

export type HealthIssueKind = (typeof HEALTH_ISSUE_KINDS)[number];

export const EXPECTED_PROJECTORS = [
  "proj_approvals",
  "proj_runs",
  "proj_incidents",
  "proj_experiments",
  "proj_scorecards",
  "proj_evidence_manifests",
  "proj_finance",
] as const;

type TopIssueSeverity = "DOWN" | "DEGRADED";

type TopIssue = {
  kind: HealthIssueKind;
  severity: TopIssueSeverity;
  age_sec: number | null;
  details?: Record<string, number | boolean>;
};

type HealthSummaryStatus = "OK" | "DEGRADED" | "DOWN";

type OptionalCheckPayload = {
  supported: boolean;
  ok: boolean;
  details: Record<string, number | boolean>;
};

type SystemHealthSummary = {
  health_summary: HealthSummaryStatus;
  cron_freshness_sec: number | null;
  projection_lag_sec: number | null;
  dlq_backlog_count: number;
  rate_limit_flood_detected: boolean;
  active_incidents_count: number;
  top_issues: TopIssue[];
};

type SystemHealthPayload = {
  schema_version: typeof SCHEMA_VERSION;
  ok: true;
  workspace_id: string;
  checks: {
    db: { ok: true };
    kernel_schema_versions: {
      ok: true;
      has_rows: boolean;
      current_version: string | null;
    };
    evt_events: {
      ok: true;
      required_columns_present: boolean;
      missing_columns: string[];
    };
    evt_events_idempotency: {
      ok: true;
      index_name: "uidx_evt_events_idempotency_key";
    };
    optional: {
      cron_watchdog: OptionalCheckPayload;
      projection_lag: OptionalCheckPayload;
      dlq_backlog: OptionalCheckPayload;
      rate_limit_flood: OptionalCheckPayload;
    };
  };
  summary: SystemHealthSummary;
};

type SummaryCacheEntry = {
  payload: SystemHealthPayload;
  stored_at_ms: number;
  ttl_ms: number;
};

type SummaryComputeResult = {
  entry: SummaryCacheEntry;
  server_time: string | null;
};

type HealthComputation = {
  server_time: string | null;
  summary: SystemHealthSummary;
  optional: SystemHealthPayload["checks"]["optional"];
};

type DrilldownCursor = {
  updated_at: string;
  entity_id: string;
};

type DrilldownItem = {
  entity_id: string;
  updated_at: string;
  age_sec: number | null;
  details: Record<string, number | boolean>;
  _updated_at_raw: string;
};

type DrilldownResponse = {
  schema_version: typeof SCHEMA_VERSION;
  server_time: string;
  kind: HealthIssueKind;
  applied_limit: number;
  truncated: boolean;
  next_cursor?: string;
  items: Array<{
    entity_id: string;
    updated_at: string;
    age_sec: number | null;
    details: Record<string, number | boolean>;
  }>;
};

const SUCCESS_HTTP_STATUS = httpStatusForReasonCode("duplicate_idempotent_replay");
const HEALTH_QUERY_TIMEOUT_MS = 50;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEALTH_CACHE_MAX_ENTRIES = 512;
const DEFAULT_ISSUES_LIMIT = 50;
const MAX_ISSUES_LIMIT = 100;
const ISSUES_CURSOR_MAX_CHARS = 1024;
const OPS_ISSUES_RATE_LIMIT_PER_MIN = 300;
/** SLO hard threshold. Change requires code review (PR-14). */
const DOWN_CRON_FRESHNESS_SEC = 600;
/** SLO hard threshold. Change requires code review (PR-14). */
const DOWN_PROJECTION_LAG_SEC = 300;
/** SLO hard threshold. Change requires code review (PR-14). */
const DEGRADED_DLQ_BACKLOG_THRESHOLD = 10;

const REQUIRED_EVT_EVENTS_COLUMNS = [
  "idempotency_key",
  "entity_type",
  "entity_id",
  "actor",
] as const;

export const DEFAULT_CRITICAL_CHECK_NAMES = ["heart_cron"] as const;

let schemaCache: SchemaCheckCache | null = null;
let schemaCachePromise: Promise<SchemaCheckCache> | null = null;
let hasRateLimitLastIncidentAt: boolean | null = null;

const summaryCacheByWorkspace = new Map<string, SummaryCacheEntry>();
const summaryInFlightByWorkspace = new Map<string, Promise<SummaryComputeResult>>();
// TODO(PR-11): move drilldown rate limit to dedicated DB-backed ops bucket if needed.
const issuesRateLimitWindows = new Map<string, { windowStartSec: number; count: number }>();

export function clearHealthCache(): void {
  summaryCacheByWorkspace.clear();
  summaryInFlightByWorkspace.clear();
  issuesRateLimitWindows.clear();
  hasRateLimitLastIncidentAt = null;
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function dbStatementTimeoutMs(): number {
  return parseNonNegativeIntEnv("HEALTH_DB_STATEMENT_TIMEOUT_MS", 2000);
}

function cacheTtlOkMs(): number {
  return parseNonNegativeIntEnv("HEALTH_CACHE_TTL_SEC", 15) * 1000;
}

function cacheTtlErrorMs(): number {
  return parseNonNegativeIntEnv("HEALTH_ERROR_CACHE_TTL_SEC", 5) * 1000;
}

function cacheMaxEntries(): number {
  const parsed = parseNonNegativeIntEnv("HEALTH_CACHE_MAX_ENTRIES", DEFAULT_HEALTH_CACHE_MAX_ENTRIES);
  return Math.max(parsed, 1);
}

function downCronFreshnessSec(): number {
  return DOWN_CRON_FRESHNESS_SEC;
}

function downProjectionLagSec(): number {
  return DOWN_PROJECTION_LAG_SEC;
}

function degradedDlqBacklogThreshold(): number {
  return DEGRADED_DLQ_BACKLOG_THRESHOLD;
}

function rateLimitFloodOffendersWarn(): number {
  return parseNonNegativeIntEnv("RATE_LIMIT_FLOOD_OFFENDERS_WARN", 20);
}

function parseCriticalCronCheckNames(): string[] {
  const raw = process.env.HEALTH_CRON_CRITICAL_CHECKS;
  if (!raw) return [...DEFAULT_CRITICAL_CHECK_NAMES];
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parsed.length === 0) return [...DEFAULT_CRITICAL_CHECK_NAMES];
  return Array.from(new Set(parsed));
}

function pruneSummaryCache(): void {
  const now = Date.now();
  for (const [workspaceId, entry] of summaryCacheByWorkspace.entries()) {
    if (now - entry.stored_at_ms >= entry.ttl_ms) {
      summaryCacheByWorkspace.delete(workspaceId);
    }
  }

  const maxEntries = cacheMaxEntries();
  const overBy = summaryCacheByWorkspace.size - maxEntries;
  if (overBy <= 0) return;

  const oldestFirst = Array.from(summaryCacheByWorkspace.entries()).sort(
    (a, b) => a[1].stored_at_ms - b[1].stored_at_ms,
  );
  for (let idx = 0; idx < overBy; idx += 1) {
    const key = oldestFirst[idx]?.[0];
    if (key) summaryCacheByWorkspace.delete(key);
  }
}

function getHeaderString(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string | null {
  const raw = getHeaderString(req.headers["x-workspace-id"]);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asIsoFromDbNowText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace < 0) return trimmed;
  return `${trimmed.slice(0, firstSpace)}T${trimmed.slice(firstSpace + 1)}`;
}

function asIsoUtcFromDbText(raw: unknown): string {
  if (typeof raw !== "string") return "1970-01-01T00:00:00Z";
  const trimmed = raw.trim();
  if (!trimmed) return "1970-01-01T00:00:00Z";
  const normalized = trimmed.replace(" ", "T");
  if (normalized.endsWith("Z")) return normalized;
  if (/[+-]\d{2}(:?\d{2})?$/.test(normalized)) return normalized;
  return `${normalized}Z`;
}

function epochIsoUtc(): string {
  return "1970-01-01T00:00:00Z";
}

function isKnownIssueKind(input: string): input is HealthIssueKind {
  return (HEALTH_ISSUE_KINDS as readonly string[]).includes(input);
}

function parseIssueLimit(raw: unknown): { applied_limit: number; invalid: boolean } {
  if (raw === undefined) return { applied_limit: DEFAULT_ISSUES_LIMIT, invalid: false };
  if (typeof raw !== "string") return { applied_limit: DEFAULT_ISSUES_LIMIT, invalid: true };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return { applied_limit: DEFAULT_ISSUES_LIMIT, invalid: true };
  }
  return { applied_limit: Math.min(Math.floor(parsed), MAX_ISSUES_LIMIT), invalid: false };
}

function encodeDrilldownCursor(cursor: DrilldownCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseDrilldownCursor(raw: unknown): DrilldownCursor | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ISSUES_CURSOR_MAX_CHARS) {
    throw new Error("invalid_cursor");
  }
  let decoded = "";
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new Error("invalid_cursor");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("invalid_cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_cursor");
  }
  const record = parsed as Record<string, unknown>;
  const updated_at = record.updated_at;
  const entity_id = record.entity_id;
  if (
    typeof updated_at !== "string" ||
    updated_at.trim().length === 0 ||
    typeof entity_id !== "string" ||
    entity_id.trim().length === 0 ||
    !isValidDrilldownCursorTimestamp(updated_at.trim())
  ) {
    throw new Error("invalid_cursor");
  }
  return {
    updated_at: updated_at.trim(),
    entity_id: entity_id.trim(),
  };
}

function isValidDrilldownCursorTimestamp(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const isoLike = trimmed.replace(" ", "T");
  const tzNormalized = /[+-]\d{2}$/.test(isoLike) ? `${isoLike}:00` : isoLike;
  return Number.isFinite(Date.parse(tzNormalized));
}

function pruneIssuesRateLimitWindows(nowSec: number): void {
  for (const [key, value] of issuesRateLimitWindows.entries()) {
    if (nowSec - value.windowStartSec >= 120) {
      issuesRateLimitWindows.delete(key);
    }
  }
}

function consumeOpsIssuesRateLimit(workspaceId: string): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  pruneIssuesRateLimitWindows(nowSec);
  const windowStartSec = Math.floor(nowSec / 60) * 60;
  const existing = issuesRateLimitWindows.get(workspaceId);
  if (!existing || existing.windowStartSec !== windowStartSec) {
    issuesRateLimitWindows.set(workspaceId, { windowStartSec, count: 1 });
    return true;
  }
  if (existing.count >= OPS_ISSUES_RATE_LIMIT_PER_MIN) {
    return false;
  }
  existing.count += 1;
  issuesRateLimitWindows.set(workspaceId, existing);
  return true;
}

function escapeLikeToken(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function queryNowText(queryable: Pick<DbPool, "query">, timeoutMs: number): Promise<string> {
  const result = await withTimeout(
    queryable.query<{ ts: string }>(`SELECT now()::text AS ts`),
    timeoutMs,
    "health_now",
  );
  return result.rows[0]?.ts ?? "";
}

function detectCronSupport(tableColumns: Map<string, Set<string>>): CronWatchdogSupport {
  const cols = tableColumns.get("cron_health");
  if (!cols) return { supported: false };
  if (!cols.has("check_name") || !cols.has("last_success_at")) return { supported: false };
  return {
    supported: true,
    tableName: "public.cron_health",
    checkNameColumn: "check_name",
    lastSuccessColumn: "last_success_at",
  };
}

function detectProjectionSupport(tableColumns: Map<string, Set<string>>): ProjectionLagSupport {
  const cols = tableColumns.get("projector_watermarks");
  if (!cols) return { supported: false };
  if (!cols.has("workspace_id") || !cols.has("last_applied_event_occurred_at")) {
    return { supported: false };
  }
  return {
    supported: true,
    tableName: "public.projector_watermarks",
    workspaceColumn: "workspace_id",
    watermarkColumn: "last_applied_event_occurred_at",
  };
}

function detectProjectionLagFallbackTables(
  tableColumns: Map<string, Set<string>>,
  tableIndexDefs: Map<string, string[]>,
): string[] {
  const candidates = [
    "proj_runs",
    "proj_approvals",
    "proj_experiments",
    "proj_scorecards",
    "proj_evidence_manifests",
    "proj_incidents",
    "proj_messages",
    "proj_threads",
    "proj_rooms",
    "proj_artifacts",
    "proj_lessons",
  ] as const;

  const supported: string[] = [];
  for (const table of candidates) {
    const cols = tableColumns.get(table);
    if (!cols) continue;
    if (!cols.has("workspace_id") || !cols.has("updated_at")) continue;
    const indexDefs = tableIndexDefs.get(table) ?? [];
    const hasWorkspaceUpdatedIndex = indexDefs.some((indexDef) => {
      const normalized = indexDef.toLowerCase();
      return normalized.includes("workspace_id") && normalized.includes("updated_at");
    });
    if (!hasWorkspaceUpdatedIndex) continue;
    supported.push(`public.${table}`);
  }
  return supported;
}

function detectDlqSupport(tableColumns: Map<string, Set<string>>): DlqBacklogSupport {
  const candidates = ["dead_letter_messages", "dlq_messages"] as const;
  for (const table of candidates) {
    const cols = tableColumns.get(table);
    if (!cols || !cols.has("workspace_id")) continue;

    const pendingColumns: Array<"reviewed_at" | "handled_at" | "resolved_at"> = [];
    if (cols.has("reviewed_at")) pendingColumns.push("reviewed_at");
    if (cols.has("handled_at")) pendingColumns.push("handled_at");
    if (cols.has("resolved_at")) pendingColumns.push("resolved_at");
    if (pendingColumns.length === 0) continue;

    return {
      supported: true,
      tableName: `public.${table}`,
      workspaceColumn: "workspace_id",
      pendingColumns,
    };
  }
  return { supported: false };
}

function detectRateLimitSupport(tableColumns: Map<string, Set<string>>): RateLimitFloodSupport {
  const streaksCols = tableColumns.get("rate_limit_streaks");
  if (
    streaksCols &&
    streaksCols.has("workspace_id") &&
    streaksCols.has("consecutive_429") &&
    streaksCols.has("last_429_at")
  ) {
    return {
      supported: true,
      mode: "streaks",
      tableName: "public.rate_limit_streaks",
      workspaceColumn: "workspace_id",
      consecutiveColumn: "consecutive_429",
      last429Column: "last_429_at",
    };
  }

  const bucketsCols = tableColumns.get("rate_limit_buckets");
  if (bucketsCols && bucketsCols.has("bucket_key") && bucketsCols.has("window_start") && bucketsCols.has("count")) {
    return {
      supported: true,
      mode: "buckets",
      tableName: "public.rate_limit_buckets",
      bucketKeyColumn: "bucket_key",
      windowStartColumn: "window_start",
      countColumn: "count",
    };
  }

  return { supported: false };
}

function detectActiveIncidentsSupport(tableColumns: Map<string, Set<string>>): ActiveIncidentsSupport {
  const cols = tableColumns.get("proj_incidents");
  if (!cols) return { supported: false };
  if (!cols.has("workspace_id") || !cols.has("status")) return { supported: false };
  return {
    supported: true,
    tableName: "public.proj_incidents",
    workspaceColumn: "workspace_id",
    statusColumn: "status",
  };
}

async function runSchemaChecks(pool: DbPool): Promise<SchemaCheckCache> {
  const client = await pool.connect();
  try {
    const exists = await client.query<{
      kernel_exists: boolean;
      evt_exists: boolean;
    }>(
      `SELECT
         to_regclass('public.kernel_schema_versions') IS NOT NULL AS kernel_exists,
         to_regclass('public.evt_events') IS NOT NULL AS evt_exists`,
    );

    const kernelExists = exists.rows[0]?.kernel_exists === true;
    const evtExists = exists.rows[0]?.evt_exists === true;

    let kernelHasRows = false;
    let currentVersion: string | null = null;
    if (kernelExists) {
      const kernelRows = await client.query<{ has_rows: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM public.kernel_schema_versions) AS has_rows`,
      );
      kernelHasRows = kernelRows.rows[0]?.has_rows === true;

      const current = await client.query<{ version: string | null }>(
        `SELECT version
         FROM public.kernel_schema_versions
         WHERE is_current = true
         LIMIT 1`,
      );
      currentVersion = current.rows[0]?.version ?? null;
    }

    const tableNames = [
      "evt_events",
      "cron_health",
      "projector_watermarks",
      "proj_runs",
      "proj_approvals",
      "proj_experiments",
      "proj_scorecards",
      "proj_evidence_manifests",
      "proj_messages",
      "proj_threads",
      "proj_rooms",
      "proj_artifacts",
      "proj_lessons",
      "dead_letter_messages",
      "dlq_messages",
      "rate_limit_streaks",
      "rate_limit_buckets",
      "proj_incidents",
    ];

    const columnRows = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [tableNames],
    );

    const tableColumns = new Map<string, Set<string>>();
    for (const row of columnRows.rows) {
      const existing = tableColumns.get(row.table_name) ?? new Set<string>();
      existing.add(row.column_name);
      tableColumns.set(row.table_name, existing);
    }

    const evtColumns = tableColumns.get("evt_events") ?? new Set<string>();
    const missingColumns = REQUIRED_EVT_EVENTS_COLUMNS.filter((col) => !evtColumns.has(col));

    const idxRows = await client.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'evt_events'`,
    );
    const idempotencyIndexExists = idxRows.rows.some(
      (row) => row.indexname === "uidx_evt_events_idempotency_key",
    );

    const projectionIdxRows = await client.query<{ tablename: string; indexdef: string }>(
      `SELECT tablename, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [tableNames],
    );
    const tableIndexDefs = new Map<string, string[]>();
    for (const row of projectionIdxRows.rows) {
      const existing = tableIndexDefs.get(row.tablename) ?? [];
      existing.push(row.indexdef);
      tableIndexDefs.set(row.tablename, existing);
    }

    return {
      refreshedAtMs: Date.now(),
      kernelSchemaVersions: {
        tableExists: kernelExists,
        hasRows: kernelHasRows,
        currentVersion,
      },
      evtEvents: {
        tableExists: evtExists,
        missingColumns,
        requiredColumnsPresent: missingColumns.length === 0,
        idempotencyIndexExists,
      },
      support: {
        cronWatchdog: detectCronSupport(tableColumns),
        projectionLag: detectProjectionSupport(tableColumns),
        projectionLagFallbackTables: detectProjectionLagFallbackTables(tableColumns, tableIndexDefs),
        dlqBacklog: detectDlqSupport(tableColumns),
        rateLimitFlood: detectRateLimitSupport(tableColumns),
        activeIncidents: detectActiveIncidentsSupport(tableColumns),
      },
    };
  } finally {
    client.release();
  }
}

async function getSchemaChecks(pool: DbPool): Promise<SchemaCheckCache> {
  const stale = !schemaCache || Date.now() - schemaCache.refreshedAtMs >= SCHEMA_CACHE_TTL_MS;
  if (!stale && schemaCache) return schemaCache;

  if (schemaCachePromise) return schemaCachePromise;

  schemaCachePromise = runSchemaChecks(pool)
    .then((next) => {
      schemaCache = next;
      return next;
    })
    .finally(() => {
      schemaCachePromise = null;
    });

  return schemaCachePromise;
}

function isCacheEntryFresh(entry: SummaryCacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.stored_at_ms < entry.ttl_ms;
}

async function beginTimedReadTx(client: DbClient, timeoutMs: number, readOnly = false): Promise<void> {
  await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
  await client.query(`SELECT set_config('statement_timeout', $1, true)`, [`${timeoutMs}ms`]);
}

async function fetchLiveServerTime(pool: DbPool, timeoutMs: number): Promise<string | null> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client, timeoutMs);
    const nowRes = await client.query<{ server_time: string }>(`SELECT now()::text AS server_time`);
    await client.query("COMMIT");
    return asIsoFromDbNowText(nowRes.rows[0]?.server_time ?? null);
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("db.connectivity");
  } finally {
    client.release();
  }
}

function issueSeverityRank(severity: TopIssueSeverity): number {
  return severity === "DOWN" ? 0 : 1;
}

function compareTopIssues(a: TopIssue, b: TopIssue): number {
  const severityDiff = issueSeverityRank(a.severity) - issueSeverityRank(b.severity);
  if (severityDiff !== 0) return severityDiff;

  const aAge = a.age_sec;
  const bAge = b.age_sec;
  if (aAge == null && bAge != null) return 1;
  if (aAge != null && bAge == null) return -1;
  if (aAge != null && bAge != null && aAge !== bAge) return bAge - aAge;

  return a.kind.localeCompare(b.kind);
}

function computeHealthSummaryStatus(input: {
  cron_freshness_sec: number | null;
  projection_lag_sec: number | null;
  latest_event_exists: boolean;
  dlq_backlog_count: number;
  active_incidents_count: number;
  rate_limit_flood_detected: boolean;
}): HealthSummaryStatus {
  const cronDown = input.cron_freshness_sec == null || input.cron_freshness_sec > downCronFreshnessSec();
  const projectionDown =
    input.latest_event_exists &&
    (input.projection_lag_sec == null || input.projection_lag_sec > downProjectionLagSec());

  if (cronDown || projectionDown) return "DOWN";
  if (
    input.dlq_backlog_count > degradedDlqBacklogThreshold() ||
    input.active_incidents_count > 0 ||
    input.rate_limit_flood_detected
  ) {
    return "DEGRADED";
  }
  return "OK";
}

function buildTopIssues(input: {
  cron_freshness_sec: number | null;
  projection_lag_sec: number | null;
  latest_event_exists: boolean;
  dlq_backlog_count: number;
  active_incidents_count: number;
  rate_limit_flood_detected: boolean;
}): TopIssue[] {
  const issues: TopIssue[] = [];

  if (input.cron_freshness_sec == null || input.cron_freshness_sec > downCronFreshnessSec()) {
    issues.push({
      kind: "cron_stale",
      severity: "DOWN",
      age_sec: input.cron_freshness_sec,
      details: {
        cron_freshness_sec: input.cron_freshness_sec ?? 0,
        freshness_missing: input.cron_freshness_sec == null,
      },
    });
  }

  if (input.latest_event_exists && input.projection_lag_sec == null) {
    issues.push({
      kind: "projection_watermark_missing",
      severity: "DOWN",
      age_sec: null,
      details: {
        latest_event_exists: true,
      },
    });
  } else if (
    input.projection_lag_sec != null &&
    input.projection_lag_sec > downProjectionLagSec()
  ) {
    issues.push({
      kind: "projection_lagging",
      severity: "DOWN",
      age_sec: input.projection_lag_sec,
      details: {
        projection_lag_sec: input.projection_lag_sec,
      },
    });
  }

  if (input.dlq_backlog_count > degradedDlqBacklogThreshold()) {
    issues.push({
      kind: "dlq_backlog",
      severity: "DEGRADED",
      age_sec: null,
      details: {
        dlq_backlog_count: input.dlq_backlog_count,
      },
    });
  }

  if (input.rate_limit_flood_detected) {
    issues.push({
      kind: "rate_limit_flood",
      severity: "DEGRADED",
      age_sec: null,
      details: {
        rate_limit_flood_detected: true,
      },
    });
  }

  if (input.active_incidents_count > 0) {
    issues.push({
      kind: "active_incidents",
      severity: "DEGRADED",
      age_sec: null,
      details: {
        active_incidents_count: input.active_incidents_count,
      },
    });
  }

  return issues.sort(compareTopIssues).slice(0, 5);
}

function responseTtlMs(status: HealthSummaryStatus): number {
  return status === "DOWN" ? cacheTtlErrorMs() : cacheTtlOkMs();
}

async function computeHealthComputation(
  client: DbClient,
  workspace_id: string,
  cache: SchemaCheckCache,
): Promise<HealthComputation> {
  const workspaceLikeToken = escapeLikeToken(workspace_id);
  const serverTimeRes = await client.query<{ server_time: string }>(
    `SELECT now()::text AS server_time`,
  );
  const server_time = asIsoFromDbNowText(serverTimeRes.rows[0]?.server_time ?? null);

  let cron_freshness_sec: number | null = null;
  if (cache.support.cronWatchdog.supported) {
    const criticalCheckNames = parseCriticalCronCheckNames();
    const cronRes = await client.query<{ cron_freshness_sec: number | null }>(
      `WITH expected AS (
         SELECT unnest($1::text[]) AS check_name
       ),
       joined AS (
         SELECT e.check_name, c.${cache.support.cronWatchdog.lastSuccessColumn} AS last_success_at
         FROM expected e
         LEFT JOIN ${cache.support.cronWatchdog.tableName} c
           ON c.${cache.support.cronWatchdog.checkNameColumn} = e.check_name
       )
       SELECT
         CASE
           WHEN COUNT(*) FILTER (WHERE last_success_at IS NULL) > 0 THEN NULL
           ELSE MAX(EXTRACT(EPOCH FROM (now() - last_success_at))::int)
         END AS cron_freshness_sec
       FROM joined`,
      [criticalCheckNames],
    );
    cron_freshness_sec = cronRes.rows[0]?.cron_freshness_sec ?? null;
  }

  const latestEventRes = await client.query<{ latest_event_at: string | null }>(
    `SELECT MAX(occurred_at)::text AS latest_event_at
     FROM evt_events
     WHERE workspace_id = $1`,
    [workspace_id],
  );
  const latest_event_at = latestEventRes.rows[0]?.latest_event_at ?? null;
  const latest_event_exists = latest_event_at != null;

  let watermark_at: string | null = null;
  if (cache.support.projectionLag.supported) {
    const watermarkRes = await client.query<{ watermark_at: string | null }>(
      `SELECT ${cache.support.projectionLag.watermarkColumn}::text AS watermark_at
       FROM ${cache.support.projectionLag.tableName}
       WHERE ${cache.support.projectionLag.workspaceColumn} = $1
       LIMIT 1`,
      [workspace_id],
    );
    watermark_at = watermarkRes.rows[0]?.watermark_at ?? null;
  }

  let fallback_watermark_at: string | null = null;
  if (!watermark_at && cache.support.projectionLagFallbackTables.length > 0) {
    const unions = cache.support.projectionLagFallbackTables
      .map(
        (tableName) =>
          `SELECT MAX(updated_at) AS updated_at
           FROM ${tableName}
           WHERE workspace_id = $1`,
      )
      .join(" UNION ALL ");
    const fallbackRes = await client.query<{ fallback_watermark_at: string | null }>(
      `SELECT MAX(updated_at)::text AS fallback_watermark_at
       FROM (${unions}) AS projection_maxes`,
      [workspace_id],
    );
    fallback_watermark_at = fallbackRes.rows[0]?.fallback_watermark_at ?? null;
  }

  const effective_watermark_at = watermark_at ?? fallback_watermark_at;
  const lagRes = await client.query<{ projection_lag_sec: number | null }>(
    `SELECT
       CASE
         WHEN $1::timestamptz IS NULL THEN 0
         WHEN $2::timestamptz IS NULL THEN NULL
         ELSE GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - $2::timestamptz))::int)
       END AS projection_lag_sec`,
    [latest_event_at, effective_watermark_at],
  );
  const projection_lag_sec = lagRes.rows[0]?.projection_lag_sec ?? null;

  let dlq_backlog_count = 0;
  if (cache.support.dlqBacklog.supported) {
    const pendingFilter = cache.support.dlqBacklog.pendingColumns
      .map((column) => `${column} IS NULL`)
      .join(" OR ");
    const dlqRes = await client.query<{ dlq_backlog_count: number }>(
      `SELECT COUNT(*)::int AS dlq_backlog_count
       FROM ${cache.support.dlqBacklog.tableName}
       WHERE ${cache.support.dlqBacklog.workspaceColumn} = $1
         AND (${pendingFilter})`,
      [workspace_id],
    );
    dlq_backlog_count = Number(dlqRes.rows[0]?.dlq_backlog_count ?? 0);
  }

  let rate_limit_flood_detected = false;
  let rate_limit_offenders = 0;
  if (cache.support.rateLimitFlood.supported) {
    if (cache.support.rateLimitFlood.mode === "streaks") {
      const streakRes = await client.query<{ offenders: number }>(
        `SELECT COUNT(*)::int AS offenders
         FROM ${cache.support.rateLimitFlood.tableName}
         WHERE ${cache.support.rateLimitFlood.workspaceColumn} = $1
           AND ${cache.support.rateLimitFlood.consecutiveColumn} >= 3
           AND ${cache.support.rateLimitFlood.last429Column} > now() - interval '15 minutes'`,
        [workspace_id],
      );
      rate_limit_offenders = Number(streakRes.rows[0]?.offenders ?? 0);
      rate_limit_flood_detected = rate_limit_offenders >= rateLimitFloodOffendersWarn();
    } else {
      const bucketsRes = await client.query<{ max_in_window: number | null }>(
        `SELECT MAX(${cache.support.rateLimitFlood.countColumn})::int AS max_in_window
         FROM ${cache.support.rateLimitFlood.tableName}
         WHERE ${cache.support.rateLimitFlood.windowStartColumn} > now() - interval '5 minutes'
           AND (
             ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('agent_min:' || $1 || ':%') ESCAPE '\\'
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('agent_hour:' || $1 || ':%') ESCAPE '\\'
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('exp_hour:' || $1 || ':%') ESCAPE '\\'
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('hb_min:' || $1 || ':%') ESCAPE '\\'
           )`,
        [workspaceLikeToken],
      );
      rate_limit_offenders = Number(bucketsRes.rows[0]?.max_in_window ?? 0);
      rate_limit_flood_detected = rate_limit_offenders >= rateLimitFloodOffendersWarn();
    }
  }

  let active_incidents_count = 0;
  if (cache.support.activeIncidents.supported) {
    const incidentsRes = await client.query<{ active_incidents_count: number }>(
      `SELECT COUNT(*)::int AS active_incidents_count
       FROM ${cache.support.activeIncidents.tableName}
       WHERE ${cache.support.activeIncidents.workspaceColumn} = $1
         AND ${cache.support.activeIncidents.statusColumn} = 'open'`,
      [workspace_id],
    );
    active_incidents_count = Number(incidentsRes.rows[0]?.active_incidents_count ?? 0);
  }

  const summaryInput = {
    cron_freshness_sec,
    projection_lag_sec,
    latest_event_exists,
    dlq_backlog_count,
    active_incidents_count,
    rate_limit_flood_detected,
  };

  const health_summary = computeHealthSummaryStatus(summaryInput);
  const top_issues = buildTopIssues(summaryInput);

  const optional: SystemHealthPayload["checks"]["optional"] = {
    cron_watchdog: {
      supported: cache.support.cronWatchdog.supported,
      ok: cron_freshness_sec != null && cron_freshness_sec <= downCronFreshnessSec(),
      details: {
        cron_freshness_sec: cron_freshness_sec ?? 0,
        down_threshold_sec: downCronFreshnessSec(),
        freshness_missing: cron_freshness_sec == null,
      },
    },
    projection_lag: {
      supported: cache.support.projectionLag.supported,
      ok:
        !latest_event_exists ||
        (projection_lag_sec != null && projection_lag_sec <= downProjectionLagSec()),
      details: {
        projection_lag_sec: projection_lag_sec ?? 0,
        down_threshold_sec: downProjectionLagSec(),
        watermark_missing_while_events_exist:
          latest_event_exists && effective_watermark_at == null,
        canonical_watermark_missing:
          latest_event_exists && watermark_at == null,
        fallback_watermark_used:
          latest_event_exists && watermark_at == null && fallback_watermark_at != null,
      },
    },
    dlq_backlog: {
      supported: cache.support.dlqBacklog.supported,
      ok: dlq_backlog_count <= degradedDlqBacklogThreshold(),
      details: {
        dlq_backlog_count,
        degraded_threshold: degradedDlqBacklogThreshold(),
      },
    },
    rate_limit_flood: {
      supported: cache.support.rateLimitFlood.supported,
      ok: !rate_limit_flood_detected,
      details: {
        rate_limit_flood_detected,
        offender_count: rate_limit_offenders,
        warn_threshold: rateLimitFloodOffendersWarn(),
      },
    },
  };

  return {
    server_time,
    summary: {
      health_summary,
      cron_freshness_sec,
      projection_lag_sec,
      dlq_backlog_count,
      rate_limit_flood_detected,
      active_incidents_count,
      top_issues,
    },
    optional,
  };
}

async function computeAndCacheSummary(
  pool: DbPool,
  workspace_id: string,
  cache: SchemaCheckCache,
): Promise<SummaryComputeResult> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client, dbStatementTimeoutMs());
    const computed = await computeHealthComputation(client, workspace_id, cache);
    await client.query("COMMIT");

    const payload: SystemHealthPayload = {
      schema_version: SCHEMA_VERSION,
      ok: true,
      workspace_id,
      checks: {
        db: { ok: true },
        kernel_schema_versions: {
          ok: true,
          has_rows: cache.kernelSchemaVersions.hasRows,
          current_version: cache.kernelSchemaVersions.currentVersion,
        },
        evt_events: {
          ok: true,
          required_columns_present: cache.evtEvents.requiredColumnsPresent,
          missing_columns: cache.evtEvents.missingColumns,
        },
        evt_events_idempotency: {
          ok: true,
          index_name: "uidx_evt_events_idempotency_key",
        },
        optional: computed.optional,
      },
      summary: computed.summary,
    };

    const entry: SummaryCacheEntry = {
      payload,
      stored_at_ms: Date.now(),
      ttl_ms: responseTtlMs(computed.summary.health_summary),
    };
    summaryCacheByWorkspace.set(workspace_id, entry);
    pruneSummaryCache();

    return {
      entry,
      server_time: computed.server_time,
    };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("projection_unavailable");
  } finally {
    client.release();
  }
}

function contractErrorReasonFromFailure(
  failure: "db.connectivity" | "projection_unavailable",
): "internal_error" | "projection_unavailable" {
  if (failure === "db.connectivity") return "internal_error";
  return "projection_unavailable";
}

function bodyWorkspaceId(bodyRecord: Record<string, unknown>): string | null {
  const raw = bodyRecord.workspace_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function queryWorkspaceIdFromQuery(queryRecord: Record<string, unknown>): string | null {
  const raw = queryRecord.workspace_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pgErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isMissingTableError(err: unknown): boolean {
  return pgErrorCode(err) === "42P01";
}

type DrilldownPage = {
  items: Array<{
    entity_id: string;
    updated_at: string;
    age_sec: number | null;
    details: Record<string, number | boolean>;
  }>;
  truncated: boolean;
  next_cursor?: string;
  applied_limit: number;
};

function finalizePaginatedItems(
  rows: DrilldownItem[],
  applied_limit: number,
): DrilldownPage {
  const returned = rows.slice(0, applied_limit);
  const truncated = rows.length > applied_limit;
  const items = returned.map((row) => ({
    entity_id: row.entity_id,
    updated_at: row.updated_at,
    age_sec: row.age_sec,
    details: row.details,
  }));
  if (!truncated || returned.length === 0) {
    return { items, truncated: false, applied_limit };
  }
  const last = returned[returned.length - 1];
  return {
    items,
    truncated: true,
    next_cursor: encodeDrilldownCursor({
      updated_at: last._updated_at_raw,
      entity_id: last.entity_id,
    }),
    applied_limit,
  };
}

function normalizeIssueDetails(details: Record<string, unknown>): Record<string, number | boolean> {
  const normalized: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "boolean") {
      normalized[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function queryDrilldownDlqBacklog(
  client: DbClient,
  support: DlqBacklogSupport,
  workspace_id: string,
  applied_limit: number,
  cursor: DrilldownCursor | null,
): Promise<DrilldownPage> {
  if (!support.supported) return { items: [], truncated: false, applied_limit };
  const params: Array<string | number> = [workspace_id];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor.updated_at, cursor.entity_id);
    const cursorUpdatedParam = `$${params.length - 1}`;
    const cursorEntityParam = `$${params.length}`;
    cursorClause = `
       AND (
         COALESCE(last_failed_at, '1970-01-01T00:00:00Z'::timestamptz),
         message_id::text
       ) < (
         COALESCE(${cursorUpdatedParam}::timestamptz, '1970-01-01T00:00:00Z'::timestamptz),
         ${cursorEntityParam}::text
       )`;
  }
  const pendingFilter = support.pendingColumns.map((column) => `${column} IS NULL`).join(" OR ");
  params.push(applied_limit + 1);
  try {
    const res = await client.query<{
      entity_id: string;
      updated_at_raw: string;
      updated_at_iso: string;
      age_sec: number | null;
      failure_count: number;
    }>(
      `SELECT
         message_id::text AS entity_id,
         COALESCE(last_failed_at, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
         ((COALESCE(last_failed_at, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
         CASE
           WHEN last_failed_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (now() - last_failed_at))::int
         END AS age_sec,
         failure_count::int AS failure_count
       FROM ${support.tableName}
       WHERE ${support.workspaceColumn} = $1
         AND (${pendingFilter})
         ${cursorClause}
       ORDER BY COALESCE(last_failed_at, '1970-01-01T00:00:00Z'::timestamptz) DESC, message_id::text DESC
       LIMIT $${params.length}`,
      params,
    );
    const items: DrilldownItem[] = res.rows.map((row) => ({
      entity_id: row.entity_id,
      updated_at: asIsoUtcFromDbText(row.updated_at_iso),
      age_sec: row.age_sec == null ? null : Number(row.age_sec),
      details: normalizeIssueDetails({ failure_count: Number(row.failure_count) }),
      _updated_at_raw: row.updated_at_raw,
    }));
    return finalizePaginatedItems(items, applied_limit);
  } catch (err) {
    if (isMissingTableError(err)) return { items: [], truncated: false, applied_limit };
    throw err;
  }
}

async function queryDrilldownActiveIncidents(
  client: DbClient,
  support: ActiveIncidentsSupport,
  workspace_id: string,
  applied_limit: number,
  cursor: DrilldownCursor | null,
): Promise<DrilldownPage> {
  if (!support.supported) return { items: [], truncated: false, applied_limit };
  const params: Array<string | number> = [workspace_id];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor.updated_at, cursor.entity_id);
    const cursorUpdatedParam = `$${params.length - 1}`;
    const cursorEntityParam = `$${params.length}`;
    cursorClause = `
       AND (
         COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz),
         incident_id::text
       ) < (
         COALESCE(${cursorUpdatedParam}::timestamptz, '1970-01-01T00:00:00Z'::timestamptz),
         ${cursorEntityParam}::text
       )`;
  }
  params.push(applied_limit + 1);
  try {
    const res = await client.query<{
      entity_id: string;
      updated_at_raw: string;
      updated_at_iso: string;
      age_sec: number | null;
    }>(
      `SELECT
         incident_id::text AS entity_id,
         COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
         ((COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
         CASE
           WHEN updated_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (now() - updated_at))::int
         END AS age_sec
       FROM ${support.tableName}
       WHERE ${support.workspaceColumn} = $1
         AND ${support.statusColumn} = 'open'
         ${cursorClause}
       ORDER BY COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz) DESC, incident_id::text DESC
       LIMIT $${params.length}`,
      params,
    );
    const items: DrilldownItem[] = res.rows.map((row) => ({
      entity_id: row.entity_id,
      updated_at: asIsoUtcFromDbText(row.updated_at_iso),
      age_sec: row.age_sec == null ? null : Number(row.age_sec),
      details: {},
      _updated_at_raw: row.updated_at_raw,
    }));
    return finalizePaginatedItems(items, applied_limit);
  } catch (err) {
    if (isMissingTableError(err)) return { items: [], truncated: false, applied_limit };
    throw err;
  }
}

async function queryDrilldownRateLimitFloodStreaks(
  client: DbClient,
  support: Extract<RateLimitFloodSupport, { supported: true; mode: "streaks" }>,
  workspace_id: string,
  applied_limit: number,
  cursor: DrilldownCursor | null,
): Promise<DrilldownPage> {
  const params: Array<string | number> = [workspace_id];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor.updated_at, cursor.entity_id);
    const cursorUpdatedParam = `$${params.length - 1}`;
    const cursorEntityParam = `$${params.length}`;
    cursorClause = `
       AND (
         COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz),
         agent_id::text
       ) < (
         COALESCE(${cursorUpdatedParam}::timestamptz, '1970-01-01T00:00:00Z'::timestamptz),
         ${cursorEntityParam}::text
       )`;
  }
  params.push(applied_limit + 1);

  const sqlWithMuted = `
    SELECT
      agent_id::text AS entity_id,
      COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
      ((COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
      CASE
        WHEN ${support.last429Column} IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (now() - ${support.last429Column}))::int
      END AS age_sec,
      ${support.consecutiveColumn}::int AS consecutive_429,
      (
        last_incident_at IS NOT NULL
        AND last_incident_at > now() - interval '1 hour'
      ) AS muted
    FROM ${support.tableName}
    WHERE ${support.workspaceColumn} = $1
      AND ${support.consecutiveColumn} >= 3
      ${cursorClause}
    ORDER BY COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz) DESC, agent_id::text DESC
    LIMIT $${params.length}
  `;

  const sqlWithoutMuted = `
    SELECT
      agent_id::text AS entity_id,
      COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
      ((COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
      CASE
        WHEN ${support.last429Column} IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (now() - ${support.last429Column}))::int
      END AS age_sec,
      ${support.consecutiveColumn}::int AS consecutive_429
    FROM ${support.tableName}
    WHERE ${support.workspaceColumn} = $1
      AND ${support.consecutiveColumn} >= 3
      ${cursorClause}
    ORDER BY COALESCE(${support.last429Column}, '1970-01-01T00:00:00Z'::timestamptz) DESC, agent_id::text DESC
    LIMIT $${params.length}
  `;

  try {
    const tryWithMuted = hasRateLimitLastIncidentAt !== false;
    const res = tryWithMuted
      ? await client.query<{
          entity_id: string;
          updated_at_raw: string;
          updated_at_iso: string;
          age_sec: number | null;
          consecutive_429: number;
          muted?: boolean;
        }>(sqlWithMuted, params)
      : await client.query<{
          entity_id: string;
          updated_at_raw: string;
          updated_at_iso: string;
          age_sec: number | null;
          consecutive_429: number;
        }>(sqlWithoutMuted, params);
    if (tryWithMuted) hasRateLimitLastIncidentAt = true;
    const items: DrilldownItem[] = res.rows.map((row) => {
      const details: Record<string, number | boolean> = {
        consecutive_429: Number(row.consecutive_429),
      };
      const muted = (row as { muted?: boolean }).muted;
      if (typeof muted === "boolean") {
        details.muted = muted;
      }
      return {
        entity_id: row.entity_id,
        updated_at: asIsoUtcFromDbText(row.updated_at_iso),
        age_sec: row.age_sec == null ? null : Number(row.age_sec),
        details,
        _updated_at_raw: row.updated_at_raw,
      };
    });
    return finalizePaginatedItems(items, applied_limit);
  } catch (err) {
    if (isMissingTableError(err)) return { items: [], truncated: false, applied_limit };
    if (pgErrorCode(err) === "42703" && hasRateLimitLastIncidentAt !== false) {
      hasRateLimitLastIncidentAt = false;
      return queryDrilldownRateLimitFloodStreaks(client, support, workspace_id, applied_limit, cursor);
    }
    throw err;
  }
}

async function queryDrilldownRateLimitFlood(
  client: DbClient,
  support: RateLimitFloodSupport,
  workspace_id: string,
  applied_limit: number,
  cursor: DrilldownCursor | null,
): Promise<DrilldownPage> {
  if (!support.supported) return { items: [], truncated: false, applied_limit };
  if (support.mode === "streaks") {
    return queryDrilldownRateLimitFloodStreaks(client, support, workspace_id, applied_limit, cursor);
  }

  const workspaceLikeToken = escapeLikeToken(workspace_id);
  const params: Array<string | number> = [workspaceLikeToken];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor.updated_at, cursor.entity_id);
    const cursorUpdatedParam = `$${params.length - 1}`;
    const cursorEntityParam = `$${params.length}`;
    cursorClause = `
       AND (
         COALESCE(${support.windowStartColumn}, '1970-01-01T00:00:00Z'::timestamptz),
         ${support.bucketKeyColumn}::text
       ) < (
         COALESCE(${cursorUpdatedParam}::timestamptz, '1970-01-01T00:00:00Z'::timestamptz),
         ${cursorEntityParam}::text
       )`;
  }
  params.push(applied_limit + 1);
  try {
    const res = await client.query<{
      entity_id: string;
      updated_at_raw: string;
      updated_at_iso: string;
      age_sec: number | null;
      bucket_count: number;
    }>(
      `SELECT
         ${support.bucketKeyColumn}::text AS entity_id,
         COALESCE(${support.windowStartColumn}, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
         ((COALESCE(${support.windowStartColumn}, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
         CASE
           WHEN ${support.windowStartColumn} IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (now() - ${support.windowStartColumn}))::int
         END AS age_sec,
         ${support.countColumn}::int AS bucket_count
       FROM ${support.tableName}
       WHERE (
         ${support.bucketKeyColumn} LIKE ('agent_min:' || $1 || ':%') ESCAPE '\\'
         OR ${support.bucketKeyColumn} LIKE ('agent_hour:' || $1 || ':%') ESCAPE '\\'
         OR ${support.bucketKeyColumn} LIKE ('exp_hour:' || $1 || ':%') ESCAPE '\\'
         OR ${support.bucketKeyColumn} LIKE ('hb_min:' || $1 || ':%') ESCAPE '\\'
       )
         ${cursorClause}
       ORDER BY COALESCE(${support.windowStartColumn}, '1970-01-01T00:00:00Z'::timestamptz) DESC, ${support.bucketKeyColumn}::text DESC
       LIMIT $${params.length}`,
      params,
    );
    const items: DrilldownItem[] = res.rows.map((row) => ({
      entity_id: row.entity_id,
      updated_at: asIsoUtcFromDbText(row.updated_at_iso),
      age_sec: row.age_sec == null ? null : Number(row.age_sec),
      details: normalizeIssueDetails({
        bucket_count: Number(row.bucket_count),
      }),
      _updated_at_raw: row.updated_at_raw,
    }));
    return finalizePaginatedItems(items, applied_limit);
  } catch (err) {
    if (isMissingTableError(err)) return { items: [], truncated: false, applied_limit };
    throw err;
  }
}

async function queryLatestWorkspaceEventAt(client: DbClient, workspace_id: string): Promise<string | null> {
  const res = await client.query<{ latest_event_at: string | null }>(
    `SELECT occurred_at::text AS latest_event_at
     FROM evt_events
     WHERE workspace_id = $1
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [workspace_id],
  );
  return res.rows[0]?.latest_event_at ?? null;
}

async function queryDrilldownProjectionLagging(
  client: DbClient,
  cache: SchemaCheckCache,
  workspace_id: string,
  applied_limit: number,
  cursor: DrilldownCursor | null,
): Promise<DrilldownPage> {
  if (cache.support.projectionLagFallbackTables.length === 0) {
    return { items: [], truncated: false, applied_limit };
  }
  const latest_event_at = await queryLatestWorkspaceEventAt(client, workspace_id);
  const params: Array<string | number | null> = [workspace_id];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor.updated_at, cursor.entity_id);
    const cursorUpdatedParam = `$${params.length - 1}`;
    const cursorEntityParam = `$${params.length}`;
    cursorClause = `
       WHERE (
         COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz),
         entity_id::text
       ) < (
         COALESCE(${cursorUpdatedParam}::timestamptz, '1970-01-01T00:00:00Z'::timestamptz),
         ${cursorEntityParam}::text
       )`;
  }
  params.push(latest_event_at, applied_limit + 1);

  const unions = cache.support.projectionLagFallbackTables
    .map((tableName) => {
      const entityId = tableName.replace(/^public\./, "");
      return `SELECT '${entityId}'::text AS entity_id, MAX(updated_at) AS updated_at
              FROM ${tableName}
              WHERE workspace_id = $1`;
    })
    .join(" UNION ALL ");

  try {
    const res = await client.query<{
      entity_id: string;
      updated_at_raw: string;
      updated_at_iso: string;
      lag_sec: number | null;
    }>(
      `WITH source_rows AS (${unions}),
       filtered AS (
         SELECT entity_id, updated_at
         FROM source_rows
         ${cursorClause}
       )
       SELECT
         entity_id,
         COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
         ((COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
         CASE
           WHEN $${params.length - 1}::timestamptz IS NULL THEN 0
           WHEN updated_at IS NULL THEN NULL
           ELSE GREATEST(0, EXTRACT(EPOCH FROM ($${params.length - 1}::timestamptz - updated_at))::int)
         END AS lag_sec
       FROM filtered
       ORDER BY COALESCE(updated_at, '1970-01-01T00:00:00Z'::timestamptz) DESC, entity_id::text DESC
       LIMIT $${params.length}`,
      params,
    );
    const items: DrilldownItem[] = res.rows.map((row) => ({
      entity_id: row.entity_id,
      updated_at: asIsoUtcFromDbText(row.updated_at_iso),
      age_sec: row.lag_sec == null ? null : Number(row.lag_sec),
      details: normalizeIssueDetails({
        lag_sec: row.lag_sec == null ? 0 : Number(row.lag_sec),
        lag_missing: row.lag_sec == null,
      }),
      _updated_at_raw: row.updated_at_raw,
    }));
    return finalizePaginatedItems(items, applied_limit);
  } catch (err) {
    if (isMissingTableError(err)) return { items: [], truncated: false, applied_limit };
    throw err;
  }
}

async function queryDrilldownProjectionWatermarkMissing(
  client: DbClient,
  cache: SchemaCheckCache,
  workspace_id: string,
  server_time: string,
): Promise<DrilldownPage> {
  const latest_event_at = await queryLatestWorkspaceEventAt(client, workspace_id);
  const latest_event_exists = latest_event_at != null;
  if (!latest_event_exists) {
    return { items: [], truncated: false, applied_limit: 0 };
  }

  let watermark_at: string | null = null;
  if (cache.support.projectionLag.supported) {
    try {
      const row = await client.query<{ watermark_at: string | null }>(
        `SELECT ${cache.support.projectionLag.watermarkColumn}::text AS watermark_at
         FROM ${cache.support.projectionLag.tableName}
         WHERE ${cache.support.projectionLag.workspaceColumn} = $1
         LIMIT 1`,
        [workspace_id],
      );
      watermark_at = row.rows[0]?.watermark_at ?? null;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  let fallback_watermark_at: string | null = null;
  if (!watermark_at && cache.support.projectionLagFallbackTables.length > 0) {
    const unions = cache.support.projectionLagFallbackTables
      .map(
        (tableName) =>
          `SELECT MAX(updated_at) AS updated_at
           FROM ${tableName}
           WHERE workspace_id = $1`,
      )
      .join(" UNION ALL ");
    const fallbackRes = await client.query<{ fallback_watermark_at: string | null }>(
      `SELECT MAX(updated_at)::text AS fallback_watermark_at
       FROM (${unions}) AS projection_maxes`,
      [workspace_id],
    );
    fallback_watermark_at = fallbackRes.rows[0]?.fallback_watermark_at ?? null;
  }

  const effective_watermark_at = watermark_at ?? fallback_watermark_at;
  const watermarkMissing = effective_watermark_at == null;
  if (!watermarkMissing) {
    return { items: [], truncated: false, applied_limit: 0 };
  }

  const items: DrilldownItem[] = EXPECTED_PROJECTORS.map((projectorName) => ({
    entity_id: projectorName,
    updated_at: server_time,
    age_sec: null,
    details: {
      watermark_missing: true,
    },
    _updated_at_raw: server_time,
  }));
  return {
    items: items.map(({ _updated_at_raw: _ignore, ...rest }) => rest),
    truncated: false,
    applied_limit: items.length,
  };
}

async function queryDrilldownCronStale(
  client: DbClient,
  server_time: string,
): Promise<DrilldownPage> {
  const criticalCheckNames = parseCriticalCronCheckNames();
  try {
    const res = await client.query<{
      entity_id: string;
      updated_at_raw: string;
      updated_at_iso: string;
      age_sec: number | null;
      stale: boolean;
      freshness_sec: number | null;
    }>(
      `WITH expected AS (
         SELECT unnest($1::text[]) AS check_name
       ),
       joined AS (
         SELECT
           e.check_name,
           c.last_success_at
         FROM expected e
         LEFT JOIN public.cron_health c
           ON c.check_name = e.check_name
       )
       SELECT
         check_name AS entity_id,
         COALESCE(last_success_at, '1970-01-01T00:00:00Z'::timestamptz)::text AS updated_at_raw,
         ((COALESCE(last_success_at, '1970-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC')::text || 'Z') AS updated_at_iso,
         CASE
           WHEN last_success_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (now() - last_success_at))::int
         END AS age_sec,
         (
           last_success_at IS NULL
           OR EXTRACT(EPOCH FROM (now() - last_success_at))::int > $2
         ) AS stale,
         CASE
           WHEN last_success_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (now() - last_success_at))::int
         END AS freshness_sec
       FROM joined
       ORDER BY freshness_sec DESC NULLS LAST, check_name ASC`,
      [criticalCheckNames, downCronFreshnessSec()],
    );

    const items: Array<{
      entity_id: string;
      updated_at: string;
      age_sec: number | null;
      details: Record<string, number | boolean>;
    }> = res.rows
      .filter((row) => row.stale)
      .map((row) => ({
        entity_id: row.entity_id,
        updated_at: asIsoUtcFromDbText(row.updated_at_iso || server_time),
        age_sec: row.age_sec == null ? null : Number(row.age_sec),
        details: normalizeIssueDetails({
          freshness_sec: row.freshness_sec == null ? 0 : Number(row.freshness_sec),
          freshness_missing: row.freshness_sec == null,
        }),
      }));

    return {
      items,
      truncated: false,
      applied_limit: items.length,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { items: [], truncated: false, applied_limit: 0 };
    }
    throw err;
  }
}

export async function registerSystemHealthRoutes(
  app: FastifyInstance,
  pool: DbPool,
): Promise<void> {
  app.get("/health", async (_req, reply) => {
    try {
      const nowText = await queryNowText(pool, HEALTH_QUERY_TIMEOUT_MS);
      const ts = asIsoFromDbNowText(nowText);
      return reply.code(SUCCESS_HTTP_STATUS).send({ ok: true, ts });
    } catch {
      return reply.code(SUCCESS_HTTP_STATUS).send({ ok: false, ts: null });
    }
  });

  app.get<{ Querystring: unknown }>("/v1/system/health/issues", async (req, reply) => {
    const queryRecord =
      req.query && typeof req.query === "object" && !Array.isArray(req.query)
        ? (req.query as Record<string, unknown>)
        : {};

    const schemaVersionRaw = queryRecord.schema_version;
    if (schemaVersionRaw !== undefined) {
      try {
        assertSupportedSchemaVersion(schemaVersionRaw);
      } catch {
        const reason_code = "unsupported_version" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(
            buildContractError(reason_code, {
              schema_version: schemaVersionRaw ?? null,
            }),
          );
      }
    }

    const workspace_id = workspaceIdFromReq(req);
    if (!workspace_id) {
      const reason_code = "missing_workspace_header" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { header: "x-workspace-id" }));
    }

    const queryWorkspace = queryWorkspaceIdFromQuery(queryRecord);
    if (queryWorkspace && queryWorkspace !== workspace_id) {
      const reason_code = "unauthorized_workspace" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header_workspace_id: workspace_id,
            query_workspace_id: queryWorkspace,
          }),
        );
    }

    const auth = getRequestAuth(req);
    if (auth.workspace_id !== workspace_id) {
      const reason_code = "unauthorized_workspace" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header_workspace_id: workspace_id,
            auth_workspace_id: auth.workspace_id,
          }),
        );
    }

    const kindRaw = queryRecord.kind;
    const kind = typeof kindRaw === "string" ? kindRaw.trim() : "";
    if (!isKnownIssueKind(kind)) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            field: "kind",
            allowed: HEALTH_ISSUE_KINDS,
          }),
        );
    }

    const nonPaginatedKind = kind === "projection_watermark_missing" || kind === "cron_stale";
    const parsedLimit = parseIssueLimit(queryRecord.limit);
    if (!nonPaginatedKind && parsedLimit.invalid) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { field: "limit" }));
    }

    let cursor: DrilldownCursor | null = null;
    if (!nonPaginatedKind) {
      try {
        cursor = parseDrilldownCursor(queryRecord.cursor);
      } catch {
        const reason_code = "invalid_payload_combination" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { field: "cursor" }));
      }
    }

    if (!consumeOpsIssuesRateLimit(workspace_id)) {
      const reason_code = "rate_limited" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            scope: "ops_system_health_issues_per_workspace_per_min",
            limit: OPS_ISSUES_RATE_LIMIT_PER_MIN,
            window_sec: 60,
          }),
        );
    }

    let schema: SchemaCheckCache;
    try {
      schema = await getSchemaChecks(pool);
    } catch {
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["schema_cache"] }));
    }

    let client: DbClient | undefined;
    let responsePayload: DrilldownResponse;
    try {
      client = await pool.connect();
      await beginTimedReadTx(client, dbStatementTimeoutMs(), true);
      const serverTimeRes = await client.query<{ server_time: string }>(
        `SELECT (now() AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
      );
      const server_time = asIsoUtcFromDbText(serverTimeRes.rows[0]?.server_time);

      let page: DrilldownPage;
      if (kind === "dlq_backlog") {
        page = await queryDrilldownDlqBacklog(
          client,
          schema.support.dlqBacklog,
          workspace_id,
          parsedLimit.applied_limit,
          cursor,
        );
      } else if (kind === "active_incidents") {
        page = await queryDrilldownActiveIncidents(
          client,
          schema.support.activeIncidents,
          workspace_id,
          parsedLimit.applied_limit,
          cursor,
        );
      } else if (kind === "rate_limit_flood") {
        page = await queryDrilldownRateLimitFlood(
          client,
          schema.support.rateLimitFlood,
          workspace_id,
          parsedLimit.applied_limit,
          cursor,
        );
      } else if (kind === "projection_lagging") {
        page = await queryDrilldownProjectionLagging(
          client,
          schema,
          workspace_id,
          parsedLimit.applied_limit,
          cursor,
        );
      } else if (kind === "projection_watermark_missing") {
        page = await queryDrilldownProjectionWatermarkMissing(
          client,
          schema,
          workspace_id,
          server_time,
        );
      } else {
        page = await queryDrilldownCronStale(client, server_time);
      }

      responsePayload = {
        schema_version: SCHEMA_VERSION,
        server_time,
        kind,
        applied_limit: page.applied_limit,
        truncated: page.truncated,
        items: page.items,
        ...(page.truncated && page.next_cursor ? { next_cursor: page.next_cursor } : {}),
      };

      await client.query("COMMIT");
    } catch (err) {
      try {
        await client?.query("ROLLBACK");
      } catch {
        // Ignore rollback failures on broken connections.
      }
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["issues_drilldown"] }));
    } finally {
      client?.release();
    }

    return reply.code(SUCCESS_HTTP_STATUS).send(responsePayload);
  });

  app.post<{ Body: unknown }>("/v1/system/health", async (req, reply) => {
    const bodyRecord =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    try {
      assertSupportedSchemaVersion(bodyRecord.schema_version);
    } catch {
      const reason_code = "unsupported_version" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            schema_version: bodyRecord.schema_version ?? null,
          }),
        );
    }

    const workspace_id = workspaceIdFromReq(req);
    if (!workspace_id) {
      const reason_code = "missing_workspace_header" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header: "x-workspace-id",
          }),
        );
    }

    const bodyWorkspace = bodyWorkspaceId(bodyRecord);
    if (bodyWorkspace && bodyWorkspace !== workspace_id) {
      const reason_code = "unauthorized_workspace" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header_workspace_id: workspace_id,
            body_workspace_id: bodyWorkspace,
          }),
        );
    }

    const auth = getRequestAuth(req);
    if (auth.workspace_id !== workspace_id) {
      const reason_code = "unauthorized_workspace" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            header_workspace_id: workspace_id,
            auth_workspace_id: auth.workspace_id,
          }),
        );
    }

    let schema: SchemaCheckCache;
    try {
      schema = await getSchemaChecks(pool);
    } catch {
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["db.connectivity"] }));
    }

    const failedChecks: string[] = [];
    if (!schema.evtEvents.tableExists) {
      failedChecks.push("evt_events.table_missing");
    }
    if (!schema.evtEvents.requiredColumnsPresent) {
      failedChecks.push("evt_events.required_columns_missing");
    }
    if (failedChecks.length > 0) {
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: failedChecks }));
    }

    if (!schema.kernelSchemaVersions.tableExists) {
      failedChecks.push("kernel_schema_versions.table_missing");
    }
    if (!schema.kernelSchemaVersions.hasRows) {
      failedChecks.push("kernel_schema_versions.empty");
    }
    if (!schema.evtEvents.idempotencyIndexExists) {
      failedChecks.push("evt_events.idempotency_index_missing");
    }
    if (failedChecks.length > 0) {
      const reason_code = "projection_unavailable" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: failedChecks }));
    }

    pruneSummaryCache();

    let usedCache = false;
    let computeResult: SummaryComputeResult;
    const cacheEntry = summaryCacheByWorkspace.get(workspace_id);

    if (cacheEntry && isCacheEntryFresh(cacheEntry)) {
      usedCache = true;
      computeResult = {
        entry: cacheEntry,
        server_time: null,
      };
    } else {
      const inFlight = summaryInFlightByWorkspace.get(workspace_id);
      if (inFlight) {
        usedCache = true;
        try {
          computeResult = await inFlight;
        } catch (err) {
          const failure =
            err instanceof Error && err.message === "projection_unavailable"
              ? "projection_unavailable"
              : "db.connectivity";
          const reason_code = contractErrorReasonFromFailure(failure);
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(buildContractError(reason_code, { failed_checks: ["summary.compute"] }));
        }
      } else {
        const computePromise = computeAndCacheSummary(pool, workspace_id, schema).finally(() => {
          summaryInFlightByWorkspace.delete(workspace_id);
        });
        summaryInFlightByWorkspace.set(workspace_id, computePromise);
        try {
          computeResult = await computePromise;
        } catch (err) {
          const failure =
            err instanceof Error && err.message === "projection_unavailable"
              ? "projection_unavailable"
              : "db.connectivity";
          const reason_code = contractErrorReasonFromFailure(failure);
          return reply
            .code(httpStatusForReasonCode(reason_code))
            .send(buildContractError(reason_code, { failed_checks: ["summary.compute"] }));
        }
      }
    }

    let liveServerTime: string | null = computeResult.server_time;
    if (usedCache) {
      try {
        liveServerTime = await fetchLiveServerTime(pool, dbStatementTimeoutMs());
      } catch {
        const reason_code = "internal_error" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { failed_checks: ["db.connectivity"] }));
      }
    }

    return reply.code(SUCCESS_HTTP_STATUS).send({
      ...computeResult.entry.payload,
      server_time: liveServerTime,
      meta: {
        cached: usedCache,
      },
    });
  });
}
