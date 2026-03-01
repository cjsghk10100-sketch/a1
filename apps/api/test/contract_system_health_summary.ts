import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

import { httpStatusForReasonCode } from "../src/contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

const HTTP_OK = httpStatusForReasonCode("duplicate_idempotent_replay");

type TopIssue = {
  kind: string;
  severity: "DOWN" | "DEGRADED";
  age_sec: number | null;
};

type SystemHealthSummaryResponse = {
  schema_version: string;
  server_time: string | null;
  ok: boolean;
  workspace_id: string;
  checks: {
    db: { ok: boolean };
    kernel_schema_versions: {
      ok: boolean;
      has_rows: boolean;
      current_version: string | null;
    };
    evt_events: {
      ok: boolean;
      required_columns_present: boolean;
      missing_columns: string[];
    };
    evt_events_idempotency: {
      ok: boolean;
      index_name: string;
    };
    optional: Record<string, { supported: boolean; ok: boolean; details: Record<string, unknown> }>;
  };
  summary: {
    health_summary: "OK" | "DEGRADED" | "DOWN";
    cron_freshness_sec: number | null;
    projection_lag_sec: number | null;
    dlq_backlog_count: number;
    rate_limit_flood_detected: boolean;
    active_incidents_count: number;
    top_issues: TopIssue[];
  };
  meta: {
    cached: boolean;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertContractDbUrl(databaseUrl: string): void {
  if (
    !databaseUrl.includes("test") &&
    !databaseUrl.includes("local") &&
    !databaseUrl.includes("127.0.0.1") &&
    !databaseUrl.includes("localhost")
  ) {
    throw new Error("DATABASE_URL does not look like test/local DB");
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
  method: "POST",
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as T,
    text,
  };
}

async function postSystemHealth(
  baseUrl: string,
  workspace_id: string,
  authToken: string,
  bodyWorkspaceId?: string,
): Promise<{ status: number; json: SystemHealthSummaryResponse; text: string }> {
  return await requestJson<SystemHealthSummaryResponse>(
    baseUrl,
    "POST",
    "/v1/system/health",
    {
      schema_version: SCHEMA_VERSION,
      ...(bodyWorkspaceId ? { workspace_id: bodyWorkspaceId } : {}),
    },
    {
      authorization: `Bearer ${authToken}`,
      "x-workspace-id": workspace_id,
    },
  );
}

function readAccessToken(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("invalid_bootstrap_payload");
  const session = (payload as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_session_payload");
  const accessToken = (session as { access_token?: unknown }).access_token;
  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new Error("missing_access_token");
  }
  return accessToken;
}

async function insertWorkspaceEvent(db: pg.Client, workspaceId: string): Promise<void> {
  const streamId = `ws_stream_${workspaceId}`;
  const streamSeqRes = await db.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX(stream_seq), 0)::int + 1 AS next_seq
     FROM evt_events
     WHERE stream_type = 'workspace'
       AND stream_id = $1`,
    [streamId],
  );
  const nextSeq = streamSeqRes.rows[0]?.next_seq ?? 1;
  await db.query(
    `INSERT INTO evt_events (
       event_id,
       event_type,
       event_version,
       occurred_at,
       workspace_id,
       actor_type,
       actor_id,
       stream_type,
       stream_id,
       stream_seq,
       correlation_id,
       data,
       idempotency_key,
       entity_type,
       entity_id,
       actor
     ) VALUES (
       $1, 'contract.health.seeded', 1, now(),
       $2, 'service', 'contract-system-health',
       'workspace', $3, $4,
       $6,
       '{}'::jsonb,
       $5,
       'workspace',
       $2,
       'contract-system-health'
     )`,
    [
      `evt_${randomUUID().replace(/-/g, "").slice(0, 26)}`,
      workspaceId,
      streamId,
      nextSeq,
      `health_seed:${workspaceId}:${nextSeq}`,
      `corr_health_seed:${workspaceId}:${nextSeq}`,
    ],
  );
}

function issueSeverityRank(severity: "DOWN" | "DEGRADED"): number {
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

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  process.env.HEALTH_DOWN_CRON_FRESHNESS_SEC = "600";
  process.env.HEALTH_DOWN_PROJECTION_LAG_SEC = "300";
  process.env.HEALTH_DEGRADED_DLQ_BACKLOG = "10";
  process.env.HEALTH_CACHE_TTL_SEC = "15";
  process.env.HEALTH_ERROR_CACHE_TTL_SEC = "5";
  process.env.HEALTH_DB_STATEMENT_TIMEOUT_MS = "2000";
  process.env.HEALTH_CRON_CRITICAL_CHECKS = "heart_cron,heart_cron_aux";

  const pool = createPool(databaseUrl);
  const bootstrapToken = `bootstrap_${randomUUID().slice(0, 12)}`;
  const app = await buildServer({
    config: {
      port: 0,
      databaseUrl,
      authRequireSession: true,
      authAllowLegacyWorkspaceHeader: false,
      authBootstrapToken: bootstrapToken,
    },
    pool,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const accessTokenByWorkspace = new Map<string, string>();
    const ensureAccessToken = async (workspaceId: string): Promise<string> => {
      const existing = accessTokenByWorkspace.get(workspaceId);
      if (existing) return existing;
      const bootstrapped = await requestJson<{ session: { access_token: string } }>(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceId,
          display_name: `Owner ${workspaceId}`,
          passphrase: `pass_${workspaceId}`,
        },
        { "x-bootstrap-token": bootstrapToken },
      );
      assert.equal(bootstrapped.status, 201, bootstrapped.text);
      const token = readAccessToken(bootstrapped.json);
      accessTokenByWorkspace.set(workspaceId, token);
      return token;
    };

    // T1 route exists and is executable
    const wsT1 = `ws_health_t1_${randomUUID().slice(0, 6)}`;
    const t1 = await postSystemHealth(baseUrl, wsT1, await ensureAccessToken(wsT1));
    assert.notEqual(t1.status, 404, t1.text);
    assert.notEqual(t1.status, 500, t1.text);
    assert.equal(t1.status, HTTP_OK, t1.text);

    // T2 backward compatibility subset
    assert.equal(t1.json.schema_version, SCHEMA_VERSION);
    assert.equal(t1.json.ok, true);
    assert.equal(t1.json.workspace_id, wsT1);
    assert.equal(t1.json.checks.db.ok, true);
    assert.equal(typeof t1.json.checks.kernel_schema_versions.has_rows, "boolean");
    assert.equal(typeof t1.json.checks.evt_events.required_columns_present, "boolean");
    assert.equal(t1.json.checks.evt_events_idempotency.index_name, "uidx_evt_events_idempotency_key");
    assert.equal(typeof t1.json.checks.optional.cron_watchdog.supported, "boolean");
    assert.equal(typeof t1.json.checks.optional.projection_lag.supported, "boolean");
    assert.equal(typeof t1.json.checks.optional.dlq_backlog.supported, "boolean");
    assert.equal(typeof t1.json.checks.optional.rate_limit_flood.supported, "boolean");

    // Seed stale cron freshness globally.
    await db.query(
      `INSERT INTO cron_health (
         check_name,
         last_success_at,
         last_failure_at,
         consecutive_failures,
         last_error,
         metadata
       ) VALUES (
         'heart_cron',
         now() - interval '1000 seconds',
         NULL,
         0,
         NULL,
         '{}'::jsonb
       )
       ON CONFLICT (check_name) DO UPDATE SET
         last_success_at = EXCLUDED.last_success_at,
         consecutive_failures = 0,
         last_error = NULL,
         metadata = '{}'::jsonb`,
    );
    await db.query(
      `INSERT INTO cron_health (
         check_name,
         last_success_at,
         last_failure_at,
         consecutive_failures,
         last_error,
         metadata
       ) VALUES (
         'heart_cron_aux',
         now() - interval '10 seconds',
         NULL,
         0,
         NULL,
         '{}'::jsonb
       )
       ON CONFLICT (check_name) DO UPDATE SET
         last_success_at = EXCLUDED.last_success_at,
         consecutive_failures = 0,
         last_error = NULL,
         metadata = '{}'::jsonb`,
    );

    // T3 DOWN when watermark missing while events exist.
    const wsT3 = `ws_health_t3_${randomUUID().slice(0, 6)}`;
    await insertWorkspaceEvent(db, wsT3); // ensures events exist
    await db.query(
      `DELETE FROM projector_watermarks
       WHERE workspace_id = $1`,
      [wsT3],
    );
    const t3 = await postSystemHealth(baseUrl, wsT3, await ensureAccessToken(wsT3));
    assert.equal(t3.status, HTTP_OK, t3.text);
    assert.equal(t3.json.summary.health_summary, "DOWN");
    assert.ok((t3.json.summary.cron_freshness_sec ?? 0) > 900);
    const t3IssueKinds = new Set(t3.json.summary.top_issues.map((issue) => issue.kind));
    assert.equal(t3IssueKinds.has("projection_watermark_missing"), true);

    // T4 workspace isolation for workspace-scoped metrics.
    const wsA = `ws_health_a_${randomUUID().slice(0, 6)}`;
    const wsB = `ws_health_b_${randomUUID().slice(0, 6)}`;
    await db.query(
      `INSERT INTO dead_letter_messages (
         workspace_id,
         message_id,
         first_failed_at,
         last_failed_at,
         failure_count,
         last_error,
         reviewed_at
       ) VALUES
         ($1, $2, now() - interval '30 seconds', now() - interval '10 seconds', 3, 'x', NULL),
         ($1, $3, now() - interval '35 seconds', now() - interval '15 seconds', 4, 'y', NULL)
       ON CONFLICT (workspace_id, message_id) DO NOTHING`,
      [wsA, `msg_${randomUUID().slice(0, 8)}`, `msg_${randomUUID().slice(0, 8)}`],
    );
    const wsAResp = await postSystemHealth(baseUrl, wsA, await ensureAccessToken(wsA));
    const wsBResp = await postSystemHealth(baseUrl, wsB, await ensureAccessToken(wsB));
    assert.equal(wsAResp.status, HTTP_OK, wsAResp.text);
    assert.equal(wsBResp.status, HTTP_OK, wsBResp.text);
    assert.ok(wsAResp.json.summary.dlq_backlog_count >= 2);
    assert.equal(wsBResp.json.summary.dlq_backlog_count, 0);

    // T5 deterministic top_issues ordering.
    const wsT5 = `ws_health_t5_${randomUUID().slice(0, 6)}`;
    await insertWorkspaceEvent(db, wsT5);
    await db.query(
      `DELETE FROM projector_watermarks WHERE workspace_id = $1`,
      [wsT5],
    );
    const dlqValues: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      dlqValues.push(`($1, $${i + 2}, now() - interval '90 seconds', now() - interval '30 seconds', 3, 'z', NULL)`);
    }
    await db.query(
      `INSERT INTO dead_letter_messages (
         workspace_id,
         message_id,
         first_failed_at,
         last_failed_at,
         failure_count,
         last_error,
         reviewed_at
       ) VALUES ${dlqValues.join(",")}
       ON CONFLICT (workspace_id, message_id) DO NOTHING`,
      [wsT5, ...Array.from({ length: 12 }, () => `msg_${randomUUID().slice(0, 10)}`)],
    );

    await db.query(
      `INSERT INTO proj_incidents (
         incident_id,
         workspace_id,
         room_id,
         thread_id,
         run_id,
         status,
         title,
         summary,
         severity,
         rca,
         rca_updated_at,
         learning_count,
         closed_reason,
         created_by_type,
         created_by_id,
         created_at,
         closed_at,
         updated_at,
         correlation_id,
         last_event_id
       ) VALUES (
         $1, $2, NULL, NULL, NULL, 'open',
         'ops incident', NULL, 'high',
         '{}'::jsonb, NULL, 0, NULL,
         'service', 'contract-system-health',
         now() - interval '120 seconds',
         NULL,
         now() - interval '60 seconds',
         $3, NULL
       )
       ON CONFLICT (incident_id) DO NOTHING`,
      [`inc_${randomUUID().slice(0, 12)}`, wsT5, `corr_${randomUUID().slice(0, 8)}`],
    );

    const t5 = await postSystemHealth(baseUrl, wsT5, await ensureAccessToken(wsT5));
    assert.equal(t5.status, HTTP_OK, t5.text);
    assert.ok(t5.json.summary.top_issues.length >= 2);
    const sortedTopIssues = [...t5.json.summary.top_issues].sort(compareTopIssues);
    assert.deepEqual(t5.json.summary.top_issues, sortedTopIssues);

    // T6 cache sanity: second call cached=true, server_time remains live.
    const wsT6 = `ws_health_t6_${randomUUID().slice(0, 6)}`;
    const t6a = await postSystemHealth(baseUrl, wsT6, await ensureAccessToken(wsT6));
    assert.equal(t6a.status, HTTP_OK, t6a.text);
    assert.equal(t6a.json.meta.cached, false);
    await delay(20);
    const t6b = await postSystemHealth(baseUrl, wsT6, await ensureAccessToken(wsT6));
    assert.equal(t6b.status, HTTP_OK, t6b.text);
    assert.equal(t6b.json.meta.cached, true);
    assert.notEqual(t6a.json.server_time, t6b.json.server_time);
  } finally {
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
