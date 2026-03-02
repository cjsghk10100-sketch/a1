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
const HTTP_MISSING_WORKSPACE = httpStatusForReasonCode("missing_workspace_header");
const HTTP_UNSUPPORTED = httpStatusForReasonCode("unsupported_version");
const HTTP_INVALID = httpStatusForReasonCode("invalid_payload_combination");
const HTTP_UNAUTHORIZED_WORKSPACE = httpStatusForReasonCode("unauthorized_workspace");

type MonitorResponse = {
  schema_version: string;
  workspace_id: string;
  monitor: "otonix";
  read_only: boolean;
  action: string;
  allowed_actions: string[];
  target: string;
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
    json: (text ? JSON.parse(text) : {}) as T,
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

async function workspaceEventCount(db: pg.Client, workspaceId: string): Promise<number> {
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM evt_events
     WHERE workspace_id = $1`,
    [workspaceId],
  );
  return Number.parseInt(res.rows[0]?.count ?? "0", 10);
}

function monitorQuery(action: string, schemaVersion?: string): string {
  const params = new URLSearchParams();
  params.set("action", action);
  if (schemaVersion !== undefined) {
    params.set("schema_version", schemaVersion);
  }
  return `/monitor/otonix?${params.toString()}`;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

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
    throw new Error("expected TCP server address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const workspaceId = `ws_monitor_otonix_${randomUUID().slice(0, 8)}`;
  const otherWorkspaceId = `ws_monitor_other_${randomUUID().slice(0, 8)}`;

  const bootstrap = await requestJson<{ session: { access_token: string } }>(
    baseUrl,
    "POST",
    "/v1/auth/bootstrap-owner",
    {
      workspace_id: workspaceId,
      display_name: `Monitor Otonix ${workspaceId}`,
      passphrase: `pass_${workspaceId}`,
    },
    { "x-bootstrap-token": bootstrapToken },
  );
  assert.equal(bootstrap.status, 201, bootstrap.text);
  const accessToken = readAccessToken(bootstrap.json);

  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    "x-workspace-id": workspaceId,
  };

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // T1: route mounted + allowlisted action succeeds.
    const t1 = await requestJson<MonitorResponse>(
      baseUrl,
      "GET",
      monitorQuery("health_summary", SCHEMA_VERSION),
      undefined,
      authHeaders,
    );
    assert.notEqual(t1.status, 404, t1.text);
    assert.equal(t1.status, HTTP_OK, t1.text);
    assert.equal(t1.json.monitor, "otonix");
    assert.equal(t1.json.read_only, true);
    assert.equal(t1.json.action, "health_summary");
    assert.equal(t1.json.schema_version, SCHEMA_VERSION);

    // T2: missing workspace header.
    const t2 = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      monitorQuery("health_summary", SCHEMA_VERSION),
      undefined,
      { authorization: `Bearer ${accessToken}` },
    );
    assert.equal(t2.status, HTTP_MISSING_WORKSPACE, t2.text);
    assert.equal(t2.json.reason_code, "missing_workspace_header");

    // T3: unsupported schema version.
    const t3 = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      monitorQuery("health_summary", "9.9"),
      undefined,
      authHeaders,
    );
    assert.equal(t3.status, HTTP_UNSUPPORTED, t3.text);
    assert.equal(t3.json.reason_code, "unsupported_version");

    // T4: hard workspace mismatch block.
    const t4 = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      monitorQuery("health_summary", SCHEMA_VERSION),
      undefined,
      {
        authorization: `Bearer ${accessToken}`,
        "x-workspace-id": otherWorkspaceId,
      },
    );
    assert.equal(t4.status, HTTP_UNAUTHORIZED_WORKSPACE, t4.text);
    assert.equal(t4.json.reason_code, "unauthorized_workspace");

    // T5: write-like action must be blocked.
    const t5 = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      monitorQuery("write_secret", SCHEMA_VERSION),
      undefined,
      authHeaders,
    );
    assert.equal(t5.status, HTTP_INVALID, t5.text);
    assert.equal(t5.json.reason_code, "invalid_payload_combination");
    assert.equal(t5.json.details.write_action_blocked, true);

    // T6: non-allowlisted read action also blocked.
    const t6 = await requestJson<ErrorPayload>(
      baseUrl,
      "GET",
      monitorQuery("room_list", SCHEMA_VERSION),
      undefined,
      authHeaders,
    );
    assert.equal(t6.status, HTTP_INVALID, t6.text);
    assert.equal(t6.json.reason_code, "invalid_payload_combination");

    // T7: read-only guarantee (no evt_events side effects).
    const before = await workspaceEventCount(db, workspaceId);
    const t7a = await requestJson<MonitorResponse>(
      baseUrl,
      "GET",
      monitorQuery("health_issues", SCHEMA_VERSION),
      undefined,
      authHeaders,
    );
    assert.equal(t7a.status, HTTP_OK, t7a.text);
    const t7b = await requestJson<MonitorResponse>(
      baseUrl,
      "GET",
      monitorQuery("finance_projection", SCHEMA_VERSION),
      undefined,
      authHeaders,
    );
    assert.equal(t7b.status, HTTP_OK, t7b.text);
    const after = await workspaceEventCount(db, workspaceId);
    assert.equal(after, before, "monitor/otonix must be read-only and append zero events");
  } finally {
    await db.end();
    await app.close();
  }

  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

