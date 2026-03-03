import type { DbClient, DbPool } from "../db/pool.js";

export type OpsDashboardRateLimitRule = {
  scope: string;
  bucket_key: string;
  limit: number;
  window_sec: number;
};

type IncrementResult = {
  count: number;
  retry_after_sec: number;
  server_time: string;
};

export type OpsDashboardRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      details: {
        scope: string;
        limit: number;
        window_sec: number;
        retry_after_sec: number;
        server_time: string;
      };
    };

function isPgErrorWithCode(err: unknown, code: string): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === code;
}

async function incrementBucketTx(
  client: DbClient,
  input: { bucket_key: string; window_sec: number },
): Promise<IncrementResult> {
  const res = await client.query<{
    count: string;
    retry_after_sec: string;
    server_time: string;
  }>(
    `WITH t AS (
       SELECT
         (now() AT TIME ZONE 'UTC') AS now_utc,
         clock_timestamp() AS wall_clock
     ),
     w AS (
       SELECT
         to_timestamp(floor(extract(epoch FROM t.now_utc) / $2) * $2) AS window_start
       FROM t
     )
     INSERT INTO rate_limit_buckets (
       bucket_key,
       window_start,
       window_sec,
       count,
       updated_at
     )
     SELECT
       $1,
       w.window_start,
       $2,
       1,
       (SELECT wall_clock FROM t)
     FROM w
     ON CONFLICT (bucket_key, window_start, window_sec)
     DO UPDATE SET
       count = rate_limit_buckets.count + 1,
       updated_at = (SELECT wall_clock FROM t)
     RETURNING
       count::text AS count,
       GREATEST(
         EXTRACT(EPOCH FROM (window_start + (window_sec || ' seconds')::interval - (SELECT wall_clock FROM t)))::INT,
         0
       )::text AS retry_after_sec,
       ((SELECT wall_clock FROM t) AT TIME ZONE 'UTC')::text || 'Z' AS server_time`,
    [input.bucket_key, input.window_sec],
  );

  return {
    count: Number.parseInt(res.rows[0]?.count ?? "0", 10),
    retry_after_sec: Number.parseInt(res.rows[0]?.retry_after_sec ?? "0", 10),
    server_time: res.rows[0]?.server_time ?? "1970-01-01T00:00:00Z",
  };
}

export async function enforceOpsDashboardRateLimit(
  pool: DbPool,
  rules: OpsDashboardRateLimitRule[],
): Promise<OpsDashboardRateLimitResult> {
  const orderedRules = [...rules].sort((a, b) => a.bucket_key.localeCompare(b.bucket_key));
  const client = await pool.connect();
  let exceeded: OpsDashboardRateLimitResult & { ok: false } | null = null;

  try {
    await client.query("BEGIN");
    for (const rule of orderedRules) {
      const incremented = await incrementBucketTx(client, {
        bucket_key: rule.bucket_key,
        window_sec: rule.window_sec,
      });
      if (incremented.count <= rule.limit || exceeded) continue;
      exceeded = {
        ok: false,
        details: {
          scope: rule.scope,
          limit: rule.limit,
          window_sec: rule.window_sec,
          retry_after_sec: incremented.retry_after_sec,
          server_time: incremented.server_time,
        },
      };
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Ops dashboard limiter is best-effort. If limiter storage is unavailable,
    // allow request processing instead of forcing a 500 from observability endpoints.
    if (isPgErrorWithCode(err, "42P01") || isPgErrorWithCode(err, "42703")) {
      return { ok: true };
    }
    throw err;
  } finally {
    client.release();
  }

  if (exceeded) return exceeded;
  return { ok: true };
}
