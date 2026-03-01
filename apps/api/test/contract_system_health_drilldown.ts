import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { httpStatusForReasonCode } from "../src/contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

const HTTP_OK = httpStatusForReasonCode("duplicate_idempotent_replay");
const HTTP_INVALID = httpStatusForReasonCode("invalid_payload_combination");
const HTTP_UNSUPPORTED = httpStatusForReasonCode("unsupported_version");
const HTTP_MISSING_WORKSPACE = httpStatusForReasonCode("missing_workspace_header");

type DrilldownResponse = {
  schema_version: string;
  server_time: string;
  kind: string;
  applied_limit: number;
  truncated: boolean;
  next_cursor?: string;
  items: Array<{
    entity_id: string;
    updated_at: string;
    age_sec: number | null;
    details: Record<string, unknown>;
  }>;
};

type ErrorPayload = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
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
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? (JSON.parse(text) as T) : ({} as T),
    text,
  };
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

function q(value: string): string {
  return encodeURIComponent(value);
}

async function bootstrapAccessToken(
  baseUrl: string,
  bootstrapToken: string,
  workspaceId: string,
): Promise<string> {
  const res = await requestJson<{ session: { access_token: string } }>(
    baseUrl,
    "POST",
    "/v1/auth/bootstrap-owner",
    {
      workspace_id: workspaceId,
      display_name: `Health Drilldown ${workspaceId}`,
      passphrase: `pass_${workspaceId}`,
    },
    { "x-bootstrap-token": bootstrapToken },
  );
  assert.equal(res.status, 201, res.text);
  return readAccessToken(res.json);
}

async function insertDlqRows(
  db: pg.Client,
  workspaceId: string,
  count: number,
  fixedTs: string,
): Promise<void> {
  for (let idx = 0; idx < count; idx += 1) {
    await db.query(
      `INSERT INTO dead_letter_messages (
         workspace_id,
         message_id,
         created_at,
         first_failed_at,
         last_failed_at,
         failure_count,
         last_error,
         reviewed_at
       ) VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $3::timestamptz, $4, 'contract', NULL)
       ON CONFLICT (workspace_id, message_id) DO UPDATE
       SET last_failed_at = EXCLUDED.last_failed_at,
           failure_count = EXCLUDED.failure_count,
           reviewed_at = NULL`,
      [workspaceId, `msg_${idx.toString().padStart(3, "0")}`, fixedTs, 3 + idx],
    );
  }
}

async function insertProjectionFallbackRow(
  db: pg.Client,
  workspaceId: string,
  updatedAt: string,
): Promise<void> {
  const runId = `run_fb_${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO proj_runs (
       run_id,
       workspace_id,
       room_id,
       thread_id,
       status,
       title,
       goal,
       input,
       output,
       error,
       tags,
       created_at,
       started_at,
       ended_at,
       updated_at,
       correlation_id,
       last_event_id
     ) VALUES (
       $1, $2, NULL, NULL, 'queued', 'fallback', 'fallback',
       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::text[],
       $3::timestamptz, NULL, NULL, $3::timestamptz,
       $4, $5
     )
     ON CONFLICT (run_id) DO UPDATE
     SET updated_at = EXCLUDED.updated_at`,
    [runId, workspaceId, updatedAt, `corr_${runId}`, `evt_${runId}`],
  );
}

async function getIssues(
  baseUrl: string,
  workspaceId: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<{ status: number; json: DrilldownResponse | ErrorPayload; text: string }> {
  const qs = new URLSearchParams(params).toString();
  return requestJson<DrilldownResponse | ErrorPayload>(
    baseUrl,
    "GET",
    `/v1/system/health/issues?${qs}`,
    undefined,
    {
      authorization: `Bearer ${accessToken}`,
      "x-workspace-id": workspaceId,
    },
  );
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  process.env.HEALTH_CRON_CRITICAL_CHECKS = "heart_cron";

  const pool = createPool(databaseUrl);
  const bootstrapTokenHeader = `bootstrap_${randomUUID().slice(0, 12)}`;
  const app = await buildServer({
    config: {
      port: 0,
      databaseUrl,
      authRequireSession: true,
      authAllowLegacyWorkspaceHeader: false,
      authBootstrapToken: bootstrapTokenHeader,
    },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const wsMain = `ws_health_issue_${randomUUID().slice(0, 8)}`;
    const tokenMain = await bootstrapAccessToken(baseUrl, bootstrapTokenHeader, wsMain);

    // T1 route mounted
    const mounted = await getIssues(baseUrl, wsMain, tokenMain, { kind: "dlq_backlog" });
    assert.notEqual(mounted.status, 404, mounted.text);
    assert.notEqual(mounted.status, 500, mounted.text);

    // T2 invalid kind
    const invalidKind = await getIssues(baseUrl, wsMain, tokenMain, { kind: "unknown_kind" });
    assert.equal(invalidKind.status, HTTP_INVALID, invalidKind.text);
    assert.equal((invalidKind.json as ErrorPayload).reason_code, "invalid_payload_combination");

    // T3 missing workspace header
    const missingWorkspace = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      `/v1/system/health/issues?kind=dlq_backlog`,
      undefined,
      { authorization: `Bearer ${tokenMain}` },
    );
    assert.equal(missingWorkspace.status, HTTP_MISSING_WORKSPACE, missingWorkspace.text);
    assert.equal(missingWorkspace.json.reason_code, "missing_workspace_header");

    // T4 unsupported schema_version
    const unsupported = await getIssues(baseUrl, wsMain, tokenMain, {
      kind: "dlq_backlog",
      schema_version: "9.9",
    });
    assert.equal(unsupported.status, HTTP_UNSUPPORTED, unsupported.text);
    assert.equal((unsupported.json as ErrorPayload).reason_code, "unsupported_version");

    // T5 workspace isolation for DLQ
    const wsA = `ws_a_${randomUUID().slice(0, 6)}`;
    const wsB = `ws_b_${randomUUID().slice(0, 6)}`;
    const tokenA = await bootstrapAccessToken(baseUrl, bootstrapTokenHeader, wsA);
    const tokenB = await bootstrapAccessToken(baseUrl, bootstrapTokenHeader, wsB);
    await insertDlqRows(db, wsA, 3, "2026-01-02T00:00:00Z");
    await insertDlqRows(db, wsB, 1, "2026-01-02T00:00:00Z");
    const wsBView = await getIssues(baseUrl, wsB, tokenB, { kind: "dlq_backlog", limit: "10" });
    assert.equal(wsBView.status, HTTP_OK, wsBView.text);
    const wsBItems = (wsBView.json as DrilldownResponse).items;
    assert.equal(wsBItems.length, 1);
    assert.equal(wsBItems[0]?.entity_id, "msg_000");
    const wsAView = await getIssues(baseUrl, wsA, tokenA, { kind: "dlq_backlog", limit: "10" });
    assert.equal(wsAView.status, HTTP_OK, wsAView.text);
    assert.equal((wsAView.json as DrilldownResponse).items.length, 3);

    // T6 pagination tie-breaker
    const wsPag = `ws_pag_${randomUUID().slice(0, 6)}`;
    const tokenPag = await bootstrapAccessToken(baseUrl, bootstrapTokenHeader, wsPag);
    await insertDlqRows(db, wsPag, 60, "2026-01-03T00:00:00Z");
    const page1 = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "30",
    });
    assert.equal(page1.status, HTTP_OK, page1.text);
    const p1 = page1.json as DrilldownResponse;
    assert.equal(p1.items.length, 30);
    assert.equal(p1.truncated, true);
    assert.equal(typeof p1.next_cursor, "string");
    const page2 = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "30",
      cursor: p1.next_cursor as string,
    });
    assert.equal(page2.status, HTTP_OK, page2.text);
    const p2 = page2.json as DrilldownResponse;
    assert.equal(p2.items.length, 30);
    const ids = new Set([...p1.items.map((x) => x.entity_id), ...p2.items.map((x) => x.entity_id)]);
    assert.equal(ids.size, 60);

    // T7 malformed cursor
    const badCursor = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "10",
      cursor: "%%%NOT_BASE64%%%",
    });
    assert.equal(badCursor.status, HTTP_INVALID, badCursor.text);
    assert.equal((badCursor.json as ErrorPayload).reason_code, "invalid_payload_combination");

    // T7b syntactically valid cursor with non-timestamp updated_at is rejected
    const invalidTimestampCursor = Buffer.from(
      JSON.stringify({ updated_at: "not-a-date", entity_id: "msg_000" }),
      "utf8",
    ).toString("base64url");
    const badCursorTimestamp = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "10",
      cursor: invalidTimestampCursor,
    });
    assert.equal(badCursorTimestamp.status, HTTP_INVALID, badCursorTimestamp.text);
    assert.equal(
      (badCursorTimestamp.json as ErrorPayload).reason_code,
      "invalid_payload_combination",
    );

    // T8 cron global table safety
    await db.query(
      `INSERT INTO cron_health (check_name, last_success_at, last_failure_at, consecutive_failures, last_error, metadata)
       VALUES ('heart_cron', now() - interval '1000 seconds', NULL, 0, NULL, '{}'::jsonb)
       ON CONFLICT (check_name) DO UPDATE
       SET last_success_at = EXCLUDED.last_success_at`,
    );
    const cronStale = await getIssues(baseUrl, wsMain, tokenMain, { kind: "cron_stale" });
    assert.equal(cronStale.status, HTTP_OK, cronStale.text);

    // T9 K6 ignores pagination cursor/limit
    const cronWithCursor = await getIssues(baseUrl, wsMain, tokenMain, {
      kind: "cron_stale",
      limit: "1",
      cursor: "bad-cursor-that-should-be-ignored",
    });
    assert.equal(cronWithCursor.status, HTTP_OK, cronWithCursor.text);
    assert.equal((cronWithCursor.json as DrilldownResponse).truncated, false);

    // T9b projection_watermark_missing honors fallback projection watermark
    const wsFallback = `ws_fb_${randomUUID().slice(0, 6)}`;
    const tokenFallback = await bootstrapAccessToken(baseUrl, bootstrapTokenHeader, wsFallback);
    await db.query(`DELETE FROM projector_watermarks WHERE workspace_id = $1`, [wsFallback]);
    await insertProjectionFallbackRow(db, wsFallback, "2026-01-03T00:00:00Z");
    const fallbackWatermark = await getIssues(baseUrl, wsFallback, tokenFallback, {
      kind: "projection_watermark_missing",
      limit: "99",
      cursor: "ignored-for-non-paginated-kind",
    });
    assert.equal(fallbackWatermark.status, HTTP_OK, fallbackWatermark.text);
    assert.equal((fallbackWatermark.json as DrilldownResponse).items.length, 0);
    assert.equal((fallbackWatermark.json as DrilldownResponse).truncated, false);

    // T10 server_time ends with Z
    assert.ok((cronWithCursor.json as DrilldownResponse).server_time.endsWith("Z"), cronWithCursor.text);

    // T11 missing optional table graceful degrade (42P01)
    await db.query("ALTER TABLE rate_limit_streaks RENAME TO rate_limit_streaks_tmp");
    try {
      const degraded = await getIssues(baseUrl, wsMain, tokenMain, {
        kind: "rate_limit_flood",
        limit: "10",
      });
      assert.equal(degraded.status, HTTP_OK, degraded.text);
      assert.equal((degraded.json as DrilldownResponse).items.length, 0);
    } finally {
      await db.query("ALTER TABLE rate_limit_streaks_tmp RENAME TO rate_limit_streaks");
    }

    // T12 limit clamp and invalid limits
    const clamped = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "999",
    });
    assert.equal(clamped.status, HTTP_OK, clamped.text);
    assert.ok((clamped.json as DrilldownResponse).applied_limit <= 100, clamped.text);

    const invalidZero = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "0",
    });
    assert.equal(invalidZero.status, HTTP_INVALID, invalidZero.text);
    assert.equal((invalidZero.json as ErrorPayload).reason_code, "invalid_payload_combination");

    const invalidNaN = await getIssues(baseUrl, wsPag, tokenPag, {
      kind: "dlq_backlog",
      limit: "NaN",
    });
    assert.equal(invalidNaN.status, HTTP_INVALID, invalidNaN.text);
    assert.equal((invalidNaN.json as ErrorPayload).reason_code, "invalid_payload_combination");

    assert.equal(HTTP_OK, httpStatusForReasonCode("duplicate_idempotent_replay"));
    assert.equal(HTTP_INVALID, httpStatusForReasonCode("invalid_payload_combination"));
    assert.equal(HTTP_UNSUPPORTED, httpStatusForReasonCode("unsupported_version"));
    assert.equal(HTTP_MISSING_WORKSPACE, httpStatusForReasonCode("missing_workspace_header"));
  } finally {
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
