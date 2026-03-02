import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { EventEnvelopeV1, FinanceUsageRecordedDataV1 } from "@agentapp/shared";
import pg from "pg";

import { SCHEMA_VERSION } from "../src/contracts/schemaVersion.js";
import { createPool } from "../src/db/pool.js";
import { appendToStream } from "../src/eventStore/index.js";
import {
  FINANCE_PROJECTOR_NAME,
  applyFinanceEvent,
} from "../src/projectors/financeProjector.js";
import { clearFinanceCache } from "../src/routes/v1/finance.js";
import { EXPECTED_PROJECTORS } from "../src/routes/v1/system-health.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type PersistedFinanceEvent = EventEnvelopeV1<
  "finance.usage_recorded",
  FinanceUsageRecordedDataV1
> & {
  entity_type: "finance";
  entity_id: string;
};

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
  method: "POST" | "GET",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
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
    json: text ? (JSON.parse(text) as T) : ({} as T),
    text,
  };
}

async function dbTimes(client: pg.Client): Promise<{
  minus_two_days: string;
  minus_one_day: string;
  now_utc: string;
  plus_48_hours: string;
}> {
  const res = await client.query<{
    minus_two_days: string;
    minus_one_day: string;
    now_utc: string;
    plus_48_hours: string;
  }>(
    `SELECT
       (now() - interval '2 days')::text AS minus_two_days,
       (now() - interval '1 day')::text AS minus_one_day,
       now()::text AS now_utc,
       (now() + interval '48 hours')::text AS plus_48_hours`,
  );
  return res.rows[0]!;
}

function financeEnvelope(params: {
  workspace_id: string;
  usage_id: string;
  occurred_at: string;
  cost_usd_micros: string | number;
  prompt_tokens: string | number;
  completion_tokens: string | number;
}): PersistedFinanceEvent {
  return {
    event_id: `evt_fin_${randomUUID().replaceAll("-", "")}`,
    event_type: "finance.usage_recorded",
    event_version: 1,
    occurred_at: params.occurred_at,
    workspace_id: params.workspace_id,
    actor: { actor_type: "service", actor_id: "finance_projector_contract" },
    stream: { stream_type: "workspace", stream_id: params.workspace_id },
    correlation_id: `corr:${params.workspace_id}:${params.usage_id}`,
    idempotency_key: `finance_usage:${params.workspace_id}:${params.usage_id}`,
    entity_type: "finance",
    entity_id: params.usage_id,
    data: {
      usage_id: params.usage_id,
      cost_usd_micros: params.cost_usd_micros,
      prompt_tokens: params.prompt_tokens,
      completion_tokens: params.completion_tokens,
    },
  };
}

async function appendFinanceUsage(
  pool: ReturnType<typeof createPool>,
  params: Parameters<typeof financeEnvelope>[0],
): Promise<PersistedFinanceEvent> {
  const appended = await appendToStream(pool, financeEnvelope(params));
  return appended as unknown as PersistedFinanceEvent;
}

async function applyFinanceEnvelope(
  pool: ReturnType<typeof createPool>,
  event: PersistedFinanceEvent,
): Promise<void> {
  await applyFinanceEvent(pool, event);
}

async function financeRows(client: pg.Client, workspace_id: string): Promise<
  Array<{
    day_utc: string;
    cost_usd_micros: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    event_count: string;
    last_event_id: string;
    last_event_occurred_at: string;
  }>
> {
  const res = await client.query<{
    day_utc: string;
    cost_usd_micros: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
    event_count: string;
    last_event_id: string;
    last_event_occurred_at: string;
  }>(
    `SELECT
       day_utc::text AS day_utc,
       cost_usd_micros::text AS cost_usd_micros,
       prompt_tokens::text AS prompt_tokens,
       completion_tokens::text AS completion_tokens,
       total_tokens::text AS total_tokens,
       event_count::text AS event_count,
       last_event_id,
       last_event_occurred_at::text AS last_event_occurred_at
     FROM public.proj_finance_daily
     WHERE workspace_id = $1
     ORDER BY day_utc ASC`,
    [workspace_id],
  );
  return res.rows;
}

async function watermarkAt(
  client: pg.Client,
  workspace_id: string,
): Promise<string | null> {
  const res = await client.query<{ watermark_at: string | null }>(
    `SELECT last_applied_event_occurred_at::text AS watermark_at
     FROM projector_watermarks
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspace_id],
  );
  return res.rows[0]?.watermark_at ?? null;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  assertContractDbUrl(databaseUrl);
  await applyMigrations(databaseUrl);

  process.env.NODE_ENV = "test";
  clearFinanceCache();

  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: {
      port: 0,
      databaseUrl,
      authRequireSession: false,
      authAllowLegacyWorkspaceHeader: true,
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
    const t = await dbTimes(db);

    // T1 single event => row exists with correct sums.
    {
      const workspace_id = `ws_fin_proj_t1_${randomUUID().slice(0, 8)}`;
      const event = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 10,
        prompt_tokens: 3,
        completion_tokens: 7,
      });
      await applyFinanceEnvelope(pool, event);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cost_usd_micros, "10");
      assert.equal(rows[0]?.prompt_tokens, "3");
      assert.equal(rows[0]?.completion_tokens, "7");
      assert.equal(rows[0]?.total_tokens, "10");
      assert.equal(rows[0]?.event_count, "1");
    }

    // T2 replay safety: same event does not double-count.
    {
      const workspace_id = `ws_fin_proj_t2_${randomUUID().slice(0, 8)}`;
      const event = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.minus_one_day,
        cost_usd_micros: 20,
        prompt_tokens: 4,
        completion_tokens: 6,
      });
      await applyFinanceEnvelope(pool, event);
      await applyFinanceEnvelope(pool, event);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cost_usd_micros, "20");
      assert.equal(rows[0]?.event_count, "1");
    }

    // T3 same day additive sums + event_count increments.
    {
      const workspace_id = `ws_fin_proj_t3_${randomUUID().slice(0, 8)}`;
      const e1 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 100,
        prompt_tokens: 10,
        completion_tokens: 5,
      });
      const e2 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 30,
        prompt_tokens: 1,
        completion_tokens: 2,
      });
      await applyFinanceEnvelope(pool, e1);
      await applyFinanceEnvelope(pool, e2);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cost_usd_micros, "130");
      assert.equal(rows[0]?.prompt_tokens, "11");
      assert.equal(rows[0]?.completion_tokens, "7");
      assert.equal(rows[0]?.total_tokens, "18");
      assert.equal(rows[0]?.event_count, "2");
    }

    // T4 multi-day creates separate rows.
    {
      const workspace_id = `ws_fin_proj_t4_${randomUUID().slice(0, 8)}`;
      const e1 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.minus_two_days,
        cost_usd_micros: 5,
        prompt_tokens: 1,
        completion_tokens: 1,
      });
      const e2 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.minus_one_day,
        cost_usd_micros: 7,
        prompt_tokens: 2,
        completion_tokens: 3,
      });
      await applyFinanceEnvelope(pool, e1);
      await applyFinanceEnvelope(pool, e2);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.cost_usd_micros, "5");
      assert.equal(rows[1]?.cost_usd_micros, "7");
    }

    // T5 workspace isolation.
    {
      const workspaceA = `ws_fin_proj_t5a_${randomUUID().slice(0, 8)}`;
      const workspaceB = `ws_fin_proj_t5b_${randomUUID().slice(0, 8)}`;
      const eA = await appendFinanceUsage(pool, {
        workspace_id: workspaceA,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 41,
        prompt_tokens: 4,
        completion_tokens: 1,
      });
      const eB = await appendFinanceUsage(pool, {
        workspace_id: workspaceB,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 99,
        prompt_tokens: 9,
        completion_tokens: 9,
      });
      await applyFinanceEnvelope(pool, eA);
      await applyFinanceEnvelope(pool, eB);
      const rowsA = await financeRows(db, workspaceA);
      const rowsB = await financeRows(db, workspaceB);
      assert.equal(rowsA.length, 1);
      assert.equal(rowsB.length, 1);
      assert.equal(rowsA[0]?.cost_usd_micros, "41");
      assert.equal(rowsB[0]?.cost_usd_micros, "99");
    }

    // T6 invalid event does not halt sequence (valid, invalid, valid).
    {
      const workspace_id = `ws_fin_proj_t6_${randomUUID().slice(0, 8)}`;
      const valid1 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 11,
        prompt_tokens: 1,
        completion_tokens: 1,
      });
      const invalid = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: -1,
        prompt_tokens: 1,
        completion_tokens: 1,
      });
      const valid2 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 22,
        prompt_tokens: 2,
        completion_tokens: 2,
      });
      await applyFinanceEnvelope(pool, valid1);
      await applyFinanceEnvelope(pool, invalid);
      await applyFinanceEnvelope(pool, valid2);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cost_usd_micros, "33");
      assert.equal(rows[0]?.event_count, "2");

      const appliedCount = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM proj_applied_events
         WHERE projector_name = $1
           AND event_id = ANY($2::text[])`,
        [FINANCE_PROJECTOR_NAME, [valid1.event_id, invalid.event_id, valid2.event_id]],
      );
      assert.equal(appliedCount.rows[0]?.count, "3");
    }

    // T7 future occurred_at (>24h) is skipped.
    {
      const workspace_id = `ws_fin_proj_t7_${randomUUID().slice(0, 8)}`;
      const future = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.plus_48_hours,
        cost_usd_micros: 123,
        prompt_tokens: 10,
        completion_tokens: 10,
      });
      await applyFinanceEnvelope(pool, future);
      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 0);
    }

    // T8 integer-like string parses; float string rejected.
    {
      const workspace_id = `ws_fin_proj_t8_${randomUUID().slice(0, 8)}`;
      const good = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: "999",
        prompt_tokens: "5",
        completion_tokens: "6",
      });
      const bad = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: "1.5",
        prompt_tokens: "1",
        completion_tokens: "1",
      });
      await applyFinanceEnvelope(pool, good);
      await applyFinanceEnvelope(pool, bad);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cost_usd_micros, "999");
      assert.equal(rows[0]?.event_count, "1");
    }

    // T9 malformed occurred_at cast is skipped and batch continues.
    {
      const workspace_id = `ws_fin_proj_t9_${randomUUID().slice(0, 8)}`;
      const malformed: PersistedFinanceEvent = {
        ...financeEnvelope({
          workspace_id,
          usage_id: `usage_${randomUUID().slice(0, 8)}`,
          occurred_at: "not-a-timestamp",
          cost_usd_micros: 4,
          prompt_tokens: 1,
          completion_tokens: 1,
        }),
      };
      await applyFinanceEnvelope(pool, malformed);

      const valid = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 4,
        prompt_tokens: 1,
        completion_tokens: 1,
      });
      await applyFinanceEnvelope(pool, valid);

      const rows = await financeRows(db, workspace_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.event_count, "1");
    }

    // T10 PR-12A regression: finance projection route reads from proj_finance_daily.
    {
      const workspace_id = `ws_fin_proj_t10_${randomUUID().slice(0, 8)}`;
      const e1 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.minus_one_day,
        cost_usd_micros: 1000,
        prompt_tokens: 20,
        completion_tokens: 30,
      });
      const e2 = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 500,
        prompt_tokens: 3,
        completion_tokens: 7,
      });
      await applyFinanceEnvelope(pool, e1);
      await applyFinanceEnvelope(pool, e2);

      clearFinanceCache();
      const res = await requestJson<{
        schema_version: string;
        server_time: string;
        meta: { source: string; applied_days_back: number };
        totals: { estimated_cost_units: string; total_tokens: string } | null;
        series_daily: Array<{ day_utc: string; estimated_cost_units: string }>;
      }>(
        baseUrl,
        "POST",
        "/v1/finance/projection",
        {
          schema_version: SCHEMA_VERSION,
          days_back: 2,
        },
        { "x-workspace-id": workspace_id },
      );
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.meta.source, "proj_finance_daily");
      assert.ok(res.json.server_time.endsWith("Z"), res.text);
      assert.equal(res.json.totals?.estimated_cost_units, "1500");
      assert.equal(res.json.totals?.total_tokens, "60");
      assert.equal(res.json.series_daily.length, 2);
    }

    // T11 watermark recorded.
    {
      const workspace_id = `ws_fin_proj_t11_${randomUUID().slice(0, 8)}`;
      const event = await appendFinanceUsage(pool, {
        workspace_id,
        usage_id: `usage_${randomUUID().slice(0, 8)}`,
        occurred_at: t.now_utc,
        cost_usd_micros: 1,
        prompt_tokens: 1,
        completion_tokens: 1,
      });
      await applyFinanceEnvelope(pool, event);
      const wm = await watermarkAt(db, workspace_id);
      assert.ok(wm && wm.length > 0, "watermark should be recorded for workspace");
    }

    // T12 kernel-guard docs/hooks wiring.
    {
      const eventSpecs = await readFile(path.resolve(process.cwd(), "../../docs/EVENT_SPECS.md"), "utf8");
      assert.ok(eventSpecs.includes("finance.usage_recorded"));
      const kernelProtocol = await readFile(
        path.resolve(process.cwd(), "../../docs/KERNEL_CHANGE_PROTOCOL.md"),
        "utf8",
      );
      assert.ok(kernelProtocol.includes("finance.usage_recorded event + proj_finance_daily"));
      assert.ok(EXPECTED_PROJECTORS.includes("proj_finance"));
    }

    console.log("ok");
  } finally {
    clearFinanceCache();
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
