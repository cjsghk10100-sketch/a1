import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { loadHeartCronConfig } from "../src/cron/config.js";
import { recordCronSuccess } from "../src/cron/health.js";
import { HEART_CRON_CHECK_NAME, tickHeartCron } from "../src/cron/heartCron.js";
import { createPool } from "../src/db/pool.js";

const { Client } = pg;

const RUN_SUFFIX = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_WORKSPACE_PREFIX = `ws_cronv0_${RUN_SUFFIX}`;

process.env.CRON_JITTER_MAX_MS = "0";
process.env.CRON_BATCH_LIMIT = "100";
process.env.CRON_WORKSPACE_CONCURRENCY = "4";
process.env.CRON_APPROVAL_TIMEOUT_MS = "86400000";
process.env.CRON_RUN_STUCK_TIMEOUT_MS = "86400000";
process.env.CRON_DEMOTED_STALE_MS = "86400000";
process.env.CRON_WATCHDOG_ALERT_THRESHOLD = "3";
process.env.CRON_WATCHDOG_HALT_THRESHOLD = "5";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertSafeDatabaseUrl(databaseUrl: string): void {
  if (
    !databaseUrl.includes("test") &&
    !databaseUrl.includes("local") &&
    !databaseUrl.includes("127.0.0.1") &&
    !databaseUrl.includes("localhost")
  ) {
    throw new Error("DATABASE_URL does not look like a test DB");
  }
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
    );

    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function cleanupCaseTables(db: InstanceType<typeof Client>): Promise<void> {
  const likePattern = `${TEST_WORKSPACE_PREFIX}%`;
  await db.query("DELETE FROM cron_locks WHERE lock_name = $1", [HEART_CRON_CHECK_NAME]);
  await db.query("DELETE FROM cron_health WHERE check_name = $1", [HEART_CRON_CHECK_NAME]);
  await db.query("DELETE FROM proj_incidents WHERE workspace_id LIKE $1", [likePattern]);
  await db.query("DELETE FROM proj_approvals WHERE workspace_id LIKE $1", [likePattern]);
  await db.query("DELETE FROM proj_runs WHERE workspace_id LIKE $1", [likePattern]);
}

async function insertApproval(
  db: InstanceType<typeof Client>,
  input: {
    workspace_id: string;
    approval_id: string;
    status: "pending" | "held";
    ageSeconds: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO proj_approvals (
       approval_id,
       workspace_id,
       action,
       status,
       title,
       requested_by_type,
       requested_by_id,
       requested_at,
       correlation_id,
       created_at,
       updated_at
     ) VALUES (
       $1,
       $2,
       'external.write',
       $3,
       $4,
       'service',
       'cron_contract',
       now() - make_interval(secs => $5),
       $6,
       now() - make_interval(secs => $5),
       now() - make_interval(secs => $5)
     )`,
    [
      input.approval_id,
      input.workspace_id,
      input.status,
      `approval:${input.approval_id}`,
      input.ageSeconds,
      `corr:${input.approval_id}`,
    ],
  );
}

async function countCronIncidents(
  db: InstanceType<typeof Client>,
  workspace_id: string,
  job: string,
  entity_id: string,
): Promise<number> {
  const res = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type = 'incident.opened'
       AND data->>'source' = 'cron'
       AND data->>'cron_job' = $2
       AND data->>'work_item_id' = $3`,
    [workspace_id, job, entity_id],
  );
  return Number.parseInt(res.rows[0]?.count ?? "0", 10);
}

async function runCase(
  db: InstanceType<typeof Client>,
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  await cleanupCaseTables(db);
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[${name}] ${message}`);
  } finally {
    await cleanupCaseTables(db);
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertSafeDatabaseUrl(databaseUrl);

  await applyMigrations(databaseUrl);
  await applyMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  const cfg = loadHeartCronConfig();

  try {
    await runCase(db, "T1_workspace_isolation", async () => {
      const wsA = `${TEST_WORKSPACE_PREFIX}_t1_a`;
      const wsB = `${TEST_WORKSPACE_PREFIX}_t1_b`;
      await insertApproval(db, {
        workspace_id: wsA,
        approval_id: "appr_t1_stale",
        status: "pending",
        ageSeconds: 172800,
      });
      await insertApproval(db, {
        workspace_id: wsB,
        approval_id: "appr_t1_fresh",
        status: "pending",
        ageSeconds: 30,
      });

      await tickHeartCron(pool);

      assert.equal(await countCronIncidents(db, wsA, "approval_timeout", "appr_t1_stale"), 1);
      assert.equal(await countCronIncidents(db, wsB, "approval_timeout", "appr_t1_fresh"), 0);
    });

    await runCase(db, "T2_idempotency_same_window", async () => {
      const ws = `${TEST_WORKSPACE_PREFIX}_t2`;
      await insertApproval(db, {
        workspace_id: ws,
        approval_id: "appr_t2_stale",
        status: "held",
        ageSeconds: 172800,
      });

      await tickHeartCron(pool);
      await tickHeartCron(pool);

      const count = await countCronIncidents(db, ws, "approval_timeout", "appr_t2_stale");
      assert.equal(count, 1);

      const idempotency = await db.query<{ count: string }>(
        `SELECT count(DISTINCT idempotency_key)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'incident.opened'
           AND data->>'source' = 'cron'
           AND data->>'cron_job' = 'approval_timeout'
           AND data->>'work_item_id' = 'appr_t2_stale'`,
        [ws],
      );
      assert.equal(Number.parseInt(idempotency.rows[0]?.count ?? "0", 10), 1);
    });

    await runCase(db, "T3_cqrs_no_projection_updates", async () => {
      const ws = `${TEST_WORKSPACE_PREFIX}_t3`;
      const approvalId = "appr_t3_stale";
      await insertApproval(db, {
        workspace_id: ws,
        approval_id: approvalId,
        status: "pending",
        ageSeconds: 172800,
      });

      const before = await db.query<{ updated_at: string }>(
        `SELECT updated_at::text AS updated_at
         FROM proj_approvals
         WHERE workspace_id = $1
           AND approval_id = $2`,
        [ws, approvalId],
      );
      assert.equal(before.rowCount, 1);

      await tickHeartCron(pool);

      const after = await db.query<{ updated_at: string }>(
        `SELECT updated_at::text AS updated_at
         FROM proj_approvals
         WHERE workspace_id = $1
           AND approval_id = $2`,
        [ws, approvalId],
      );
      assert.equal(after.rowCount, 1);
      assert.equal(after.rows[0].updated_at, before.rows[0].updated_at);
    });

    await runCase(db, "T4_fencing_token_lock_loss_halts", async () => {
      const ws = `${TEST_WORKSPACE_PREFIX}_t4`;
      await insertApproval(db, {
        workspace_id: ws,
        approval_id: "appr_t4_stale",
        status: "pending",
        ageSeconds: 172800,
      });

      await assert.rejects(
        () =>
          tickHeartCron(pool, {
            onLockAcquired: async ({ lock_token }) => {
              await db.query(
                `UPDATE cron_locks
                 SET lock_token = $2
                 WHERE lock_name = $1
                   AND lock_token = $3`,
                [HEART_CRON_CHECK_NAME, `mutated_${RUN_SUFFIX}`, lock_token],
              );
            },
          }),
        /cron_lock_lost/,
      );

      assert.equal(await countCronIncidents(db, ws, "approval_timeout", "appr_t4_stale"), 0);
    });

    await runCase(db, "T5_watchdog_halt_and_recover", async () => {
      const ws = `${TEST_WORKSPACE_PREFIX}_t5`;
      await insertApproval(db, {
        workspace_id: ws,
        approval_id: "appr_t5_stale",
        status: "held",
        ageSeconds: 172800,
      });

      await db.query(
        `INSERT INTO cron_health (
           check_name,
           consecutive_failures,
           metadata
         ) VALUES (
           $1,
           $2,
           '{}'::jsonb
         )
         ON CONFLICT (check_name) DO UPDATE
         SET consecutive_failures = EXCLUDED.consecutive_failures`,
        [HEART_CRON_CHECK_NAME, cfg.watchdogHaltThreshold],
      );

      await tickHeartCron(pool);
      assert.equal(await countCronIncidents(db, ws, "approval_timeout", "appr_t5_stale"), 0);

      await recordCronSuccess(pool, HEART_CRON_CHECK_NAME, { reset: true });
      await tickHeartCron(pool);
      assert.equal(await countCronIncidents(db, ws, "approval_timeout", "appr_t5_stale"), 1);
    });
  } finally {
    await db.end();
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
