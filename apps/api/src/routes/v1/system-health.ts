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
  optionalSupport: {
    cronWatchdog: CronWatchdogSupport;
    projectionLag: ProjectionLagSupport;
    dlqBacklog: DlqBacklogSupport;
    rateLimitFlood: RateLimitFloodSupport;
  };
};

type CronWatchdogSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.cron_health" | "public.cron_job_health";
      jobColumn: "job_name" | "cron_job";
      lastSuccessColumn: "last_success_at";
    };

type ProjectionLagSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.projector_cursors" | "public.projection_cursors" | "public.projector_offsets";
      updatedAtColumn: "updated_at" | "last_applied_at";
    };

type DlqBacklogSupport =
  | { supported: false }
  | {
      supported: true;
      tableName: "public.dead_letter_messages" | "public.dlq_messages";
      createdAtColumn: "created_at";
      pendingColumns: Array<"handled_at" | "resolved_at">;
    };

type RateLimitFloodSupport =
  | { supported: false }
  | {
      supported: true;
      mode: "streaks";
      tableName: "public.rate_limit_streaks";
      consecutiveColumn: "consecutive_429";
      last429Column: "last_429_at";
    }
  | {
      supported: true;
      mode: "buckets";
      tableName: "public.rate_limit_buckets";
      windowStartColumn: "window_start";
      windowSecColumn: "window_sec";
      countColumn: "count";
    };

type OptionalCheckPayload = {
  supported: boolean;
  ok: boolean;
  details: Record<string, unknown>;
};

const SUCCESS_HTTP_STATUS = httpStatusForReasonCode("duplicate_idempotent_replay");
const OPTIONAL_QUERY_TIMEOUT_MS = 200;
const HEALTH_QUERY_TIMEOUT_MS = 50;
const SYSTEM_NOW_TIMEOUT_MS = 2000;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

const REQUIRED_EVT_EVENTS_COLUMNS = [
  "idempotency_key",
  "entity_type",
  "entity_id",
  "actor",
] as const;

let schemaCache: SchemaCheckCache | null = null;
let schemaCachePromise: Promise<SchemaCheckCache> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);

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

async function queryNowText(
  queryable: Pick<DbPool, "query"> | Pick<DbClient, "query">,
  timeoutMs: number,
  label: string,
): Promise<string> {
  const result = await withTimeout(
    queryable.query<{ ts: string }>(`SELECT now()::text AS ts`),
    timeoutMs,
    label,
  );
  return result.rows[0]?.ts ?? "";
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function cronFreshnessMaxSec(): number {
  return parseNonNegativeIntEnv("CRON_FRESHNESS_MAX_SEC", 900);
}

function projectionCursorMaxAgeSec(): number {
  return parseNonNegativeIntEnv("PROJECTION_CURSOR_MAX_AGE_SEC", 60);
}

function dlqPendingWarnCount(): number {
  return parseNonNegativeIntEnv("DLQ_PENDING_WARN_COUNT", 100);
}

function rateLimitFloodOffendersWarn(): number {
  return parseNonNegativeIntEnv("RATE_LIMIT_FLOOD_OFFENDERS_WARN", 20);
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

function detectCronSupport(tableColumns: Map<string, Set<string>>): CronWatchdogSupport {
  const candidates = ["cron_health", "cron_job_health"] as const;
  for (const table of candidates) {
    const cols = tableColumns.get(table);
    if (!cols) continue;
    const jobColumn = cols.has("job_name")
      ? "job_name"
      : cols.has("cron_job")
        ? "cron_job"
        : null;
    if (!jobColumn || !cols.has("last_success_at")) continue;
    return {
      supported: true,
      tableName: `public.${table}`,
      jobColumn,
      lastSuccessColumn: "last_success_at",
    };
  }
  return { supported: false };
}

function detectProjectionSupport(tableColumns: Map<string, Set<string>>): ProjectionLagSupport {
  const candidates = ["projector_cursors", "projection_cursors", "projector_offsets"] as const;
  for (const table of candidates) {
    const cols = tableColumns.get(table);
    if (!cols) continue;
    const updatedAtColumn = cols.has("updated_at")
      ? "updated_at"
      : cols.has("last_applied_at")
        ? "last_applied_at"
        : null;
    if (!updatedAtColumn) continue;
    return {
      supported: true,
      tableName: `public.${table}`,
      updatedAtColumn,
    };
  }
  return { supported: false };
}

function detectDlqSupport(tableColumns: Map<string, Set<string>>): DlqBacklogSupport {
  const candidates = ["dead_letter_messages", "dlq_messages"] as const;
  for (const table of candidates) {
    const cols = tableColumns.get(table);
    if (!cols || !cols.has("created_at")) continue;

    const pendingColumns: Array<"handled_at" | "resolved_at"> = [];
    if (cols.has("handled_at")) pendingColumns.push("handled_at");
    if (cols.has("resolved_at")) pendingColumns.push("resolved_at");
    if (pendingColumns.length === 0) continue;

    return {
      supported: true,
      tableName: `public.${table}`,
      createdAtColumn: "created_at",
      pendingColumns,
    };
  }
  return { supported: false };
}

function detectRateLimitSupport(tableColumns: Map<string, Set<string>>): RateLimitFloodSupport {
  const streaksCols = tableColumns.get("rate_limit_streaks");
  if (streaksCols && streaksCols.has("consecutive_429") && streaksCols.has("last_429_at")) {
    return {
      supported: true,
      mode: "streaks",
      tableName: "public.rate_limit_streaks",
      consecutiveColumn: "consecutive_429",
      last429Column: "last_429_at",
    };
  }

  const bucketsCols = tableColumns.get("rate_limit_buckets");
  if (
    bucketsCols &&
    bucketsCols.has("window_start") &&
    bucketsCols.has("window_sec") &&
    bucketsCols.has("count")
  ) {
    return {
      supported: true,
      mode: "buckets",
      tableName: "public.rate_limit_buckets",
      windowStartColumn: "window_start",
      windowSecColumn: "window_sec",
      countColumn: "count",
    };
  }

  return { supported: false };
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
      "cron_job_health",
      "projector_cursors",
      "projection_cursors",
      "projector_offsets",
      "dead_letter_messages",
      "dlq_messages",
      "rate_limit_streaks",
      "rate_limit_buckets",
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
      optionalSupport: {
        cronWatchdog: detectCronSupport(tableColumns),
        projectionLag: detectProjectionSupport(tableColumns),
        dlqBacklog: detectDlqSupport(tableColumns),
        rateLimitFlood: detectRateLimitSupport(tableColumns),
      },
    };
  } finally {
    client.release();
  }
}

async function getSchemaChecks(pool: DbPool): Promise<SchemaCheckCache> {
  const stale =
    !schemaCache || Date.now() - schemaCache.refreshedAtMs >= SCHEMA_CACHE_TTL_MS;
  if (!stale && schemaCache) {
    return schemaCache;
  }

  if (schemaCachePromise) {
    return schemaCachePromise;
  }

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

async function runTimedRead<T>(client: DbClient, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT set_config('statement_timeout', $1, true)`,
      [`${OPTIONAL_QUERY_TIMEOUT_MS}ms`],
    );
    const value = await fn();
    await client.query("COMMIT");
    return value;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

function errorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function checkCronWatchdog(
  client: DbClient,
  support: CronWatchdogSupport,
): Promise<OptionalCheckPayload> {
  if (!support.supported) {
    return {
      supported: false,
      ok: true,
      details: { reason: "unsupported" },
    };
  }

  try {
    const row = await runTimedRead(client, async () => {
      const res = await client.query<{
        age_sec: number | null;
        last_success_at: string | null;
      }>(
        `SELECT
           EXTRACT(EPOCH FROM (now() - ${support.lastSuccessColumn}))::int AS age_sec,
           ${support.lastSuccessColumn}::text AS last_success_at
         FROM ${support.tableName}
         ORDER BY ${support.lastSuccessColumn} DESC NULLS LAST
         LIMIT 1`,
      );
      return res.rows[0] ?? null;
    });

    if (!row || !row.last_success_at) {
      return {
        supported: true,
        ok: false,
        details: {
          reason: "no_rows",
          table: support.tableName,
        },
      };
    }

    const maxAgeSec = cronFreshnessMaxSec();
    const ageSec = Number(row.age_sec ?? Number.MAX_SAFE_INTEGER);
    return {
      supported: true,
      ok: ageSec <= maxAgeSec,
      details: {
        table: support.tableName,
        age_sec: ageSec,
        max_age_sec: maxAgeSec,
        last_success_at: row.last_success_at,
      },
    };
  } catch (err) {
    return {
      supported: true,
      ok: false,
      details: {
        table: support.tableName,
        error: errorString(err),
      },
    };
  }
}

async function checkProjectionLag(
  client: DbClient,
  support: ProjectionLagSupport,
): Promise<OptionalCheckPayload> {
  if (!support.supported) {
    return {
      supported: false,
      ok: true,
      details: { reason: "unsupported" },
    };
  }

  try {
    const row = await runTimedRead(client, async () => {
      const res = await client.query<{
        cursor_age_sec: number | null;
        cursor_updated_at: string | null;
      }>(
        `SELECT
           EXTRACT(EPOCH FROM (now() - ${support.updatedAtColumn}))::int AS cursor_age_sec,
           ${support.updatedAtColumn}::text AS cursor_updated_at
         FROM ${support.tableName}
         ORDER BY ${support.updatedAtColumn} DESC NULLS LAST
         LIMIT 1`,
      );
      return res.rows[0] ?? null;
    });

    if (!row || !row.cursor_updated_at) {
      return {
        supported: true,
        ok: false,
        details: {
          reason: "no_rows",
          table: support.tableName,
        },
      };
    }

    const maxAgeSec = projectionCursorMaxAgeSec();
    const ageSec = Number(row.cursor_age_sec ?? Number.MAX_SAFE_INTEGER);
    return {
      supported: true,
      ok: ageSec <= maxAgeSec,
      details: {
        table: support.tableName,
        cursor_age_sec: ageSec,
        max_age_sec: maxAgeSec,
        cursor_updated_at: row.cursor_updated_at,
      },
    };
  } catch (err) {
    return {
      supported: true,
      ok: false,
      details: {
        table: support.tableName,
        error: errorString(err),
      },
    };
  }
}

async function checkDlqBacklog(
  client: DbClient,
  support: DlqBacklogSupport,
): Promise<OptionalCheckPayload> {
  if (!support.supported) {
    return {
      supported: false,
      ok: true,
      details: { reason: "unsupported" },
    };
  }

  const pendingFilter =
    support.pendingColumns.length === 2
      ? `(${support.pendingColumns[0]} IS NULL OR ${support.pendingColumns[1]} IS NULL)`
      : `${support.pendingColumns[0]} IS NULL`;

  try {
    const row = await runTimedRead(client, async () => {
      const res = await client.query<{
        oldest_age_sec: number | null;
        pending_count: number;
      }>(
        `SELECT
           EXTRACT(EPOCH FROM (now() - MIN(${support.createdAtColumn})))::int AS oldest_age_sec,
           COUNT(*)::int AS pending_count
         FROM ${support.tableName}
         WHERE ${pendingFilter}`,
      );
      return res.rows[0] ?? { oldest_age_sec: null, pending_count: 0 };
    });

    const warnCount = dlqPendingWarnCount();
    const pendingCount = Number(row.pending_count ?? 0);
    return {
      supported: true,
      ok: pendingCount < warnCount,
      details: {
        table: support.tableName,
        pending_count: pendingCount,
        warn_count: warnCount,
        oldest_age_sec: row.oldest_age_sec,
      },
    };
  } catch (err) {
    return {
      supported: true,
      ok: false,
      details: {
        table: support.tableName,
        error: errorString(err),
      },
    };
  }
}

async function checkRateLimitFlood(
  client: DbClient,
  support: RateLimitFloodSupport,
): Promise<OptionalCheckPayload> {
  if (!support.supported) {
    return {
      supported: false,
      ok: true,
      details: { reason: "unsupported" },
    };
  }

  try {
    if (support.mode === "streaks") {
      const row = await runTimedRead(client, async () => {
        const res = await client.query<{ offenders: number }>(
          `SELECT COUNT(*)::int AS offenders
           FROM ${support.tableName}
           WHERE ${support.consecutiveColumn} >= 3
             AND ${support.last429Column} > now() - interval '15 minutes'`,
        );
        return res.rows[0] ?? { offenders: 0 };
      });

      const warnThreshold = rateLimitFloodOffendersWarn();
      const offenders = Number(row.offenders ?? 0);
      return {
        supported: true,
        ok: offenders < warnThreshold,
        details: {
          mode: support.mode,
          table: support.tableName,
          offenders,
          warn_threshold: warnThreshold,
        },
      };
    }

    const row = await runTimedRead(client, async () => {
      const res = await client.query<{ max_in_window: number | null }>(
        `SELECT MAX(${support.countColumn})::int AS max_in_window
         FROM ${support.tableName}
         WHERE ${support.windowStartColumn} > now() - interval '5 minutes'`,
      );
      return res.rows[0] ?? { max_in_window: null };
    });

    const warnThreshold = rateLimitFloodOffendersWarn();
    const maxInWindow = Number(row.max_in_window ?? 0);
    return {
      supported: true,
      ok: maxInWindow < warnThreshold,
      details: {
        mode: support.mode,
        table: support.tableName,
        max_in_window: maxInWindow,
        warn_threshold: warnThreshold,
      },
    };
  } catch (err) {
    return {
      supported: true,
      ok: false,
      details: {
        mode: support.mode,
        table: support.tableName,
        error: errorString(err),
      },
    };
  }
}

async function runOptionalChecks(
  client: DbClient,
  cache: SchemaCheckCache,
): Promise<{
  cron_watchdog: OptionalCheckPayload;
  projection_lag: OptionalCheckPayload;
  dlq_backlog: OptionalCheckPayload;
  rate_limit_flood: OptionalCheckPayload;
}> {
  const cron_watchdog = await checkCronWatchdog(client, cache.optionalSupport.cronWatchdog);
  const projection_lag = await checkProjectionLag(client, cache.optionalSupport.projectionLag);
  const dlq_backlog = await checkDlqBacklog(client, cache.optionalSupport.dlqBacklog);
  const rate_limit_flood = await checkRateLimitFlood(client, cache.optionalSupport.rateLimitFlood);

  return {
    cron_watchdog,
    projection_lag,
    dlq_backlog,
    rate_limit_flood,
  };
}

export async function registerSystemHealthRoutes(
  app: FastifyInstance,
  pool: DbPool,
): Promise<void> {
  schemaCache = await runSchemaChecks(pool);

  app.get("/health", async (_req, reply) => {
    try {
      const nowText = await queryNowText(pool, HEALTH_QUERY_TIMEOUT_MS, "health_db_now");
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

    let client: DbClient | undefined;
    try {
      client = await pool.connect();
      const nowText = await queryNowText(client, SYSTEM_NOW_TIMEOUT_MS, "system_health_db_now");
      const server_time = asIsoFromDbNowText(nowText);

      const cache = await getSchemaChecks(pool);
      const failedChecks: string[] = [];

      if (!cache.evtEvents.tableExists) {
        failedChecks.push("evt_events.table_missing");
      }
      if (!cache.evtEvents.requiredColumnsPresent) {
        failedChecks.push("evt_events.required_columns_missing");
      }
      const hasInternalFailure = failedChecks.length > 0;

      if (!cache.kernelSchemaVersions.tableExists) {
        failedChecks.push("kernel_schema_versions.table_missing");
      }
      if (!cache.kernelSchemaVersions.hasRows) {
        failedChecks.push("kernel_schema_versions.empty");
      }
      if (!cache.evtEvents.idempotencyIndexExists) {
        failedChecks.push("evt_events.idempotency_index_missing");
      }

      if (hasInternalFailure) {
        const reason_code = "internal_error" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { failed_checks: failedChecks }));
      }

      if (failedChecks.length > 0) {
        const reason_code = "projection_unavailable" as const;
        return reply
          .code(httpStatusForReasonCode(reason_code))
          .send(buildContractError(reason_code, { failed_checks: failedChecks }));
      }

      const optional = await runOptionalChecks(client, cache);

      return reply.code(SUCCESS_HTTP_STATUS).send({
        schema_version: SCHEMA_VERSION,
        server_time,
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
          optional,
        },
      });
    } catch (err) {
      const reason_code = "internal_error" as const;
      req.log.error(
        {
          event: "system.health.error",
          reason_code,
          err_name: err instanceof Error ? err.name : "Error",
          err_message: err instanceof Error ? err.message : String(err),
        },
        "system health check failed",
      );
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["db.connectivity"] }));
    } finally {
      client?.release();
    }
  });
}
