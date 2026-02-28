import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;

type JsonResponse = {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
};

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

async function requestJson(
  baseUrl: string,
  method: "POST",
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function ensureLegacyHeaderAgent(db: pg.Client, fallbackAgentId: string): Promise<string> {
  const principal = await db.query<{ principal_id: string }>(
    `SELECT principal_id
     FROM sec_principals
     WHERE legacy_actor_type = 'user'
       AND legacy_actor_id = 'legacy_header'
     LIMIT 1`,
  );
  assert.equal(principal.rowCount, 1);
  const principal_id = principal.rows[0].principal_id;

  const existing = await db.query<{ agent_id: string }>(
    `SELECT agent_id
     FROM sec_agents
     WHERE principal_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [principal_id],
  );
  if (existing.rowCount === 1) {
    return existing.rows[0].agent_id;
  }

  await db.query(
    `INSERT INTO sec_agents (agent_id, principal_id, display_name, created_at)
     VALUES ($1, $2, $3, now())`,
    [fallbackAgentId, principal_id, "Trace Contract Agent"],
  );
  return fallbackAgentId;
}

function claimBody(agentId: string, workItemId: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: "2.1",
    from_agent_id: agentId,
    work_item_type: "incident",
    work_item_id: workItemId,
    ...(extra ?? {}),
  };
}

function assertHeaderPresent(headers: Headers, key: string): string {
  const value = headers.get(key);
  assert.ok(value && value.length > 0, `missing ${key}`);
  return value as string;
}

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
  const workspace_id = `ws_trace_${randomUUID().slice(0, 8)}`;
  const commonHeaders = { "x-workspace-id": workspace_id };

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const seedRoom = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "seed", room_mode: "default", default_lang: "en" },
      commonHeaders,
    );
    assert.equal(seedRoom.status, 201, seedRoom.text);

    const agentId = await ensureLegacyHeaderAgent(
      db,
      `agt_trace_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    );

    // T1 invalid x-request-id => fallback req_*
    const t1 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, `inc_trace_t1_${randomUUID().slice(0, 6)}`),
      { ...commonHeaders, "x-request-id": "bad id!" },
    );
    assert.equal(t1.status, 201, t1.text);
    const t1ReqId = assertHeaderPresent(t1.headers, "x-request-id");
    assert.ok(t1ReqId.startsWith("req_"), `expected req_ fallback, got ${t1ReqId}`);

    // T2 valid x-request-id => echoed
    const validRequestId = "ReqTraceID_0001";
    const t2 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, `inc_trace_t2_${randomUUID().slice(0, 6)}`),
      { ...commonHeaders, "x-request-id": validRequestId },
    );
    assert.equal(t2.status, 201, t2.text);
    assert.equal(assertHeaderPresent(t2.headers, "x-request-id"), validRequestId);

    // T3 valid x-correlation-id header => ext_ prefix
    const corrHeader = "corrHeader_1234";
    const t3 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, `inc_trace_t3_${randomUUID().slice(0, 6)}`),
      { ...commonHeaders, "x-correlation-id": corrHeader },
    );
    assert.equal(t3.status, 201, t3.text);
    assert.equal(assertHeaderPresent(t3.headers, "x-correlation-id"), `ext_${corrHeader}`);

    // T4 no header correlation + no body correlation => correlation == request_id
    const t4 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, `inc_trace_t4_${randomUUID().slice(0, 6)}`),
      commonHeaders,
    );
    assert.equal(t4.status, 201, t4.text);
    const t4Req = assertHeaderPresent(t4.headers, "x-request-id");
    const t4Corr = assertHeaderPresent(t4.headers, "x-correlation-id");
    assert.equal(t4Corr, t4Req);

    // T5 body correlation + no x-correlation-id header => body value (no ext_)
    const bodyCorrelation = "corr_body_1234";
    const t5 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, `inc_trace_t5_${randomUUID().slice(0, 6)}`, {
        correlation_id: bodyCorrelation,
      }),
      commonHeaders,
    );
    assert.equal(t5.status, 201, t5.text);
    assert.equal(assertHeaderPresent(t5.headers, "x-correlation-id"), bodyCorrelation);

    // T6 error response still includes tracing headers
    const t6 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      {
        ...claimBody(agentId, `inc_trace_t6_${randomUUID().slice(0, 6)}`),
        schema_version: "9.9",
      },
      commonHeaders,
    );
    assert.equal(t6.status, 400, t6.text);
    assertHeaderPresent(t6.headers, "x-request-id");
    assertHeaderPresent(t6.headers, "x-correlation-id");

    // T7 evt_events correlation consistency from body correlation_id
    const evtCorrelation = "corr_evt_trace_test";
    const entityId = `inc_trace_t7_${randomUUID().slice(0, 6)}`;
    const t7 = await requestJson(
      baseUrl,
      "POST",
      "/v1/work-items/claim",
      claimBody(agentId, entityId, { correlation_id: evtCorrelation }),
      commonHeaders,
    );
    assert.equal(t7.status, 201, t7.text);

    const evt = await db.query<{ correlation_id: string }>(
      `SELECT correlation_id
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'lease.claimed'
         AND entity_type = 'incident'
         AND entity_id = $2
       ORDER BY stream_seq DESC
       LIMIT 1`,
      [workspace_id, entityId],
    );
    assert.equal(evt.rowCount, 1);
    assert.equal(evt.rows[0].correlation_id, evtCorrelation);
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
