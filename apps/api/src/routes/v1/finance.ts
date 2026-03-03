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
 * Finance source order for PR-12A:
 * - A) public.proj_finance_daily (if compatible columns exist)
 * - B) public.sec_survival_ledger_daily
 * - C) none (table missing / incompatible)
 *
 * Top-models extension source:
 * - public.proj_finance_model_daily (model-granular projection only)
 * - Never derive model ranking from workspace/day aggregate rows.
 *
 * Safety:
 * - Every tenant query is workspace-scoped.
 * - Date range is bounded by DB UTC day window and days_back <= 365.
 * - Uses existing survival index:
 *   sec_survival_ledger_daily_workspace_date_idx (workspace_id, snapshot_date DESC, updated_at DESC)
 */
const FINANCE_DAILY_SOURCE_A = "public.proj_finance_daily";
const FINANCE_DAILY_SOURCE_B = "public.sec_survival_ledger_daily";
const FINANCE_TOP_MODELS_SOURCE = "public.proj_finance_model_daily";
const SUCCESS_HTTP_STATUS = httpStatusForReasonCode("duplicate_idempotent_replay");
const DEFAULT_DAYS_BACK = 30;
const MAX_DAYS_BACK = 365;
const MIN_DAYS_BACK = 1;
const MAX_INCLUDE_ITEMS = 10;
const DEFAULT_FINANCE_CACHE_MAX_ENTRIES = 1000;
const OPS_DASHBOARD_FINANCE_PER_WORKSPACE_PER_MIN = 300;
const TOP_MODELS_LIMIT = 5;

type FinanceInclude = "top_models";
const FINANCE_INCLUDE_ALLOWLIST = new Set<FinanceInclude>(["top_models"]);

type FinanceSource = "proj_finance_daily" | "sec_survival_ledger_daily" | "none";

type FinanceSeriesRow = {
  day_utc: string;
  estimated_cost_units: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
};

type FinanceTotals = {
  estimated_cost_units: string | null;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
};

type FinanceTopModelRow = {
  model: string;
  estimated_cost_units: string;
  total_tokens: string;
};

type FinanceMetricsPayload = {
  schema_version: typeof SCHEMA_VERSION;
  meta: {
    applied_days_back: number;
    source: FinanceSource;
    include_applied?: FinanceInclude[];
  };
  totals: FinanceTotals | null;
  series_daily: FinanceSeriesRow[];
  warnings: string[];
  top_models?: FinanceTopModelRow[];
};

type FinanceResponse = FinanceMetricsPayload & {
  server_time: string;
  meta: FinanceMetricsPayload["meta"] & {
    cached: boolean;
    cache_age_ms: number | null;
  };
};

type FinanceCacheEntry = {
  payload: FinanceMetricsPayload;
  stored_at_monotonic_ms: number;
  ttl_ms: number;
};

type FinanceComputeResult = {
  payload: FinanceMetricsPayload;
  has_include_error: boolean;
};

type RateLimitWindow = {
  windowStartSec: number;
  count: number;
};

type LivePingResult = {
  server_time: string;
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
  let numericRaw: number;
  if (typeof raw === "number") {
    numericRaw = raw;
  } else if (typeof raw === "string") {
    if (raw.trim().length === 0) return { ok: false };
    numericRaw = Number(raw);
  } else {
    return { ok: false };
  }
  if (!Number.isFinite(numericRaw) || !Number.isInteger(numericRaw)) {
    return { ok: false };
  }
  if (numericRaw < MIN_DAYS_BACK) return { ok: true, applied: MIN_DAYS_BACK };
  if (numericRaw > MAX_DAYS_BACK) return { ok: true, applied: MAX_DAYS_BACK };
  return { ok: true, applied: numericRaw };
}

function parseInclude(raw: unknown): { ok: true; applied: FinanceInclude[] } | { ok: false } {
  if (raw === undefined) return { ok: true, applied: [] };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.length > MAX_INCLUDE_ITEMS) return { ok: false };

  const includeSet = new Set<FinanceInclude>();
  for (const entry of raw) {
    if (typeof entry !== "string") return { ok: false };
    const normalized = entry.trim();
    if (normalized.length === 0) continue;
    if (FINANCE_INCLUDE_ALLOWLIST.has(normalized as FinanceInclude)) {
      includeSet.add(normalized as FinanceInclude);
    }
  }

  return {
    ok: true,
    applied: Array.from(includeSet).sort((a, b) => a.localeCompare(b)),
  };
}

function cacheKey(workspace_id: string, days_back: number, include_applied: readonly FinanceInclude[]): string {
  if (include_applied.length === 0) {
    return `finance:${workspace_id}:${days_back}`;
  }
  return `finance:${workspace_id}:${days_back}:inc=${include_applied.join(",")}`;
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

function isUndefinedColumnError(err: unknown): boolean {
  return pgErrorCode(err) === "42703";
}

async function beginTimedReadTx(client: DbClient): Promise<void> {
  await client.query("BEGIN READ ONLY");
  await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
    `${financeStatementTimeoutMs()}ms`,
  ]);
}

async function fetchLivePing(pool: DbPool): Promise<LivePingResult> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client);
    const pingRes = await client.query<{ server_time: string }>(
      `SELECT (now() AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
    );
    await client.query("COMMIT");
    return {
      server_time: asIsoUtcFromDbText(pingRes.rows[0]?.server_time),
    };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error("finance_ping_failed");
  } finally {
    client.release();
  }
}

function buildNonePayload(days_back: number, warning: "finance_source_not_found" | "finance_db_error"): FinanceMetricsPayload {
  return {
    schema_version: SCHEMA_VERSION,
    meta: {
      applied_days_back: days_back,
      source: "none",
    },
    totals: null,
    series_daily: [],
    warnings: [warning],
  };
}

async function queryFromProjFinanceDaily(
  client: DbClient,
  workspace_id: string,
  days_back: number,
): Promise<FinanceMetricsPayload> {
  const seriesRes = await client.query<{
    day_utc: string;
    estimated_cost_units: string;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
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
         day_utc::date AS day_utc,
         SUM(cost_usd_micros) AS estimated_cost_units,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(completion_tokens) AS completion_tokens,
         SUM(total_tokens) AS total_tokens
       FROM ${FINANCE_DAILY_SOURCE_A}
       WHERE workspace_id = $1
         AND day_utc >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
         AND day_utc <= (now() AT TIME ZONE 'UTC')::date
       GROUP BY day_utc::date
     )
     SELECT
       to_char(dr.day_utc, 'YYYY-MM-DD') AS day_utc,
       COALESCE(source_daily.estimated_cost_units, 0)::text AS estimated_cost_units,
       COALESCE(source_daily.prompt_tokens, 0)::text AS prompt_tokens,
       COALESCE(source_daily.completion_tokens, 0)::text AS completion_tokens,
       COALESCE(source_daily.total_tokens, 0)::text AS total_tokens
     FROM date_range dr
     LEFT JOIN source_daily ON source_daily.day_utc = dr.day_utc
     ORDER BY dr.day_utc ASC`,
    [workspace_id, days_back],
  );

  const totalsRes = await client.query<{
    estimated_cost_units: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
  }>(
    `SELECT
       COALESCE(SUM(cost_usd_micros), 0)::text AS estimated_cost_units,
       COALESCE(SUM(prompt_tokens), 0)::text AS prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::text AS completion_tokens,
       COALESCE(SUM(total_tokens), 0)::text AS total_tokens
     FROM ${FINANCE_DAILY_SOURCE_A}
     WHERE workspace_id = $1
       AND day_utc >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
       AND day_utc <= (now() AT TIME ZONE 'UTC')::date`,
    [workspace_id, days_back],
  );

  return {
    schema_version: SCHEMA_VERSION,
    meta: {
      applied_days_back: days_back,
      source: "proj_finance_daily",
    },
    totals: {
      estimated_cost_units: totalsRes.rows[0]?.estimated_cost_units ?? "0",
      prompt_tokens: totalsRes.rows[0]?.prompt_tokens ?? "0",
      completion_tokens: totalsRes.rows[0]?.completion_tokens ?? "0",
      total_tokens: totalsRes.rows[0]?.total_tokens ?? "0",
    },
    series_daily: seriesRes.rows.map((row) => ({
      day_utc: row.day_utc,
      estimated_cost_units: row.estimated_cost_units ?? "0",
      prompt_tokens: row.prompt_tokens ?? "0",
      completion_tokens: row.completion_tokens ?? "0",
      total_tokens: row.total_tokens ?? "0",
    })),
    warnings: [],
  };
}

async function hasProjFinanceDailyRowsInRange(
  client: DbClient,
  workspace_id: string,
  days_back: number,
): Promise<boolean> {
  const existsRes = await client.query<{ has_rows: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM ${FINANCE_DAILY_SOURCE_A}
       WHERE workspace_id = $1
         AND day_utc >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
         AND day_utc <= (now() AT TIME ZONE 'UTC')::date
       LIMIT 1
     ) AS has_rows`,
    [workspace_id, days_back],
  );
  return existsRes.rows[0]?.has_rows === true;
}

async function queryFromSurvivalDaily(
  client: DbClient,
  workspace_id: string,
  days_back: number,
): Promise<FinanceMetricsPayload> {
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
       FROM ${FINANCE_DAILY_SOURCE_B}
       WHERE workspace_id = $1
         AND target_type = 'workspace'
         AND target_id = $1
         AND snapshot_date >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
         AND snapshot_date <= (now() AT TIME ZONE 'UTC')::date
       GROUP BY snapshot_date::date
     )
     SELECT
       to_char(dr.day_utc, 'YYYY-MM-DD') AS day_utc,
       COALESCE(source_daily.estimated_cost_units, 0)::text AS estimated_cost_units
     FROM date_range dr
     LEFT JOIN source_daily ON source_daily.day_utc = dr.day_utc
     ORDER BY dr.day_utc ASC`,
    [workspace_id, days_back],
  );

  const totalsRes = await client.query<{ estimated_cost_units: string }>(
    `SELECT
       COALESCE(SUM(estimated_cost_units), 0)::text AS estimated_cost_units
     FROM ${FINANCE_DAILY_SOURCE_B}
     WHERE workspace_id = $1
       AND target_type = 'workspace'
       AND target_id = $1
       AND snapshot_date >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
       AND snapshot_date <= (now() AT TIME ZONE 'UTC')::date`,
    [workspace_id, days_back],
  );

  return {
    schema_version: SCHEMA_VERSION,
    meta: {
      applied_days_back: days_back,
      source: "sec_survival_ledger_daily",
    },
    totals: {
      estimated_cost_units: totalsRes.rows[0]?.estimated_cost_units ?? "0",
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    },
    series_daily: seriesRes.rows.map((row) => ({
      day_utc: row.day_utc,
      estimated_cost_units: row.estimated_cost_units ?? "0",
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    })),
    warnings: [],
  };
}

function appendUniqueWarning(existingWarnings: string[], warning: string): string[] {
  return existingWarnings.includes(warning) ? existingWarnings : [...existingWarnings, warning];
}

async function queryTopModelsFromModelDaily(
  client: DbClient,
  workspace_id: string,
  days_back: number,
): Promise<FinanceTopModelRow[]> {
  const topModelsRes = await client.query<{
    model: string;
    estimated_cost_units: string;
    total_tokens: string;
  }>(
    `WITH grouped AS (
       SELECT
         COALESCE(
           NULLIF(
             left(regexp_replace(COALESCE(model, ''), '[^a-zA-Z0-9._:/-]', '', 'g'), 64),
             ''
           ),
           'unknown'
         ) AS model_sanitized,
         SUM(cost_usd_micros) AS estimated_cost_units,
         SUM(total_tokens) AS total_tokens
       FROM ${FINANCE_TOP_MODELS_SOURCE}
       WHERE workspace_id = $1
         AND day_utc >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
         AND day_utc <= (now() AT TIME ZONE 'UTC')::date
       GROUP BY model_sanitized
     )
     SELECT
       model_sanitized AS model,
       COALESCE(estimated_cost_units, 0)::text AS estimated_cost_units,
       COALESCE(total_tokens, 0)::text AS total_tokens
     FROM grouped
     ORDER BY estimated_cost_units::numeric DESC, model COLLATE "C" ASC
     LIMIT ${TOP_MODELS_LIMIT}`,
    [workspace_id, days_back],
  );

  return topModelsRes.rows.map((row) => ({
    model: row.model,
    estimated_cost_units: row.estimated_cost_units ?? "0",
    total_tokens: row.total_tokens ?? "0",
  }));
}

async function applyIncludeExtensions(
  client: DbClient,
  basePayload: FinanceMetricsPayload,
  workspace_id: string,
  days_back: number,
  include_applied: readonly FinanceInclude[],
): Promise<FinanceComputeResult> {
  if (include_applied.length === 0) {
    return { payload: basePayload, has_include_error: false };
  }

  let payload: FinanceMetricsPayload = {
    ...basePayload,
    meta: {
      ...basePayload.meta,
      include_applied: [...include_applied],
    },
  };

  if (!include_applied.includes("top_models")) {
    return { payload, has_include_error: false };
  }

  await client.query("SAVEPOINT sp_finance_top_models");
  try {
    const topModels = await queryTopModelsFromModelDaily(client, workspace_id, days_back);
    await client.query("RELEASE SAVEPOINT sp_finance_top_models");
    payload = {
      ...payload,
      top_models: topModels,
    };
    return { payload, has_include_error: false };
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT sp_finance_top_models").catch(() => {});
    await client.query("RELEASE SAVEPOINT sp_finance_top_models").catch(() => {});
    if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
      payload = {
        ...payload,
        warnings: appendUniqueWarning(payload.warnings, "top_models_unsupported"),
        top_models: [],
      };
      return { payload, has_include_error: false };
    }
    payload = {
      ...payload,
      warnings: appendUniqueWarning(payload.warnings, "top_models_error"),
      top_models: [],
    };
    return { payload, has_include_error: true };
  }
}

async function computeFinanceMetricsPayload(
  client: DbClient,
  workspace_id: string,
  days_back: number,
  include_applied: readonly FinanceInclude[],
): Promise<FinanceComputeResult> {
  let sourceAHasData = false;
  await client.query("SAVEPOINT sp_finance_source_a");
  try {
    sourceAHasData = await hasProjFinanceDailyRowsInRange(client, workspace_id, days_back);
    if (!sourceAHasData) {
      await client.query("RELEASE SAVEPOINT sp_finance_source_a");
    } else {
      const payload = await queryFromProjFinanceDaily(client, workspace_id, days_back);
      await client.query("RELEASE SAVEPOINT sp_finance_source_a");
      return applyIncludeExtensions(client, payload, workspace_id, days_back, include_applied);
    }
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT sp_finance_source_a").catch(() => {});
    await client.query("RELEASE SAVEPOINT sp_finance_source_a").catch(() => {});
    if (!isUndefinedTableError(err) && !isUndefinedColumnError(err)) {
      throw err;
    }
    sourceAHasData = false;
  }

  let fallbackPayload: FinanceMetricsPayload;
  try {
    fallbackPayload = await queryFromSurvivalDaily(client, workspace_id, days_back);
  } catch (err) {
    if (!isUndefinedTableError(err) && !isUndefinedColumnError(err)) {
      throw err;
    }
    fallbackPayload = buildNonePayload(days_back, "finance_source_not_found");
  }
  return applyIncludeExtensions(client, fallbackPayload, workspace_id, days_back, include_applied);
}

async function computeFinanceMetricsInReadTx(
  pool: DbPool,
  workspace_id: string,
  days_back: number,
  include_applied: readonly FinanceInclude[],
): Promise<FinanceComputeResult> {
  const client = await pool.connect();
  try {
    await beginTimedReadTx(client);
    const payload = await computeFinanceMetricsPayload(
      client,
      workspace_id,
      days_back,
      include_applied,
    );
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
  include_applied: readonly FinanceInclude[],
): Promise<FinanceCacheEntry> {
  let payload: FinanceMetricsPayload;
  let ttl_ms = financeCacheSuccessTtlMs();

  try {
    const result = await computeFinanceMetricsInReadTx(pool, workspace_id, days_back, include_applied);
    payload = result.payload;
    if (result.has_include_error) {
      ttl_ms = financeCacheErrorTtlMs();
    }
  } catch {
    payload = buildNonePayload(days_back, "finance_db_error");
    ttl_ms = financeCacheErrorTtlMs();
  }

  const entry: FinanceCacheEntry = {
    payload,
    stored_at_monotonic_ms: monotonicNowMs(),
    ttl_ms,
  };
  financeMetricsCache.set(cacheKey(workspace_id, days_back, include_applied), entry);
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

    const parsedInclude = parseInclude(bodyRecord.include);
    if (!parsedInclude.ok) {
      const reason_code = "invalid_payload_combination" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { field: "include" }));
    }
    const include_applied = parsedInclude.applied;

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
      livePing = await fetchLivePing(pool);
    } catch {
      const reason_code = "internal_error" as const;
      return reply
        .code(httpStatusForReasonCode(reason_code))
        .send(buildContractError(reason_code, { failed_checks: ["db.connectivity"] }));
    }
    const server_time = livePing.server_time;

    const key = cacheKey(workspace_id, days_back, include_applied);
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
        cached = false;
        entry = await inFlight;
      } else {
        const computePromise = computeAndCacheMetricsEntry(
          pool,
          workspace_id,
          days_back,
          include_applied,
        ).finally(() => {
          financeMetricsInFlight.delete(key);
        });
        financeMetricsInFlight.set(key, computePromise);
        entry = await computePromise;
      }
    }

    const cache_age_ms = cached ? Math.max(0, monotonicNowMs() - entry.stored_at_monotonic_ms) : null;
    const responsePayload: FinanceResponse = {
      ...entry.payload,
      server_time,
      meta: {
        ...entry.payload.meta,
        cached,
        cache_age_ms,
      },
    };

    return reply.code(SUCCESS_HTTP_STATUS).send(responsePayload);
  });
}
