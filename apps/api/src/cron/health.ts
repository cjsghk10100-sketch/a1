import type { DbPool } from "../db/pool.js";

type CronHealthRow = {
  check_name: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  metadata: unknown;
};

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function truncateError(input: string): string {
  if (input.length <= 1000) return input;
  return `${input.slice(0, 997)}...`;
}

export async function readCronHealth(
  pool: DbPool,
  check_name: string,
): Promise<CronHealthRow | null> {
  const res = await pool.query<CronHealthRow>(
    `SELECT
       check_name,
       last_success_at::text AS last_success_at,
       last_failure_at::text AS last_failure_at,
       consecutive_failures,
       last_error,
       metadata
     FROM cron_health
     WHERE check_name = $1
     LIMIT 1`,
    [check_name],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

export async function shouldRunCron(
  pool: DbPool,
  check_name: string,
  haltThreshold: number,
): Promise<boolean> {
  const health = await readCronHealth(pool, check_name);
  if (!health) return true;
  return health.consecutive_failures < haltThreshold;
}

export async function recordCronSuccess(
  pool: DbPool,
  check_name: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO cron_health (
       check_name,
       last_success_at,
       last_failure_at,
       consecutive_failures,
       last_error,
       metadata
     ) VALUES (
       $1,
       now(),
       NULL,
       0,
       NULL,
       $2::jsonb
     )
     ON CONFLICT (check_name) DO UPDATE SET
       last_success_at = now(),
       consecutive_failures = 0,
       last_error = NULL,
       metadata = EXCLUDED.metadata`,
    [check_name, toJson(metadata)],
  );
}

export async function recordCronFailure(
  pool: DbPool,
  check_name: string,
  errorMessage: string,
  metadata: Record<string, unknown>,
): Promise<number> {
  const res = await pool.query<{ consecutive_failures: string }>(
    `INSERT INTO cron_health (
       check_name,
       last_success_at,
       last_failure_at,
       consecutive_failures,
       last_error,
       metadata
     ) VALUES (
       $1,
       NULL,
       now(),
       1,
       $2,
       $3::jsonb
     )
     ON CONFLICT (check_name) DO UPDATE SET
       last_failure_at = now(),
       consecutive_failures = cron_health.consecutive_failures + 1,
       last_error = EXCLUDED.last_error,
       metadata = EXCLUDED.metadata
     RETURNING consecutive_failures::text`,
    [check_name, truncateError(errorMessage), toJson(metadata)],
  );
  return Number.parseInt(res.rows[0]?.consecutive_failures ?? "1", 10);
}
