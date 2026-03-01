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

type TopIssueKind =
  | "cron_stale"
  | "projection_lagging"
  | "projection_watermark_missing"
  | "dlq_backlog"
  | "rate_limit_flood"
  | "active_incidents";

type TopIssueSeverity = "DOWN" | "DEGRADED";

type TopIssue = {
  kind: TopIssueKind;
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

const SUCCESS_HTTP_STATUS = httpStatusForReasonCode("duplicate_idempotent_replay");
const HEALTH_QUERY_TIMEOUT_MS = 50;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEALTH_CACHE_MAX_ENTRIES = 512;

const REQUIRED_EVT_EVENTS_COLUMNS = [
  "idempotency_key",
  "entity_type",
  "entity_id",
  "actor",
] as const;

const DEFAULT_CRITICAL_CHECK_NAMES = ["heart_cron"] as const;

let schemaCache: SchemaCheckCache | null = null;
let schemaCachePromise: Promise<SchemaCheckCache> | null = null;

const summaryCacheByWorkspace = new Map<string, SummaryCacheEntry>();
const summaryInFlightByWorkspace = new Map<string, Promise<SummaryComputeResult>>();

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
  return parseNonNegativeIntEnv("HEALTH_DOWN_CRON_FRESHNESS_SEC", 600);
}

function downProjectionLagSec(): number {
  return parseNonNegativeIntEnv("HEALTH_DOWN_PROJECTION_LAG_SEC", 300);
}

function degradedDlqBacklogThreshold(): number {
  return parseNonNegativeIntEnv("HEALTH_DEGRADED_DLQ_BACKLOG", 10);
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

function detectProjectionLagFallbackTables(tableColumns: Map<string, Set<string>>): string[] {
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
        projectionLagFallbackTables: detectProjectionLagFallbackTables(tableColumns),
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

async function beginTimedReadTx(client: DbClient, timeoutMs: number): Promise<void> {
  await client.query("BEGIN");
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
             ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('agent_min:' || $1 || ':%')
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('agent_hour:' || $1 || ':%')
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('exp_hour:' || $1 || ':%')
             OR ${cache.support.rateLimitFlood.bucketKeyColumn} LIKE ('hb_min:' || $1 || ':%')
           )`,
        [workspace_id],
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
