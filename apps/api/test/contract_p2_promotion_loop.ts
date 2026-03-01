import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

import { applyAutomation, getLatestEvent } from "../src/automation/promotionLoop.js";
import { createPool } from "../src/db/pool.js";
import { appendToStream } from "../src/eventStore/index.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

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

async function requestJson<T>(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text.length > 0 ? JSON.parse(text) : {}) as T,
  };
}

async function createRoom(baseUrl: string, workspace_id: string): Promise<string> {
  const room = await requestJson<{ room_id: string }>(
    baseUrl,
    "POST",
    "/v1/rooms",
    {
      title: "PR9 automation room",
      room_mode: "default",
      default_lang: "en",
    },
    { "x-workspace-id": workspace_id },
  );
  assert.equal(room.status, 201);
  return room.json.room_id;
}

async function createExperiment(
  baseUrl: string,
  workspace_id: string,
  room_id: string,
  risk_tier: "low" | "medium" | "high",
): Promise<string> {
  const experiment = await requestJson<{ experiment_id: string }>(
    baseUrl,
    "POST",
    "/v1/experiments",
    {
      room_id,
      title: `exp_${risk_tier}_${randomUUID().slice(0, 6)}`,
      hypothesis: "contract",
      success_criteria: { ok: true },
      stop_conditions: { stop: false },
      budget_cap_units: 1,
      risk_tier,
    },
    { "x-workspace-id": workspace_id },
  );
  assert.equal(experiment.status, 201);
  return experiment.json.experiment_id;
}

async function createRun(
  baseUrl: string,
  workspace_id: string,
  room_id: string,
  experiment_id?: string,
): Promise<string> {
  const run = await requestJson<{ run_id: string }>(
    baseUrl,
    "POST",
    "/v1/runs",
    {
      room_id,
      title: "automation run",
      experiment_id,
    },
    { "x-workspace-id": workspace_id },
  );
  assert.equal(run.status, 201);
  return run.json.run_id;
}

async function startRun(baseUrl: string, workspace_id: string, run_id: string): Promise<void> {
  const started = await requestJson<{ ok: boolean }>(
    baseUrl,
    "POST",
    `/v1/runs/${encodeURIComponent(run_id)}/start`,
    {},
    { "x-workspace-id": workspace_id },
  );
  assert.equal(started.status, 200);
}

async function failRun(baseUrl: string, workspace_id: string, run_id: string): Promise<number> {
  const failed = await requestJson<{ ok?: boolean; error?: string }>(
    baseUrl,
    "POST",
    `/v1/runs/${encodeURIComponent(run_id)}/fail`,
    {
      message: "contract failure",
      error: { code: "contract_failure" },
    },
    { "x-workspace-id": workspace_id },
  );
  return failed.status;
}

async function postScorecard(
  baseUrl: string,
  workspace_id: string,
  body: Record<string, unknown>,
): Promise<{ scorecard_id: string; status: number }> {
  const scorecard = await requestJson<{ scorecard_id: string }>(
    baseUrl,
    "POST",
    "/v1/scorecards",
    body,
    { "x-workspace-id": workspace_id },
  );
  return { status: scorecard.status, scorecard_id: scorecard.json.scorecard_id };
}

async function countEventsByIdempotency(
  db: pg.Client,
  workspace_id: string,
  event_type: string,
  idempotency_key: string,
): Promise<number> {
  const count = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1
       AND event_type = $2
       AND idempotency_key = $3`,
    [workspace_id, event_type, idempotency_key],
  );
  return Number(count.rows[0]?.count ?? "0");
}

async function waitForEventByIdempotency(
  db: pg.Client,
  workspace_id: string,
  event_type: string,
  idempotency_key: string,
  timeoutMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countEventsByIdempotency(db, workspace_id, event_type, idempotency_key)) > 0) return true;
    await delay(25);
  }
  return false;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  process.env.PROMOTION_LOOP_ENABLED = "1";
  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: { port: 0, databaseUrl },
    pool,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  const originalEnabled = process.env.PROMOTION_LOOP_ENABLED;
  const originalFailTest = process.env.AUTOMATION_FAIL_TEST;

  try {
    // T1 idempotency: repeated run.failed automation emits exactly one incident.
    {
      const workspace_id = `ws_pr9_t1_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      await startRun(baseUrl, workspace_id, run_id);
      const failStatus = await failRun(baseUrl, workspace_id, run_id);
      assert.equal(failStatus, 200);

      await applyAutomation(pool, {
        workspace_id,
        entity_type: "run",
        entity_id: run_id,
        run_id,
        trigger: "run.failed",
        event_data: { run_id },
        correlation_id: `corr:${workspace_id}:${run_id}`,
      });
      await applyAutomation(pool, {
        workspace_id,
        entity_type: "run",
        entity_id: run_id,
        run_id,
        trigger: "run.failed",
        event_data: { run_id },
        correlation_id: `corr:${workspace_id}:${run_id}`,
      });

      const key = `incident:run_failed:${workspace_id}:${run_id}`;
      const count = await countEventsByIdempotency(db, workspace_id, "incident.opened", key);
      assert.equal(count, 1);
    }

    // T2 iteration overflow emits incident once.
    {
      const workspace_id = `ws_pr9_t2_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      const score = await postScorecard(baseUrl, workspace_id, {
        run_id,
        template_key: "t2",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.4 }],
        metadata: { iteration_count: 5, max_iterations: 2, risk_tier: "low" },
      });
      assert.equal(score.status, 201);
      const key = `incident:iteration_overflow:${workspace_id}:${score.scorecard_id}`;
      const found = await waitForEventByIdempotency(db, workspace_id, "incident.opened", key);
      assert.equal(found, true);
      const count = await countEventsByIdempotency(db, workspace_id, "incident.opened", key);
      assert.equal(count, 1);

      // Event-only incident should still block follow-up approval request
      // even when proj_incidents has no row yet.
      const passScore = await postScorecard(baseUrl, workspace_id, {
        run_id,
        template_key: "t2-pass",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.95 }],
        metadata: { iteration_count: 1, max_iterations: 3, risk_tier: "low" },
      });
      assert.equal(passScore.status, 201);
      await delay(120);
      const approvalKey = `message:request_approval:${workspace_id}:${passScore.scorecard_id}`;
      const approvalCount = await countEventsByIdempotency(db, workspace_id, "message.created", approvalKey);
      assert.equal(approvalCount, 0);
    }

    // T3 risk_tier high escalation emits request_human_decision once.
    {
      const workspace_id = `ws_pr9_t3_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      const score = await postScorecard(baseUrl, workspace_id, {
        run_id,
        template_key: "t3",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.3 }],
        metadata: { iteration_count: 7, max_iterations: 3, risk_tier: "high" },
      });
      assert.equal(score.status, 201);
      const key = `message:request_human_decision:iteration_overflow:${workspace_id}:${score.scorecard_id}`;
      const found = await waitForEventByIdempotency(db, workspace_id, "message.created", key);
      assert.equal(found, true);
      const count = await countEventsByIdempotency(db, workspace_id, "message.created", key);
      assert.equal(count, 1);
    }

    // T4 high-risk run_failed with no pre-existing incident still escalates once.
    {
      const workspace_id = `ws_pr9_t4_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const experiment_id = await createExperiment(baseUrl, workspace_id, room_id, "high");
      const run_id = await createRun(baseUrl, workspace_id, room_id, experiment_id);
      await startRun(baseUrl, workspace_id, run_id);

      const failStatus = await failRun(baseUrl, workspace_id, run_id);
      assert.equal(failStatus, 200);

      const msgKey = `message:request_human_decision:run_failed:${workspace_id}:${run_id}`;
      const msgFound = await waitForEventByIdempotency(db, workspace_id, "message.created", msgKey);
      assert.equal(msgFound, true);
      const msgCount = await countEventsByIdempotency(db, workspace_id, "message.created", msgKey);
      assert.equal(msgCount, 1);
    }

    // T5 debounce: active incident exists -> no escalation message for run_failed.
    {
      const workspace_id = `ws_pr9_t5_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const experiment_id = await createExperiment(baseUrl, workspace_id, room_id, "high");
      const run_id = await createRun(baseUrl, workspace_id, room_id, experiment_id);
      await startRun(baseUrl, workspace_id, run_id);
      const preIncident = await requestJson<{ incident_id: string }>(
        baseUrl,
        "POST",
        "/v1/incidents",
        {
          title: "pre-existing incident",
          run_id,
          severity: "high",
          category: "run_failed",
        },
        { "x-workspace-id": workspace_id },
      );
      assert.equal(preIncident.status, 201);

      const failStatus = await failRun(baseUrl, workspace_id, run_id);
      assert.equal(failStatus, 200);

      const incidentKey = `incident:run_failed:${workspace_id}:${run_id}`;
      const incidentFound = await waitForEventByIdempotency(db, workspace_id, "incident.opened", incidentKey);
      assert.equal(incidentFound, true);

      const msgKey = `message:request_human_decision:run_failed:${workspace_id}:${run_id}`;
      const msgCount = await countEventsByIdempotency(db, workspace_id, "message.created", msgKey);
      assert.equal(msgCount, 0);
    }

    // T6 determinism: latest event ordering uses occurred_at + stream_seq.
    {
      const workspace_id = `ws_pr9_t6_${randomUUID().slice(0, 8)}`;
      const occurred_at = "2026-03-01T00:00:00.000Z";
      const entity_type = "scorecard";
      const entity_id = `sc_t5_${randomUUID().slice(0, 6)}`;
      const eventA = `evt_t5_a_${randomUUID().replaceAll("-", "")}`;
      const eventB = `evt_t5_b_${randomUUID().replaceAll("-", "")}`;
      const stream_id = workspace_id;

      await appendToStream(pool, {
        event_id: eventA,
        event_type: "message.created",
        event_version: 1,
        occurred_at,
        workspace_id,
        actor: { actor_type: "service", actor_id: "t5" },
        stream: { stream_type: "workspace", stream_id },
        correlation_id: `corr:${workspace_id}:a`,
        idempotency_key: `t5:a:${workspace_id}`,
        entity_type,
        entity_id,
        data: { message_id: "msg_t5_a", content_md: "a", sender_type: "service", sender_id: "t5", lang: "en" },
        policy_context: {},
        model_context: {},
        display: {},
      } as Parameters<typeof appendToStream>[1]);

      await appendToStream(pool, {
        event_id: eventB,
        event_type: "message.created",
        event_version: 1,
        occurred_at,
        workspace_id,
        actor: { actor_type: "service", actor_id: "t5" },
        stream: { stream_type: "workspace", stream_id },
        correlation_id: `corr:${workspace_id}:b`,
        idempotency_key: `t5:b:${workspace_id}`,
        entity_type,
        entity_id,
        data: { message_id: "msg_t5_b", content_md: "b", sender_type: "service", sender_id: "t5", lang: "en" },
        policy_context: {},
        model_context: {},
        display: {},
      } as Parameters<typeof appendToStream>[1]);

      const latest = await getLatestEvent(pool, { workspace_id, entity_type, entity_id });
      assert.ok(latest);
      assert.equal(latest?.event_id, eventB);
    }

    // T7 kill switch: no extra events.
    {
      const workspace_id = `ws_pr9_t7_${randomUUID().slice(0, 8)}`;
      process.env.PROMOTION_LOOP_ENABLED = "0";
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      await startRun(baseUrl, workspace_id, run_id);
      const failStatus = await failRun(baseUrl, workspace_id, run_id);
      assert.equal(failStatus, 200);
      const key = `incident:run_failed:${workspace_id}:${run_id}`;
      const count = await countEventsByIdempotency(db, workspace_id, "incident.opened", key);
      assert.equal(count, 0);
      process.env.PROMOTION_LOOP_ENABLED = "1";
    }

    // T8 orphan guard: PASS scorecard without run does not emit request_approval.
    {
      const workspace_id = `ws_pr9_t8_${randomUUID().slice(0, 8)}`;
      const score = await postScorecard(baseUrl, workspace_id, {
        template_key: "t7",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.95 }],
      });
      assert.equal(score.status, 201);
      await delay(120);
      const key = `message:request_approval:${workspace_id}:${score.scorecard_id}`;
      const count = await countEventsByIdempotency(db, workspace_id, "message.created", key);
      assert.equal(count, 0);
    }

    // T9 blast radius: forced automation error does not rollback core write.
    {
      const workspace_id = `ws_pr9_t9_${randomUUID().slice(0, 8)}`;
      process.env.AUTOMATION_FAIL_TEST = "1";
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      const score = await postScorecard(baseUrl, workspace_id, {
        run_id,
        template_key: "t8",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.9 }],
      });
      assert.equal(score.status, 201);

      const coreEvent = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM evt_events
         WHERE workspace_id = $1
           AND event_type = 'scorecard.recorded'
           AND data->>'scorecard_id' = $2`,
        [workspace_id, score.scorecard_id],
      );
      assert.equal(Number(coreEvent.rows[0]?.count ?? "0"), 1);
      delete process.env.AUTOMATION_FAIL_TEST;
    }

    // T10 E2E: scorecard PASS emits request_approval event.
    {
      const workspace_id = `ws_pr9_t10_${randomUUID().slice(0, 8)}`;
      const room_id = await createRoom(baseUrl, workspace_id);
      const run_id = await createRun(baseUrl, workspace_id, room_id);
      const score = await postScorecard(baseUrl, workspace_id, {
        run_id,
        template_key: "t9",
        template_version: "1.0.0",
        metrics: [{ key: "quality", value: 0.95 }],
      });
      assert.equal(score.status, 201);
      const key = `message:request_approval:${workspace_id}:${score.scorecard_id}`;
      const found = await waitForEventByIdempotency(db, workspace_id, "message.created", key, 1000);
      assert.equal(found, true);
    }
  } finally {
    process.env.PROMOTION_LOOP_ENABLED = originalEnabled;
    if (originalFailTest === undefined) {
      delete process.env.AUTOMATION_FAIL_TEST;
    } else {
      process.env.AUTOMATION_FAIL_TEST = originalFailTest;
    }
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
