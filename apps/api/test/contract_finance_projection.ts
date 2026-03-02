import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  httpStatusForReasonCode,
} from "../src/contracts/pipeline_v2_contract.js";
import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { clearFinanceCache } from "../src/routes/v1/finance.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

const HTTP_OK = httpStatusForReasonCode("duplicate_idempotent_replay");
const HTTP_MISSING_WORKSPACE = httpStatusForReasonCode("missing_workspace_header");
const HTTP_UNSUPPORTED_VERSION = httpStatusForReasonCode("unsupported_version");
const HTTP_INVALID_PAYLOAD = httpStatusForReasonCode("invalid_payload_combination");

type FinanceProjectionResponse = {
  schema_version: string;
  server_time: string;
  meta: {
    applied_days_back: number;
    source: "proj_finance_daily" | "sec_survival_ledger_daily" | "none";
    cached: boolean;
    cache_age_ms: number | null;
  };
  totals: null | {
    estimated_cost_units: string | null;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
  };
  series_daily: Array<{
    day_utc: string;
    estimated_cost_units: string;
    prompt_tokens: string | null;
    completion_tokens: string | null;
    total_tokens: string | null;
  }>;
  warnings: string[];
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
    throw new Error("DATABASE_URL does not look like local/test DB");
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

async function upsertWorkspaceFinanceDaily(
  client: pg.Client,
  workspace_id: string,
  snapshotOffsetDays: number,
  estimatedCostUnits: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sec_survival_ledger_daily (
       workspace_id,
       target_type,
       target_id,
       snapshot_date,
       estimated_cost_units,
       value_units,
       budget_cap_units
     ) VALUES (
       $1,
       'workspace',
       $1,
       (now() AT TIME ZONE 'UTC')::date + $2::int,
       $3::double precision,
       0,
       100
     )
     ON CONFLICT (workspace_id, target_type, target_id, snapshot_date)
     DO UPDATE SET
       estimated_cost_units = EXCLUDED.estimated_cost_units,
       updated_at = now()`,
    [workspace_id, snapshotOffsetDays, estimatedCostUnits],
  );
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  process.env.NODE_ENV = "test";
  clearFinanceCache();

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
    const workspaceA = `ws_finance_a_${randomUUID().slice(0, 6)}`;
    const workspaceB = `ws_finance_b_${randomUUID().slice(0, 6)}`;

    const bootstrapA = await postJson<{ session: { access_token: string } }>(
      baseUrl,
      "/v1/auth/bootstrap-owner",
      {
        workspace_id: workspaceA,
        display_name: "Finance Contract A",
        passphrase: `pass_${workspaceA}`,
      },
      { "x-bootstrap-token": bootstrapToken },
    );
    assert.equal(bootstrapA.status, 201, bootstrapA.text);
    const tokenA = readAccessToken(bootstrapA.json);

    const bootstrapB = await postJson<{ session: { access_token: string } }>(
      baseUrl,
      "/v1/auth/bootstrap-owner",
      {
        workspace_id: workspaceB,
        display_name: "Finance Contract B",
        passphrase: `pass_${workspaceB}`,
      },
      { "x-bootstrap-token": bootstrapToken },
    );
    assert.equal(bootstrapB.status, 201, bootstrapB.text);
    const tokenB = readAccessToken(bootstrapB.json);

    const requestProjection = async (
      workspaceId: string,
      token: string,
      body: unknown,
    ): Promise<{ status: number; json: FinanceProjectionResponse; text: string }> =>
      postJson<FinanceProjectionResponse>(baseUrl, "/v1/finance/projection", body, {
        authorization: `Bearer ${token}`,
        "x-workspace-id": workspaceId,
      });

    // T1 route mounted
    clearFinanceCache();
    const t1 = await requestProjection(workspaceA, tokenA, { schema_version: SCHEMA_VERSION });
    assert.notEqual(t1.status, 404, t1.text);

    // T2 missing x-workspace-id
    clearFinanceCache();
    const t2 = await postJson<ErrorPayload>(
      baseUrl,
      "/v1/finance/projection",
      { schema_version: SCHEMA_VERSION },
      { authorization: `Bearer ${tokenA}` },
    );
    assert.equal(t2.status, HTTP_MISSING_WORKSPACE, t2.text);
    assert.equal(t2.json.reason_code, "missing_workspace_header");

    // T3 unsupported schema_version
    clearFinanceCache();
    const t3 = await requestProjection(workspaceA, tokenA, { schema_version: "9.9" });
    assert.equal(t3.status, HTTP_UNSUPPORTED_VERSION, t3.text);

    // T4 days_back validation/clamp
    clearFinanceCache();
    const t4InvalidString = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: "x",
    });
    assert.equal(t4InvalidString.status, HTTP_INVALID_PAYLOAD, t4InvalidString.text);

    clearFinanceCache();
    const t4InvalidFloat = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: 1.5,
    });
    assert.equal(t4InvalidFloat.status, HTTP_INVALID_PAYLOAD, t4InvalidFloat.text);

    clearFinanceCache();
    const t4ClampLow = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: 0,
    });
    assert.equal(t4ClampLow.status, HTTP_OK, t4ClampLow.text);
    assert.equal(t4ClampLow.json.meta.applied_days_back, 1);

    clearFinanceCache();
    const t4ClampNegative = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: -5,
    });
    assert.equal(t4ClampNegative.status, HTTP_OK, t4ClampNegative.text);
    assert.equal(t4ClampNegative.json.meta.applied_days_back, 1);

    clearFinanceCache();
    const t4ClampHigh = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: 999,
    });
    assert.equal(t4ClampHigh.status, HTTP_OK, t4ClampHigh.text);
    assert.equal(t4ClampHigh.json.meta.applied_days_back, 365);

    clearFinanceCache();
    const sourceProbe = await requestProjection(workspaceA, tokenA, {
      schema_version: SCHEMA_VERSION,
      days_back: 1,
    });
    assert.equal(sourceProbe.status, HTTP_OK, sourceProbe.text);
    const effectiveSource = sourceProbe.json.meta.source;
    const sourcePresenceRes = await db.query<{ has_a: boolean; has_b: boolean }>(
      `SELECT
         to_regclass('public.proj_finance_daily') IS NOT NULL AS has_a,
         to_regclass('public.sec_survival_ledger_daily') IS NOT NULL AS has_b`,
    );
    const hasSourceA = sourcePresenceRes.rows[0]?.has_a === true;
    const hasSourceB = sourcePresenceRes.rows[0]?.has_b === true;
    if (!hasSourceA && hasSourceB) {
      assert.equal(
        effectiveSource,
        "sec_survival_ledger_daily",
        "must fallback to sec_survival_ledger_daily when proj_finance_daily is unavailable",
      );
    }
    if (hasSourceA && hasSourceB) {
      // Regression guard: source A table may exist but be empty before projector wiring/backfill.
      // In that case route must fallback to source B instead of returning zero-filled A rows.
      clearFinanceCache();
      await db.query(`DELETE FROM public.proj_finance_daily WHERE workspace_id = $1`, [workspaceA]);
      await db.query(
        `DELETE FROM sec_survival_ledger_daily
         WHERE workspace_id = ANY($1::text[])
           AND target_type = 'workspace'`,
        [[workspaceA, workspaceB]],
      );
      await upsertWorkspaceFinanceDaily(db, workspaceA, -1, 42.5);
      await upsertWorkspaceFinanceDaily(db, workspaceB, -1, 999);

      const fallbackAEmpty = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 7,
      });
      assert.equal(fallbackAEmpty.status, HTTP_OK, fallbackAEmpty.text);
      assert.equal(
        fallbackAEmpty.json.meta.source,
        "sec_survival_ledger_daily",
        "must fallback to survival source when proj_finance_daily has no rows in range",
      );
      assert.equal(
        fallbackAEmpty.json.totals?.estimated_cost_units,
        "42.5",
        "fallback totals must reflect workspace-scoped survival data",
      );
    }

    if (effectiveSource === "sec_survival_ledger_daily") {
      // T5 source-backed gap-fill and totals (workspace isolation)
      clearFinanceCache();
      await db.query(
        `DELETE FROM sec_survival_ledger_daily
         WHERE workspace_id = ANY($1::text[])
           AND target_type = 'workspace'`,
        [[workspaceA, workspaceB]],
      );

      await upsertWorkspaceFinanceDaily(db, workspaceA, -6, 10);
      await upsertWorkspaceFinanceDaily(db, workspaceA, -4, 20);
      await upsertWorkspaceFinanceDaily(db, workspaceA, -2, 0.5);
      await upsertWorkspaceFinanceDaily(db, workspaceA, -1, 30);
      await upsertWorkspaceFinanceDaily(db, workspaceB, -1, 999);

      const t5 = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 7,
      });
      assert.equal(t5.status, HTTP_OK, t5.text);
      assert.equal(t5.json.schema_version, SCHEMA_VERSION);
      assert.ok(t5.json.server_time.endsWith("Z"), t5.text);
      assert.equal(t5.json.meta.applied_days_back, 7);
      assert.equal(t5.json.meta.source, "sec_survival_ledger_daily");
      assert.equal(t5.json.series_daily.length, 7);
      assert.equal(t5.json.warnings.length, 0);
      assert.ok(
        t5.json.series_daily.every((row) => typeof row.day_utc === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day_utc)),
        "all day_utc values must be YYYY-MM-DD",
      );
      assert.ok(
        t5.json.series_daily.every((row) => typeof row.estimated_cost_units === "string"),
        "all estimated_cost_units values must be string",
      );
      assert.ok(
        t5.json.series_daily.some((row) => row.estimated_cost_units === "0"),
        "gap-filled days must be represented as string zero",
      );
      assert.ok(t5.json.totals, "totals must be present when source table exists");
      assert.equal(typeof t5.json.totals?.estimated_cost_units, "string");
      assert.equal(
        t5.json.totals?.estimated_cost_units,
        "60.5",
        "workspace_B rows must not leak and fractional units must be preserved",
      );
      assert.ok(
        t5.json.series_daily.some((row) => row.estimated_cost_units === "0.5"),
        "fractional daily units must be preserved in series output",
      );
    } else if (effectiveSource === "proj_finance_daily") {
      clearFinanceCache();
      const t5 = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 7,
      });
      assert.equal(t5.status, HTTP_OK, t5.text);
      assert.equal(t5.json.meta.applied_days_back, 7);
      assert.equal(t5.json.meta.source, "proj_finance_daily");
      assert.equal(t5.json.series_daily.length, 7);
      assert.ok(t5.json.totals, "totals must be present when proj_finance_daily is used");
      assert.equal(typeof t5.json.totals?.estimated_cost_units, "string");
      assert.equal(typeof t5.json.totals?.prompt_tokens, "string");
      assert.equal(typeof t5.json.totals?.completion_tokens, "string");
      assert.equal(typeof t5.json.totals?.total_tokens, "string");
      assert.ok(
        t5.json.series_daily.every((row) => typeof row.estimated_cost_units === "string"),
        "daily rows must expose string metrics",
      );
    } else {
      // T6 source missing fallback (Option C)
      clearFinanceCache();
      const t6 = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 7,
      });
      assert.equal(t6.status, HTTP_OK, t6.text);
      assert.equal(t6.json.meta.source, "none");
      assert.equal(t6.json.totals, null);
      assert.deepEqual(t6.json.series_daily, []);
      assert.ok(
        t6.json.warnings.includes("finance_source_not_found") ||
          t6.json.warnings.includes("finance_db_error"),
        "source none path must provide a finance warning",
      );
    }

    // T7 cache hygiene: NODE_ENV=test must not retain stale metrics.
    clearFinanceCache();
    if (effectiveSource === "sec_survival_ledger_daily") {
      await upsertWorkspaceFinanceDaily(db, workspaceA, 0, 5);
      const first = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 1,
      });
      assert.equal(first.status, HTTP_OK, first.text);
      assert.equal(first.json.totals?.estimated_cost_units, "5");

      await upsertWorkspaceFinanceDaily(db, workspaceA, 0, 15);
      const second = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 1,
      });
      assert.equal(second.status, HTTP_OK, second.text);
      assert.equal(second.json.totals?.estimated_cost_units, "15");
      assert.equal(second.json.meta.cached, false);
    } else {
      const first = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 1,
      });
      const second = await requestProjection(workspaceA, tokenA, {
        schema_version: SCHEMA_VERSION,
        days_back: 1,
      });
      assert.equal(first.status, HTTP_OK, first.text);
      assert.equal(second.status, HTTP_OK, second.text);
      assert.equal(second.json.meta.cached, false);
    }

    // Additional isolation sanity check across auth tokens.
    clearFinanceCache();
    const wsBCall = await requestProjection(workspaceB, tokenB, {
      schema_version: SCHEMA_VERSION,
      days_back: 1,
    });
    assert.equal(wsBCall.status, HTTP_OK, wsBCall.text);
  } finally {
    clearFinanceCache();
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
