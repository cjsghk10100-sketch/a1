import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  httpStatusForReasonCode,
} from "../src/contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

const HTTP_OK = httpStatusForReasonCode("duplicate_idempotent_replay");
const HTTP_MISSING_WORKSPACE = httpStatusForReasonCode("missing_workspace_header");
const HTTP_UNSUPPORTED_VERSION = httpStatusForReasonCode("unsupported_version");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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
    const appliedSet = new Set(applied.rows.map((row) => row.version));

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

async function getJson<T>(
  baseUrl: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers: {
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? (JSON.parse(text) as T) : ({} as T),
    text,
  };
}

async function postJson<T>(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? (JSON.parse(text) as T) : ({} as T),
    text,
  };
}

type HealthInfraResponse = {
  ok: boolean;
  ts: string | null;
};

type SystemHealthSuccess = {
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
};

type ErrorPayload = {
  error: true;
  reason_code: string;
  reason: string;
  details: Record<string, unknown>;
};

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: { port: 0, databaseUrl },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected server to listen on a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // T1
    const infra = await getJson<HealthInfraResponse>(baseUrl, "/health");
    assert.equal(infra.status, HTTP_OK, infra.text);
    assert.equal(infra.json.ok, true, infra.text);
    assert.equal(typeof infra.json.ts, "string", infra.text);
    assert.ok((infra.json.ts ?? "").includes("T"), infra.text);

    // T2
    const missingWorkspace = await postJson<ErrorPayload>(
      baseUrl,
      "/v1/system/health",
      { schema_version: SCHEMA_VERSION },
    );
    assert.equal(missingWorkspace.status, HTTP_MISSING_WORKSPACE, missingWorkspace.text);
    assert.equal(missingWorkspace.json.reason_code, "missing_workspace_header");

    // T3
    const unsupported = await postJson<ErrorPayload>(
      baseUrl,
      "/v1/system/health",
      { schema_version: "9.9" },
      { "x-workspace-id": "ws_system_health_contract" },
    );
    assert.equal(unsupported.status, HTTP_UNSUPPORTED_VERSION, unsupported.text);
    assert.equal(unsupported.json.reason_code, "unsupported_version");

    // T4
    const happy = await postJson<SystemHealthSuccess>(
      baseUrl,
      "/v1/system/health",
      { schema_version: SCHEMA_VERSION },
      { "x-workspace-id": "ws_system_health_contract" },
    );
    assert.equal(happy.status, HTTP_OK, happy.text);
    assert.equal(happy.json.schema_version, SCHEMA_VERSION);
    assert.equal(happy.json.ok, true);
    assert.equal(happy.json.workspace_id, "ws_system_health_contract");
    assert.equal(typeof happy.json.server_time, "string");

    assert.equal(happy.json.checks.db.ok, true);
    assert.equal(typeof happy.json.checks.kernel_schema_versions.ok, "boolean");
    assert.equal(typeof happy.json.checks.evt_events.ok, "boolean");
    assert.equal(typeof happy.json.checks.evt_events_idempotency.ok, "boolean");

    const optionalKeys = Object.keys(happy.json.checks.optional).sort();
    assert.deepEqual(optionalKeys, [
      "cron_watchdog",
      "dlq_backlog",
      "projection_lag",
      "rate_limit_flood",
    ]);

    for (const key of optionalKeys) {
      const value = happy.json.checks.optional[key];
      assert.equal(typeof value.supported, "boolean", `${key}.supported must be boolean`);
      assert.equal(typeof value.ok, "boolean", `${key}.ok must be boolean`);
    }

    // T5
    assert.equal(HTTP_OK, httpStatusForReasonCode("duplicate_idempotent_replay"));
    assert.equal(HTTP_MISSING_WORKSPACE, httpStatusForReasonCode("missing_workspace_header"));
    assert.equal(HTTP_UNSUPPORTED_VERSION, httpStatusForReasonCode("unsupported_version"));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
