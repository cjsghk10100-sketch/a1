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

/**
 * Finance source chosen for PR-12A:
 * - table: public.sec_survival_ledger_daily
 * - day bucket column: snapshot_date (UTC date)
 * - numeric column: estimated_cost_units
 * - bounded safety: workspace+date filter using existing index
 *   sec_survival_ledger_daily_workspace_date_idx (workspace_id, snapshot_date DESC, updated_at DESC)
 */
const FINANCE_DAILY_SOURCE_TABLE = "public.sec_survival_ledger_daily";
const SUCCESS_HTTP_STATUS = httpStatusForReasonCode("duplicate_idempotent_replay");
const DEFAULT_DAYS_BACK = 30;
const MAX_DAYS_BACK = 365;
const MIN_DAYS_BACK = 1;
const DEFAULT_FINANCE_CACHE_MAX_ENTRIES = 1000;
const OPS_DASHBOARD_FINANCE_PER_WORKSPACE_PER_MIN = 300;

type FinanceWarning = {
  kind: string;
  details?: Record<string, number | boolean>;
};

type FinanceSeriesRow = {
  day_utc: string;
  estimated_cost_units: string;
};

type FinanceTotals = {
  estimated_cost_units: string;
};

type FinanceMetricsPayload = {
  schema_version: typeof SCHEMA_VERSION;
  workspace_id: string;
  range: {
    days_back: number;
    from_day_utc: string;
    to_day_utc: string;
  };
  totals: FinanceTotals | null;
  series_daily: FinanceSeriesRow[];
  warnings: FinanceWarning[];
};

type FinanceResponse = FinanceMetricsPayload & {
  server_time: string;
  meta: {
    cached: boolean;
    cache_ttl_sec: number;
  };
};

type FinanceCacheEntry = {
  payload: FinanceMetricsPayload;
  stored_at_monotonic_ms: number;
  ttl_ms: number;
};

type RateLimitWindow = {
  windowStartSec: number;
  count: number;
};

type DateRange = {
  from_day_utc: string;
  to_day_utc: string;
};

type LivePingResult = {
  server_time: string;
  range: DateRange;
};

const financeMetricsCache = new Map<string, FinanceCacheEntry>();
const financeMetricsInFlight = new Map<string, Promise<FinanceCacheEntry>>();
const financeRateLimitWindows = new Map<string, RateLimitWindow>();

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function financeStatementTimeoutMs(): number {
  return parseNonNegativeIntEnv("HEALTH_DB_STATEMENT_TIMEOUT_MS", 2000);
}

function financeCacheSuccessTtlMs(): number {
  if (process.env.NODE_ENV === "test") return 0;
  return 30_000;
}

function financeCacheErrorTtlMs(): number {
  if (process.env.NODE_ENV === "test") return 0;
  return 5_000;
}

function financeCacheMaxEntries(): number {
  const parsed = parseNonNegativeIntEnv(
    "FINANCE_CACHE_MAX_ENTRIES",
    DEFAULT_FINANCE_CACHE_MAX_ENTRIES,
  );
  return Math.max(parsed, 1);
}

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function workspaceIdFromReq(req: {
  headers: Record<string, unknown>;
  raw?: { rawHeaders?: string[] };
}): string | null {
  const rawHeaders = req.raw?.rawHeaders;
  if (!Array.isArray(rawHeaders)) return null;

  let headerValue: string | undefined;
  for (let i = 0; i < rawHeaders.length - 1; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === "x-workspace-id") {
      headerValue = rawHeaders[i + 1];
      break;
    }
  }

  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function parseDaysBack(raw: unknown): { ok: true; applied: number } | { ok: false } {
  if (raw === undefined) return { ok: true, applied: DEFAULT_DAYS_BACK };
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { ok: false };
  }
  if (raw < MIN_DAYS_BACK) return { ok: true, applied: MIN_DAYS_BACK };
  if (raw > MAX_DAYS_BACK) return { ok: true, applied: MAX_DAYS_BACK };
  return { ok: true, applied: raw };
}

function cacheKey(workspace_id: string, days_back: number): string {
  return `finance:${workspace_id}:${days_back}`;
}

function isCacheEntryFresh(entry: FinanceCacheEntry | undefined): boolean {
  if (!entry) return false;
  return monotonicNowMs() - entry.stored_at_monotonic_ms < entry.ttl_ms;
}

function pruneFinanceCache(): void {
  const now = monotonicNowMs();
  for (const [key, entry] of financeMetricsCache.entries()) {
    if (now - entry.stored_at_monotonic_ms >= entry.ttl_ms) {
      financeMetricsCache.delete(key);
    }
  }

  const maxEntries = financeCacheMaxEntries();
  const overBy = financeMetricsCache.size - maxEntries;
  if (overBy <= 0) return;

  const oldestFirst = Array.from(financeMetricsCache.entries()).sort(
    (a, b) => a[1].stored_at_monotonic_ms - b[1].stored_at_monotonic_ms,
  );
  for (let idx = 0; idx < overBy; idx += 1) {
    const key = oldestFirst[idx]?.[0];
    if (key) financeMetricsCache.delete(key);
  }
}

function pruneFinanceRateLimitWindows(nowSec: number): void {
  for (const [key, value] of financeRateLimitWindows.entries()) {
    if (nowSec - value.windowStartSec >= 120) {
      financeRateLimitWindows.delete(key);
    }
  }
}

function consumeOpsFinanceRateLimit(workspace_id: string): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  pruneFinanceRateLimitWindows(nowSec);

  const windowStartSec = Math.floor(nowSec / 60) * 60;
  const existing = financeRateLimitWindows.get(workspace_id);
  if (!existing || existing.windowStartSec !== windowStartSec) {
    financeRateLimitWindows.set(workspace_id, { windowStartSec, count: 1 });
    return true;
  }
  if (existing.count >= OPS_DASHBOARD_FINANCE_PER_WORKSPACE_PER_MIN) return false;
  existing.count += 1;
  financeRateLimitWindows.set(workspace_id, existing);
  return true;
}

function pgErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isUndefinedTableError(err: unknown): boolean {
  return pgErrorCode(err) === "42P01";
}

async function beginTimedReadTx(client: DbClient): Promise<void> {
  await client.query("BEGIN READ ONLY");
  await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
    `${financeStatementTimeoutMs()}ms`,
  ]);
}

async function fetchLivePing(pool: DbPool, days_back: number): Promise<LivePingResult> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client);
    const pingRes = await client.query<{
      server_time: string;
      from_day_utc: string;
      to_day_utc: string;
    }>(
      `SELECT
         (now() AT TIME ZONE 'UTC')::text || 'Z' AS server_time,
         to_char(((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::date, 'YYYY-MM-DD') AS from_day_utc,
         to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_day_utc`,
      [days_back],
    );
    await client.query("COMMIT");
    return {
      server_time: asIsoUtcFromDbText(pingRes.rows[0]?.server_time),
      range: {
        from_day_utc: pingRes.rows[0]?.from_day_utc ?? "1970-01-01",
        to_day_utc: pingRes.rows[0]?.to_day_utc ?? "1970-01-01",
      },
    };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("finance_ping_failed");
  } finally {
    client.release();
  }
}

async function queryDateRange(client: DbClient, days_back: number): Promise<DateRange> {
  const rangeRes = await client.query<{ from_day_utc: string; to_day_utc: string }>(
    `SELECT
       to_char(((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::date, 'YYYY-MM-DD') AS from_day_utc,
       to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_day_utc`,
    [days_back],
  );
  return {
    from_day_utc: rangeRes.rows[0]?.from_day_utc ?? "1970-01-01",
    to_day_utc: rangeRes.rows[0]?.to_day_utc ?? "1970-01-01",
  };
}

async function computeFinanceMetricsPayload(
  client: DbClient,
  workspace_id: string,
  days_back: number,
): Promise<FinanceMetricsPayload> {
  const range = await queryDateRange(client, days_back);

  try {
    const seriesRes = await client.query<{
      day_utc: string;
      estimated_cost_units: string;
    }>(
      `WITH date_range AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'UTC')::date - ($2::int - 1),
           (now() AT TIME ZONE 'UTC')::date,
           '1 day'::interval
         )::date AS day_utc
       ),
       source_daily AS (
         SELECT
           snapshot_date::date AS day_utc,
           SUM(estimated_cost_units) AS estimated_cost_units
         FROM ${FINANCE_DAILY_SOURCE_TABLE}
         WHERE workspace_id = $1
           AND target_type = 'workspace'
           AND target_id = $1
           AND snapshot_date >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
           AND snapshot_date <= (now() AT TIME ZONE 'UTC')::date
         GROUP BY snapshot_date::date
       )
       SELECT
         to_char(dr.day_utc, 'YYYY-MM-DD') AS day_utc,
         COALESCE(FLOOR(source_daily.estimated_cost_units), 0)::bigint::text AS estimated_cost_units
       FROM date_range dr
       LEFT JOIN source_daily ON source_daily.day_utc = dr.day_utc
       ORDER BY dr.day_utc ASC`,
      [workspace_id, days_back],
    );

    const totalsRes = await client.query<{ estimated_cost_units: string }>(
      `SELECT
         COALESCE(FLOOR(SUM(estimated_cost_units)), 0)::bigint::text AS estimated_cost_units
       FROM ${FINANCE_DAILY_SOURCE_TABLE}
       WHERE workspace_id = $1
         AND target_type = 'workspace'
         AND target_id = $1
         AND snapshot_date >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
         AND snapshot_date <= (now() AT TIME ZONE 'UTC')::date`,
      [workspace_id, days_back],
    );

    return {
      schema_version: SCHEMA_VERSION,
      workspace_id,
      range: {
        days_back,
        from_day_utc: range.from_day_utc,
        to_day_utc: range.to_day_utc,
      },
      totals: {
        estimated_cost_units: totalsRes.rows[0]?.estimated_cost_units ?? "0",
      },
      series_daily: seriesRes.rows.map((row) => ({
        day_utc: row.day_utc,
        estimated_cost_units: row.estimated_cost_units ?? "0",
      })),
      warnings: [],
    };
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    return {
      schema_version: SCHEMA_VERSION,
      workspace_id,
      range: {
        days_back,
        from_day_utc: range.from_day_utc,
        to_day_utc: range.to_day_utc,
      },
      totals: null,
      series_daily: [],
      warnings: [{ kind: "finance_source_not_found" }],
    };
  }
}

async function computeFinanceMetricsInReadTx(
  pool: DbPool,
  workspace_id: string,
  days_back: number,
): Promise<FinanceMetricsPayload> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client);
    const payload = await computeFinanceMetricsPayload(client, workspace_id, days_back);
    await client.query("COMMIT");
    return payload;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function computeAndCacheMetricsEntry(
  pool: DbPool,
  workspace_id: string,
  days_back: number,
  fallbackRange: DateRange,
): Promise<FinanceCacheEntry> {
  let payload: FinanceMetricsPayload;
  let ttl_ms = financeCacheSuccessTtlMs();

  try {
    payload = await computeFinanceMetricsInReadTx(pool, workspace_id, days_back);
  } catch {
    payload = {
      schema_version: SCHEMA_VERSION,
      workspace_id,
      range: {
        days_back,
        from_day_utc: fallbackRange.from_day_utc,
        to_day_utc: fallbackRange.to_day_utc,
      },
      totals: null,
      series_daily: [],
      warnings: [{ kind: "finance_db_error" }],
    };
    ttl_ms = financeCacheErrorTtlMs();
  }

  const entry: FinanceCacheEntry = {
    payload,
    stored_at_monotonic_ms: monotonicNowMs(),
    ttl_ms,
  };
  financeMetricsCache.set(cacheKey(workspace_id, days_back), entry);
  pruneFinanceCache();
  return entry;
}

function asObjectRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

export function clearFinanceCache(): void {
  financeMetricsCache.clear();
  financeMetricsInFlight.clear();
  financeRateLimitWindows.clear();
}

export async function registerFinanceRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{ Body: unknown }>("/v1/finance/projection", async (req, reply) => {
    const bodyRecord = asObjectRecord(req.body);
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
        .send(buildContractError(reason_code, { header: "x-workspace-id" }));
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

    const parsedDaysBack = parseDaysBack(bodyRecord.days_back);
    if (!parsedDaysBack.ok) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { field: "days_back" }));
    }
    const days_back = parsedDaysBack.applied;

    // TODO(PR-12A): unify this in-memory limiter with shared Ops Dashboard limiter helper.
    if (!consumeOpsFinanceRateLimit(workspace_id)) {
      const reason_code = "rate_limited" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(
          buildContractError(reason_code, {
            scope: "ops_finance_projection_per_workspace_per_min",
            limit: OPS_DASHBOARD_FINANCE_PER_WORKSPACE_PER_MIN,
            window_sec: 60,
          }),
        );
    }

    let livePing: LivePingResult;
    try {
      livePing = await fetchLivePing(pool, days_back);
    } catch {
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["db.connectivity"] }));
    }
    const server_time = livePing.server_time;

    const key = cacheKey(workspace_id, days_back);
    pruneFinanceCache();

    let entry: FinanceCacheEntry | undefined = financeMetricsCache.get(key);
    let cached = false;

    if (isCacheEntryFresh(entry)) {
      cached = true;
    } else {
      entry = undefined;
    }

    if (!entry) {
      const inFlight = financeMetricsInFlight.get(key);
      if (inFlight) {
        cached = true;
        entry = await inFlight;
      } else {
        const computePromise = computeAndCacheMetricsEntry(
          pool,
          workspace_id,
          days_back,
          livePing.range,
        ).finally(() => {
          financeMetricsInFlight.delete(key);
        });
        financeMetricsInFlight.set(key, computePromise);
        entry = await computePromise;
      }
    }

    const responsePayload: FinanceResponse = {
      ...entry.payload,
      server_time,
      meta: {
        cached,
        cache_ttl_sec: Math.floor(entry.ttl_ms / 1000),
      },
    };

    return reply.code(SUCCESS_HTTP_STATUS).send(responsePayload);
  });
}
