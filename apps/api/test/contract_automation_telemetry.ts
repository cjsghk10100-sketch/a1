import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  _clearAutomationFailTelemetry,
  _getLastAutomationFailTelemetry,
  applyAutomation,
} from "../src/automation/promotionLoop.js";
import { createPool } from "../src/db/pool.js";
import { appendToStream } from "../src/eventStore/index.js";
import { runWithTraceContext } from "../src/observability/traceContext.js";

const { Client } = pg;

type WarnRecord = Record<string, unknown>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertContractDbUrl(databaseUrl: string): void {
  if (!databaseUrl.includes("contract_test") && !databaseUrl.includes("test")) {
    throw new Error("DATABASE_URL must target contract/test database");
  }
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const appliedSet = new Set(applied.rows.map((row) => row.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
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

async function countEventsByIdempotency(
  db: pg.Client,
  workspace_id: string,
  idempotency_key: string,
): Promise<number> {
  const row = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND idempotency_key = $2`,
    [workspace_id, idempotency_key],
  );
  return Number.parseInt(row.rows[0]?.count ?? "0", 10);
}

function warnCollector(): {
  records: WarnRecord[];
  logger: { warn: (obj: WarnRecord) => void; debug: () => void; error: () => void };
} {
  const records: WarnRecord[] = [];
  return {
    records,
    logger: {
      warn: (obj: WarnRecord) => {
        records.push(obj);
      },
      debug: () => {},
      error: () => {},
    },
  };
}

async function waitForTelemetry(timeoutMs = 1000): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const current = _getLastAutomationFailTelemetry();
    if (current) return current as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for automation telemetry");
}

async function waitForWarnRecord(
  records: WarnRecord[],
  eventName: string,
  timeoutMs = 1000,
): Promise<WarnRecord> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const found = records.find((entry) => entry.event === eventName);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for warn event ${eventName}`);
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalFail = process.env.AUTOMATION_FAIL_TEST;
  const originalEnabled = process.env.PROMOTION_LOOP_ENABLED;

  process.env.NODE_ENV = "test";
  delete process.env.AUTOMATION_FAIL_TEST;
  delete process.env.PROMOTION_LOOP_ENABLED;

  const pool = createPool(databaseUrl);
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    // T1 success path: no telemetry.
    _clearAutomationFailTelemetry();
    await applyAutomation(pool, {
      workspace_id: `ws_auto_telemetry_t1_${randomUUID().slice(0, 8)}`,
      entity_type: "scorecard",
      entity_id: `sc_${randomUUID().slice(0, 8)}`,
      scorecard_id: `sc_${randomUUID().slice(0, 8)}`,
      trigger: "scorecard.recorded",
      event_data: undefined,
    });
    assert.equal(_getLastAutomationFailTelemetry(), null);

    // T2 failure path: behavior unchanged + exactly one telemetry warn.
    _clearAutomationFailTelemetry();
    process.env.AUTOMATION_FAIL_TEST = "1";
    process.env.PROMOTION_LOOP_ENABLED = "1";
    const wsT2 = `ws_auto_telemetry_t2_${randomUUID().slice(0, 8)}`;
    const runT2 = `run_${randomUUID().slice(0, 10)}`;
    const t2Log = warnCollector();
    await applyAutomation(pool, {
      workspace_id: wsT2,
      entity_type: "run",
      entity_id: runT2,
      run_id: runT2,
      trigger: "run.failed",
      log: t2Log.logger,
    });
    const t2Telemetry = await waitForTelemetry();
    assert.equal(t2Telemetry.event, "automation.apply_failed");
    await waitForWarnRecord(t2Log.records, "automation.apply_failed");
    assert.equal(t2Log.records.filter((entry) => entry.event === "automation.apply_failed").length, 1);
    const t2FallbackIdempotency =
      `incident:automation_internal_error:${wsT2}:run:${runT2}:run.failed`;
    assert.equal(await countEventsByIdempotency(db, wsT2, t2FallbackIdempotency), 1);

    // T3 trace fields and key format.
    _clearAutomationFailTelemetry();
    const wsT3 = `ws_auto_telemetry_t3_${randomUUID().slice(0, 8)}`;
    const runT3 = `run_${randomUUID().slice(0, 10)}`;
    const seededEvent = {
      event_id: randomUUID(),
      event_type: "run.failed",
      event_version: 1,
      occurred_at: new Date().toISOString(),
      workspace_id: wsT3,
      run_id: runT3,
      actor: { actor_type: "service", actor_id: "contract-test" },
      stream: { stream_type: "workspace", stream_id: wsT3 },
      correlation_id: `corr_seed_${randomUUID().slice(0, 6)}`,
      entity_type: "run",
      entity_id: runT3,
      data: {
        run_id: runT3,
        message: "seed failure",
      },
      policy_context: {},
      model_context: {},
      display: {},
    } as Parameters<typeof appendToStream>[1] & {
      entity_type: string;
      entity_id: string;
    };
    const seeded = await appendToStream(pool, seededEvent);
    await runWithTraceContext(
      {
        source: "http",
        request_id: "req_test_pr15",
        correlation_id: "corr_test_pr15",
        workspace_id: wsT3,
      },
      async () => {
        await applyAutomation(pool, {
          workspace_id: wsT3,
          entity_type: "run",
          entity_id: runT3,
          run_id: runT3,
          trigger: "run.failed",
          log: warnCollector().logger,
        });
      },
    );
    const t3Telemetry = await waitForTelemetry();
    assert.match(String(t3Telemetry.trace_key), new RegExp(`^auto_fail:${wsT3}:${runT3}:`));
    assert.ok(String(t3Telemetry.trace_key).endsWith(seeded.event_id));
    assert.equal(typeof t3Telemetry.reason_code, "string");
    assert.equal(t3Telemetry.request_id, "req_test_pr15");
    assert.equal(t3Telemetry.correlation_id, "corr_test_pr15");
    assert.equal("err" in t3Telemetry, false);
    assert.equal("error" in t3Telemetry, false);

    // T4 missing trace context + logger throw must not crash.
    _clearAutomationFailTelemetry();
    const wsT4 = `ws_auto_telemetry_t4_${randomUUID().slice(0, 8)}`;
    const runT4 = `run_${randomUUID().slice(0, 10)}`;
    await applyAutomation(pool, {
      workspace_id: wsT4,
      entity_type: "run",
      entity_id: runT4,
      run_id: runT4,
      trigger: "run.failed",
      log: {
        warn: () => {
          throw new Error("logger_fail");
        },
      },
    });
    const t4Telemetry = await waitForTelemetry();
    assert.equal(t4Telemetry.request_id, null);
    assert.equal(t4Telemetry.correlation_id, null);

    // T5 kill switch: no telemetry emitted.
    _clearAutomationFailTelemetry();
    process.env.PROMOTION_LOOP_ENABLED = "0";
    const wsT5 = `ws_auto_telemetry_t5_${randomUUID().slice(0, 8)}`;
    const runT5 = `run_${randomUUID().slice(0, 10)}`;
    const t5FallbackIdempotency =
      `incident:automation_internal_error:${wsT5}:run:${runT5}:run.failed`;
    await applyAutomation(pool, {
      workspace_id: wsT5,
      entity_type: "run",
      entity_id: runT5,
      run_id: runT5,
      trigger: "run.failed",
      log: warnCollector().logger,
    });
    assert.equal(_getLastAutomationFailTelemetry(), null);
    assert.equal(await countEventsByIdempotency(db, wsT5, t5FallbackIdempotency), 0);
  } finally {
    await db.end();
    await pool.end();
    _clearAutomationFailTelemetry();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFail === undefined) delete process.env.AUTOMATION_FAIL_TEST;
    else process.env.AUTOMATION_FAIL_TEST = originalFail;
    if (originalEnabled === undefined) delete process.env.PROMOTION_LOOP_ENABLED;
    else process.env.PROMOTION_LOOP_ENABLED = originalEnabled;
  }

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
