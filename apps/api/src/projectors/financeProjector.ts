import type { FinanceEventV1, FinanceUsageRecordedV1 } from "@agentapp/shared";

import type { DbClient, DbPool } from "../db/pool.js";
import { tryMarkApplied } from "./projectorDb.js";

export const FINANCE_PROJECTOR_NAME = "proj_finance";

const MAX_COST_USD_MICROS = 9_000_000_000_000_000n;
const MAX_TOKENS = 1_000_000_000_000_000n;

type ParsedUsage = {
  workspace_id: string;
  entity_id: string;
  usage_id: string;
  cost_usd_micros: bigint;
  prompt_tokens: bigint;
  completion_tokens: bigint;
  total_tokens: bigint;
  occurred_at: string;
  day_utc: string;
};

function isFinanceUsageEvent(event: FinanceEventV1): event is FinanceUsageRecordedV1 {
  return event.event_type === "finance.usage_recorded";
}

function logValidationSkip(event: FinanceEventV1, reason: string): void {
  console.warn(
    `[proj_finance] skipped invalid event ${event.event_id} in workspace ${event.workspace_id}: ${reason}`,
  );
}

function parseNonNegativeIntegerLike(
  value: unknown,
  field: string,
  maxInclusive: bigint,
): { ok: true; value: bigint } | { ok: false; reason: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, reason: `${field} must be an integer-like value` };
    }
    if (value < 0) {
      return { ok: false, reason: `${field} must be >= 0` };
    }
    const asBigInt = BigInt(value);
    if (asBigInt > maxInclusive) {
      return { ok: false, reason: `${field} exceeds max` };
    }
    return { ok: true, value: asBigInt };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, reason: `${field} must be an integer-like value` };
    }
    const asBigInt = BigInt(trimmed);
    if (asBigInt > maxInclusive) {
      return { ok: false, reason: `${field} exceeds max` };
    }
    return { ok: true, value: asBigInt };
  }

  return { ok: false, reason: `${field} must be provided` };
}

async function parseOccurredAt(
  tx: DbClient,
  rawOccurredAt: unknown,
): Promise<{ ok: true; occurred_at: string; day_utc: string } | { ok: false; reason: string }> {
  if (typeof rawOccurredAt !== "string" || rawOccurredAt.trim().length === 0) {
    return { ok: false, reason: "occurred_at is required" };
  }

  try {
    const res = await tx.query<{ occurred_at: string; day_utc: string; is_future: boolean }>(
      `SELECT
         $1::timestamptz::text AS occurred_at,
         (($1::timestamptz AT TIME ZONE 'UTC')::date)::text AS day_utc,
         ($1::timestamptz > now() + interval '24 hours') AS is_future`,
      [rawOccurredAt],
    );

    if (res.rows[0]?.is_future === true) {
      return { ok: false, reason: "occurred_at is too far in the future" };
    }

    return {
      ok: true,
      occurred_at: res.rows[0]?.occurred_at ?? rawOccurredAt,
      day_utc: res.rows[0]?.day_utc ?? "1970-01-01",
    };
  } catch {
    return { ok: false, reason: "occurred_at cast failed" };
  }
}

async function updateProjectorProgress(
  tx: DbClient,
  workspace_id: string,
  event_id: string,
  occurred_at: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO proj_projectors (projector_name, last_recorded_at, last_event_id)
     VALUES ($1, $2::timestamptz, $3)
     ON CONFLICT (projector_name) DO UPDATE
     SET
       last_recorded_at = CASE
         WHEN proj_projectors.last_recorded_at IS NULL THEN EXCLUDED.last_recorded_at
         WHEN EXCLUDED.last_recorded_at > proj_projectors.last_recorded_at THEN EXCLUDED.last_recorded_at
         WHEN EXCLUDED.last_recorded_at = proj_projectors.last_recorded_at
              AND EXCLUDED.last_event_id > COALESCE(proj_projectors.last_event_id, '')
           THEN EXCLUDED.last_recorded_at
         ELSE proj_projectors.last_recorded_at
       END,
       last_event_id = CASE
         WHEN proj_projectors.last_recorded_at IS NULL THEN EXCLUDED.last_event_id
         WHEN EXCLUDED.last_recorded_at > proj_projectors.last_recorded_at THEN EXCLUDED.last_event_id
         WHEN EXCLUDED.last_recorded_at = proj_projectors.last_recorded_at
              AND EXCLUDED.last_event_id > COALESCE(proj_projectors.last_event_id, '')
           THEN EXCLUDED.last_event_id
         ELSE proj_projectors.last_event_id
       END`,
    [FINANCE_PROJECTOR_NAME, occurred_at, event_id],
  );

  await tx.query("SAVEPOINT sp_finance_wm").catch(() => {});
  try {
    await tx.query(
      `INSERT INTO projector_watermarks (workspace_id, last_applied_event_occurred_at, updated_at)
       VALUES ($1, $2::timestamptz, now())
       ON CONFLICT (workspace_id) DO UPDATE
       SET
         last_applied_event_occurred_at = GREATEST(
           COALESCE(projector_watermarks.last_applied_event_occurred_at, '-infinity'::timestamptz),
           EXCLUDED.last_applied_event_occurred_at
         ),
         updated_at = now()`,
      [workspace_id, occurred_at],
    );
  } catch {
    try {
      await tx.query("ROLLBACK TO SAVEPOINT sp_finance_wm");
    } catch {
      // swallow rollback-to-savepoint failures (network/connection edge cases)
    }
  } finally {
    try {
      await tx.query("RELEASE SAVEPOINT sp_finance_wm");
    } catch {
      // swallow release failures
    }
  }
}

async function validateUsageEvent(tx: DbClient, event: FinanceUsageRecordedV1): Promise<ParsedUsage | null> {
  const workspace_id = event.workspace_id?.trim();
  if (!workspace_id) {
    logValidationSkip(event, "workspace_id is required");
    return null;
  }

  const entity_id_raw = (event as FinanceUsageRecordedV1 & { entity_id?: unknown }).entity_id;
  const entity_id = typeof entity_id_raw === "string" ? entity_id_raw.trim() : "";
  if (!entity_id) {
    logValidationSkip(event, "entity_id is required");
    return null;
  }

  const usage_id = typeof event.data?.usage_id === "string" ? event.data.usage_id.trim() : "";
  if (!usage_id) {
    logValidationSkip(event, "data.usage_id is required");
    return null;
  }
  if (usage_id !== entity_id) {
    logValidationSkip(event, "entity_id must match data.usage_id");
    return null;
  }

  const cost = parseNonNegativeIntegerLike(event.data.cost_usd_micros, "cost_usd_micros", MAX_COST_USD_MICROS);
  if (!cost.ok) {
    logValidationSkip(event, cost.reason);
    return null;
  }
  const prompt = parseNonNegativeIntegerLike(event.data.prompt_tokens, "prompt_tokens", MAX_TOKENS);
  if (!prompt.ok) {
    logValidationSkip(event, prompt.reason);
    return null;
  }
  const completion = parseNonNegativeIntegerLike(
    event.data.completion_tokens,
    "completion_tokens",
    MAX_TOKENS,
  );
  if (!completion.ok) {
    logValidationSkip(event, completion.reason);
    return null;
  }

  const total_tokens = prompt.value + completion.value;
  if (total_tokens > MAX_TOKENS) {
    logValidationSkip(event, "total_tokens exceeds max");
    return null;
  }

  const occurred = await parseOccurredAt(tx, event.occurred_at);
  if (!occurred.ok) {
    logValidationSkip(event, occurred.reason);
    return null;
  }

  return {
    workspace_id,
    entity_id,
    usage_id,
    cost_usd_micros: cost.value,
    prompt_tokens: prompt.value,
    completion_tokens: completion.value,
    total_tokens,
    occurred_at: occurred.occurred_at,
    day_utc: occurred.day_utc,
  };
}

async function applyUsageRecorded(tx: DbClient, parsed: ParsedUsage, event_id: string): Promise<void> {
  await tx.query(
    `INSERT INTO public.proj_finance_daily (
      workspace_id,
      day_utc,
      cost_usd_micros,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      event_count,
      last_event_id,
      last_event_occurred_at,
      updated_at
    ) VALUES (
      $1, $2::date, $3::bigint, $4::bigint, $5::bigint, $6::bigint, 1, $7, $8::timestamptz, now()
    )
    ON CONFLICT (workspace_id, day_utc) DO UPDATE
    SET
      cost_usd_micros = public.proj_finance_daily.cost_usd_micros + EXCLUDED.cost_usd_micros,
      prompt_tokens = public.proj_finance_daily.prompt_tokens + EXCLUDED.prompt_tokens,
      completion_tokens = public.proj_finance_daily.completion_tokens + EXCLUDED.completion_tokens,
      total_tokens = public.proj_finance_daily.total_tokens + EXCLUDED.total_tokens,
      event_count = public.proj_finance_daily.event_count + 1,
      last_event_occurred_at = GREATEST(
        public.proj_finance_daily.last_event_occurred_at,
        EXCLUDED.last_event_occurred_at
      ),
      last_event_id = CASE
        WHEN EXCLUDED.last_event_occurred_at > public.proj_finance_daily.last_event_occurred_at
          THEN EXCLUDED.last_event_id
        WHEN EXCLUDED.last_event_occurred_at = public.proj_finance_daily.last_event_occurred_at
             AND EXCLUDED.last_event_id > public.proj_finance_daily.last_event_id
          THEN EXCLUDED.last_event_id
        ELSE public.proj_finance_daily.last_event_id
      END,
      updated_at = now()`,
    [
      parsed.workspace_id,
      parsed.day_utc,
      parsed.cost_usd_micros.toString(),
      parsed.prompt_tokens.toString(),
      parsed.completion_tokens.toString(),
      parsed.total_tokens.toString(),
      event_id,
      parsed.occurred_at,
    ],
  );
}

async function applyInTx(tx: DbClient, event: FinanceEventV1): Promise<void> {
  if (!isFinanceUsageEvent(event)) return;

  const applied = await tryMarkApplied(tx, FINANCE_PROJECTOR_NAME, event.event_id);
  if (!applied) return;

  const parsed = await validateUsageEvent(tx, event);
  if (parsed) {
    await applyUsageRecorded(tx, parsed, event.event_id);
    await updateProjectorProgress(tx, parsed.workspace_id, event.event_id, parsed.occurred_at);
    return;
  }

  // Validation failures are skip-only and must not halt the projector batch.
  // Even on skip, advance projector progress when workspace_id + occurred_at are parseable.
  // This prevents watermark/progress stagnation on a stream with repeated bad events.
  const workspace_id = event.workspace_id?.trim();
  if (!workspace_id) return;

  const occurred = await parseOccurredAt(tx, event.occurred_at);
  if (!occurred.ok) return;

  await updateProjectorProgress(tx, workspace_id, event.event_id, occurred.occurred_at);
}

export async function applyFinanceEvent(pool: DbPool, envelope: FinanceEventV1): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('statement_timeout', '2000ms', true)`);
    await applyInTx(client, envelope);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow rollback failures
    }
    throw err;
  } finally {
    client.release();
  }
}
