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
  pathName: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: T; text: string }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = (text.length ? JSON.parse(text) : {}) as T;
  return { status: response.status, json, text };
}

function readOwnerAccessToken(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("invalid_auth_payload");
  const session = (payload as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_auth_session");
  const accessToken = (session as { access_token?: unknown }).access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) throw new Error("missing_access_token");
  return accessToken;
}

async function ensureOwnerToken(baseUrl: string, workspaceId: string): Promise<string> {
  const passphrase = `pass_${workspaceId}`;
  const bootstrap = await requestJson<unknown>(baseUrl, "POST", "/v1/auth/bootstrap-owner", {
    workspace_id: workspaceId,
    display_name: "Engine Ingest Contract Owner",
    passphrase,
  });
  if (bootstrap.status === 201) return readOwnerAccessToken(bootstrap.json);

  assert.equal(bootstrap.status, 409);
  const login = await requestJson<unknown>(baseUrl, "POST", "/v1/auth/login", {
    workspace_id: workspaceId,
    passphrase,
  });
  assert.equal(login.status, 200);
  return readOwnerAccessToken(login.json);
}

async function registerEngine(
  baseUrl: string,
  ownerToken: string,
  actorId: string,
  options?: { rooms?: string[] },
): Promise<{ engine_id: string; engine_token: string }> {
  const rooms = options?.rooms?.length ? options.rooms : ["*"];
  const res = await requestJson<{
    engine: { engine_id: string };
    token: { engine_token: string };
  }>(
    baseUrl,
    "POST",
    "/v1/engines/register",
    {
      actor_id: actorId,
      engine_name: `Engine ${actorId}`,
      scopes: {
        action_types: ["run.claim", "run.lease.heartbeat", "run.lease.release", "evidence.ingest"],
        rooms,
      },
    },
    { authorization: `Bearer ${ownerToken}` },
  );
  assert.equal(res.status, 201);
  return {
    engine_id: res.json.engine.engine_id,
    engine_token: res.json.token.engine_token,
  };
}

function makeEvent(input: {
  workspaceId: string;
  eventType?: string;
  eventId?: string;
  occurredAt?: string;
  idempotencyKey?: string | null;
  includeWorkspace?: string | null;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  const eventId = input.eventId ?? randomUUID();
  const event: Record<string, unknown> = {
    event_id: eventId,
    event_type: input.eventType ?? "message.created",
    event_version: 1,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    correlation_id: `corr_${eventId}`,
    data: input.data ?? { ok: true, seed: eventId.slice(0, 8) },
  };
  if (input.idempotencyKey !== null) {
    event.idempotency_key = input.idempotencyKey ?? `idem_${input.workspaceId}_${eventId}`;
  }
  if (input.includeWorkspace) {
    event.workspace_id = input.includeWorkspace;
  }
  return event;
}

async function dbFutureIso(db: pg.Client): Promise<string> {
  const res = await db.query<{ t: string }>(
    `SELECT ((now() + interval '25 hours') AT TIME ZONE 'UTC')::text || 'Z' AS t`,
  );
  return res.rows[0]?.t ?? "2099-01-01T00:00:00.000Z";
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  const app = await buildServer({
    config: {
      port: 0,
      databaseUrl,
      authRequireSession: true,
      authAllowLegacyWorkspaceHeader: false,
      authBootstrapAllowLoopback: true,
    },
    pool,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected tcp address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const suffix = randomUUID().slice(0, 8);
    const workspaceA = `ws_contract_engine_ingest_a_${suffix}`;
    const workspaceB = `ws_contract_engine_ingest_b_${suffix}`;

    const ownerA = await ensureOwnerToken(baseUrl, workspaceA);
    const ownerB = await ensureOwnerToken(baseUrl, workspaceB);
    const engineA = await registerEngine(baseUrl, ownerA, `ingest_a_${suffix}`);
    const roomScopedEngineA = await registerEngine(baseUrl, ownerA, `ingest_room_scoped_${suffix}`, {
      rooms: [`room_scope_${suffix}`],
    });
    await registerEngine(baseUrl, ownerB, `ingest_b_${suffix}`);

    // T1: route mounts + requires workspace header.
    const missingWorkspace = await requestJson<{ reason_code?: string }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [],
      },
    );
    assert.equal(missingWorkspace.status, httpStatusForReasonCode("missing_workspace_header"));
    assert.equal(missingWorkspace.json.reason_code, "missing_workspace_header");

    // T2: invalid engine token -> unknown_agent.
    const badToken = await requestJson<{ reason_code?: string }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: "bad_token",
        events: [],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(badToken.status, httpStatusForReasonCode("unknown_agent"));
    assert.equal(badToken.json.reason_code, "unknown_agent");

    // T3: token workspace mismatch -> unauthorized_workspace.
    const mismatch = await requestJson<{ reason_code?: string }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [],
      },
      { "x-workspace-id": workspaceB },
    );
    assert.equal(mismatch.status, httpStatusForReasonCode("unauthorized_workspace"));
    assert.equal(mismatch.json.reason_code, "unauthorized_workspace");

    // T3b: room-scoped token with evidence.ingest action still allowed for workspace ingest.
    const roomScoped = await requestJson<{
      accepted: number;
      rejected: number;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: roomScopedEngineA.engine_id,
        engine_token: roomScopedEngineA.engine_token,
        events: [makeEvent({ workspaceId: workspaceA })],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(roomScoped.status, 200);
    assert.equal(roomScoped.json.accepted, 1);
    assert.equal(roomScoped.json.rejected, 0);

    // T4: happy path accepted=2.
    const e1 = makeEvent({ workspaceId: workspaceA });
    const e2 = makeEvent({ workspaceId: workspaceA });
    const happy = await requestJson<{
      accepted: number;
      deduped: number;
      rejected: number;
      results: Array<{ status: string }>;
      server_time: string;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [e1, e2],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(happy.status, 200);
    assert.equal(happy.json.accepted, 2);
    assert.equal(happy.json.deduped, 0);
    assert.equal(happy.json.rejected, 0);
    assert.equal(happy.json.results.every((row) => row.status === "accepted"), true);
    assert.equal(happy.json.server_time.endsWith("Z"), true);

    const inserted = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_id = ANY($2::text[])`,
      [workspaceA, [e1.event_id as string, e2.event_id as string]],
    );
    assert.equal(Number.parseInt(inserted.rows[0]?.count ?? "0", 10), 2);

    // T5: dedupe replay.
    const replay = await requestJson<{
      accepted: number;
      deduped: number;
      rejected: number;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [e1, e2],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.json.accepted, 0);
    assert.equal(replay.json.deduped, 2);
    assert.equal(replay.json.rejected, 0);

    // T6: partial rejection.
    const p1 = makeEvent({ workspaceId: workspaceA });
    const p2 = makeEvent({ workspaceId: workspaceA });
    delete p2.event_type;
    const p3 = makeEvent({ workspaceId: workspaceA });
    const partial = await requestJson<{
      accepted: number;
      deduped: number;
      rejected: number;
      results: Array<{ status: string; reason_code?: string }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [p1, p2, p3],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(partial.status, 200);
    assert.equal(partial.json.accepted, 2);
    assert.equal(partial.json.rejected, 1);
    assert.equal(partial.json.results[1]?.status, "rejected");
    assert.equal(partial.json.results[1]?.reason_code, "missing_field");

    // T7: future occurred_at rejected.
    const futureEvent = makeEvent({
      workspaceId: workspaceA,
      occurredAt: await dbFutureIso(db),
    });
    const future = await requestJson<{
      accepted: number;
      rejected: number;
      results: Array<{ reason_code?: string }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [futureEvent],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(future.status, 200);
    assert.equal(future.json.accepted, 0);
    assert.equal(future.json.rejected, 1);
    assert.equal(future.json.results[0]?.reason_code, "invalid_payload_combination");

    // T8: missing idempotency warning.
    const noIdem = makeEvent({ workspaceId: workspaceA, idempotencyKey: null });
    const noIdemRes = await requestJson<{
      accepted: number;
      warnings: Array<{ kind: string; details?: { count?: number } }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [noIdem],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(noIdemRes.status, 200);
    assert.equal(noIdemRes.json.accepted, 1);
    assert.equal(noIdemRes.json.warnings.some((warning) => warning.kind === "missing_idempotency_key"), true);
    const missingIdemWarning = noIdemRes.json.warnings.find((warning) => warning.kind === "missing_idempotency_key");
    assert.equal(missingIdemWarning?.details?.count, 1);

    // T9: per-event workspace mismatch.
    const wm1 = makeEvent({ workspaceId: workspaceA });
    const wm2 = makeEvent({ workspaceId: workspaceA, includeWorkspace: workspaceB });
    const wm3 = makeEvent({ workspaceId: workspaceA });
    const perEventWorkspace = await requestJson<{
      accepted: number;
      rejected: number;
      results: Array<{ status: string; reason_code?: string }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [wm1, wm2, wm3],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(perEventWorkspace.status, 200);
    assert.equal(perEventWorkspace.json.accepted, 2);
    assert.equal(perEventWorkspace.json.rejected, 1);
    assert.equal(perEventWorkspace.json.results[1]?.reason_code, "unauthorized_workspace");

    // T10: large data rejected.
    const tooLarge = makeEvent({
      workspaceId: workspaceA,
      data: { blob: "x".repeat(70_000) },
    });
    const tooLargeRes = await requestJson<{
      accepted: number;
      rejected: number;
      results: Array<{ reason_code?: string }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [tooLarge],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(tooLargeRes.status, 200);
    assert.equal(tooLargeRes.json.accepted, 0);
    assert.equal(tooLargeRes.json.rejected, 1);
    assert.equal(tooLargeRes.json.results[0]?.reason_code, "payload_too_large");

    // T11: batch cap > 100 -> invalid_payload_combination.
    const tooManyEvents = Array.from({ length: 101 }, () => makeEvent({ workspaceId: workspaceA }));
    const tooManyRes = await requestJson<{ reason_code?: string }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: tooManyEvents,
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(tooManyRes.status, httpStatusForReasonCode("invalid_payload_combination"));
    assert.equal(tooManyRes.json.reason_code, "invalid_payload_combination");

    // T12: allowlist + event_version guard and deterministic result index order.
    const guardGood = makeEvent({ workspaceId: workspaceA });
    const guardBadType = makeEvent({
      workspaceId: workspaceA,
      eventType: "engine.unknown_type",
    });
    const guardBadVersion = makeEvent({ workspaceId: workspaceA });
    guardBadVersion.event_version = 99;
    const guardsRes = await requestJson<{
      accepted: number;
      rejected: number;
      results: Array<{ index: number; status: string; reason_code?: string }>;
    }>(
      baseUrl,
      "POST",
      "/v1/engines/evidence/ingest",
      {
        schema_version: SCHEMA_VERSION,
        engine_id: engineA.engine_id,
        engine_token: engineA.engine_token,
        events: [guardGood, guardBadType, guardBadVersion],
      },
      { "x-workspace-id": workspaceA },
    );
    assert.equal(guardsRes.status, 200);
    assert.equal(guardsRes.json.accepted, 1);
    assert.equal(guardsRes.json.rejected, 2);
    assert.deepEqual(
      guardsRes.json.results.map((row) => row.index),
      [0, 1, 2],
    );
    assert.equal(guardsRes.json.results[1]?.status, "rejected");
    assert.equal(guardsRes.json.results[1]?.reason_code, "invalid_payload_combination");
    assert.equal(guardsRes.json.results[2]?.status, "rejected");
    assert.equal(guardsRes.json.results[2]?.reason_code, "invalid_payload_combination");

    // T13: request-level rate limit returns contract 429 with retry_after_sec.
    const prevGlobalPerMin = process.env.ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN;
    const prevWorkspacePerMin = process.env.ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN;
    try {
      process.env.ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN = "1";
      process.env.ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN = "1";
      await db.query(
        `DELETE FROM rate_limit_buckets
         WHERE bucket_key = ANY($1::text[])`,
        [["engine_ingest_global", `engine_ingest:${workspaceA}`]],
      );

      const rlFirst = await requestJson<{ accepted: number }>(
        baseUrl,
        "POST",
        "/v1/engines/evidence/ingest",
        {
          schema_version: SCHEMA_VERSION,
          engine_id: engineA.engine_id,
          engine_token: engineA.engine_token,
          events: [makeEvent({ workspaceId: workspaceA })],
        },
        { "x-workspace-id": workspaceA },
      );
      assert.equal(rlFirst.status, 200);
      assert.equal(rlFirst.json.accepted, 1);

      const rlSecond = await requestJson<{
        reason_code?: string;
        details?: { retry_after_sec?: unknown };
      }>(
        baseUrl,
        "POST",
        "/v1/engines/evidence/ingest",
        {
          schema_version: SCHEMA_VERSION,
          engine_id: engineA.engine_id,
          engine_token: engineA.engine_token,
          events: [makeEvent({ workspaceId: workspaceA })],
        },
        { "x-workspace-id": workspaceA },
      );
      assert.equal(rlSecond.status, httpStatusForReasonCode("rate_limited"));
      assert.equal(rlSecond.json.reason_code, "rate_limited");
      const retryAfter = Number((rlSecond.json.details as { retry_after_sec?: unknown } | undefined)?.retry_after_sec);
      assert.equal(Number.isFinite(retryAfter), true);
      assert.equal(retryAfter >= 0, true);
    } finally {
      if (prevGlobalPerMin === undefined) delete process.env.ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN;
      else process.env.ENGINE_EVIDENCE_INGEST_GLOBAL_PER_MIN = prevGlobalPerMin;
      if (prevWorkspacePerMin === undefined) delete process.env.ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN;
      else process.env.ENGINE_EVIDENCE_INGEST_WORKSPACE_PER_MIN = prevWorkspacePerMin;
      await db.query(
        `DELETE FROM rate_limit_buckets
         WHERE bucket_key = ANY($1::text[])`,
        [["engine_ingest_global", `engine_ingest:${workspaceA}`]],
      );
    }

    // T14: server_time is UTC with Z.
    assert.equal(typeof happy.json.server_time, "string");
    assert.equal(happy.json.server_time.endsWith("Z"), true);
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
