import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { buildServer } from "../src/server.js";
import { createPool } from "../src/db/pool.js";

const { Client } = pg;
const RUN_LOCK_NAMESPACE = 215;

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
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  return { status: res.status, json, text };
}

async function createRoom(baseUrl: string, workspaceHeader: Record<string, string>, title: string): Promise<string> {
  const res = await requestJson(
    baseUrl,
    "POST",
    "/v1/rooms",
    { title, room_mode: "default", default_lang: "en" },
    workspaceHeader,
  );
  assert.equal(res.status, 201);
  const json = res.json as { room_id: string };
  return json.room_id;
}

async function createRun(
  baseUrl: string,
  workspaceHeader: Record<string, string>,
  input: { room_id: string; title: string },
): Promise<string> {
  const res = await requestJson(baseUrl, "POST", "/v1/runs", input, workspaceHeader);
  assert.equal(res.status, 201);
  const json = res.json as { run_id: string };
  return json.run_id;
}

type ClaimResponse = {
  claimed: boolean;
  run: null | {
    run_id: string;
    workspace_id: string;
    room_id: string | null;
    thread_id: string | null;
    status: string;
    title: string | null;
    goal: string | null;
    input: Record<string, unknown> | null;
    tags: string[];
    correlation_id: string;
  };
};

function assertClaimedRun(response: ClaimResponse): asserts response is ClaimResponse & { run: NonNullable<ClaimResponse["run"]> } {
  assert.equal(response.claimed, true);
  assert.ok(response.run);
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

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const ws1 = { "x-workspace-id": "ws_contract_run_claim_1" };
    const ws2 = { "x-workspace-id": "ws_contract_run_claim_2" };
    const actorId = "engine_bridge";

    const roomA = await createRoom(baseUrl, ws1, "Run Claim Room A");
    const roomB = await createRoom(baseUrl, ws1, "Run Claim Room B");
    const ws2Room = await createRoom(baseUrl, ws2, "Run Claim Room WS2");

    const runA1 = await createRun(baseUrl, ws1, { room_id: roomA, title: "Run A1" });
    const runA2 = await createRun(baseUrl, ws1, { room_id: roomA, title: "Run A2" });
    const runB1 = await createRun(baseUrl, ws1, { room_id: roomB, title: "Run B1" });
    const runWs2 = await createRun(baseUrl, ws2, { room_id: ws2Room, title: "Run WS2" });

    const claimA1Res = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs/claim",
      { room_id: roomA, actor_id: actorId },
      ws1,
    );
    assert.equal(claimA1Res.status, 200);
    const claimA1 = claimA1Res.json as ClaimResponse;
    assertClaimedRun(claimA1);
    assert.equal(claimA1.run.room_id, roomA);
    assert.equal(claimA1.run.status, "running");
    assert.ok(claimA1.run.correlation_id.length > 0);
    assert.ok(claimA1.run.run_id === runA1 || claimA1.run.run_id === runA2);

    const claimA2Res = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs/claim",
      { room_id: roomA, actor_id: actorId },
      ws1,
    );
    assert.equal(claimA2Res.status, 200);
    const claimA2 = claimA2Res.json as ClaimResponse;
    assertClaimedRun(claimA2);
    assert.equal(claimA2.run.room_id, roomA);
    assert.notEqual(claimA2.run.run_id, claimA1.run.run_id);

    const claimA3Res = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs/claim",
      { room_id: roomA, actor_id: actorId },
      ws1,
    );
    assert.equal(claimA3Res.status, 200);
    const claimA3 = claimA3Res.json as ClaimResponse;
    assert.equal(claimA3.claimed, false);
    assert.equal(claimA3.run, null);

    const claimBRes = await requestJson(baseUrl, "POST", "/v1/runs/claim", { actor_id: actorId }, ws1);
    assert.equal(claimBRes.status, 200);
    const claimB = claimBRes.json as ClaimResponse;
    assertClaimedRun(claimB);
    assert.equal(claimB.run.run_id, runB1);
    assert.equal(claimB.run.room_id, roomB);

    const claimWs1EmptyRes = await requestJson(baseUrl, "POST", "/v1/runs/claim", { actor_id: actorId }, ws1);
    assert.equal(claimWs1EmptyRes.status, 200);
    const claimWs1Empty = claimWs1EmptyRes.json as ClaimResponse;
    assert.equal(claimWs1Empty.claimed, false);
    assert.equal(claimWs1Empty.run, null);

    const claimWs2Res = await requestJson(baseUrl, "POST", "/v1/runs/claim", { actor_id: actorId }, ws2);
    assert.equal(claimWs2Res.status, 200);
    const claimWs2 = claimWs2Res.json as ClaimResponse;
    assertClaimedRun(claimWs2);
    assert.equal(claimWs2.run.run_id, runWs2);

    for (const claimedRunId of [claimA1.run.run_id, claimA2.run.run_id, claimB.run.run_id, claimWs2.run.run_id]) {
      const actorRow = await db.query<{ actor_id: string }>(
        `SELECT actor_id
         FROM evt_events
         WHERE run_id = $1
           AND event_type = 'run.started'
         ORDER BY stream_seq DESC
         LIMIT 1`,
        [claimedRunId],
      );
      assert.equal(actorRow.rowCount, 1);
      assert.equal(actorRow.rows[0].actor_id, actorId);

      const runRes = await requestJson(baseUrl, "GET", `/v1/runs/${claimedRunId}`, undefined, {
        "x-workspace-id": claimedRunId === runWs2 ? ws2["x-workspace-id"] : ws1["x-workspace-id"],
      });
      assert.equal(runRes.status, 200);
      const runJson = runRes.json as { run: { status: string } };
      assert.equal(runJson.run.status, "running");
    }

    const lockedRun = await createRun(baseUrl, ws1, { room_id: roomB, title: "Locked Start Run" });
    await db.query("SELECT pg_advisory_lock($1::int, hashtext($2)::int)", [RUN_LOCK_NAMESPACE, lockedRun]);
    try {
      const startLockedRes = await requestJson(baseUrl, "POST", `/v1/runs/${lockedRun}/start`, {}, ws1);
      assert.equal(startLockedRes.status, 409);
      assert.deepEqual(startLockedRes.json, { error: "run_locked" });
    } finally {
      await db.query("SELECT pg_advisory_unlock($1::int, hashtext($2)::int)", [RUN_LOCK_NAMESPACE, lockedRun]);
    }

    const startRes = await requestJson(baseUrl, "POST", `/v1/runs/${lockedRun}/start`, {}, ws1);
    assert.equal(startRes.status, 200);
    assert.deepEqual(startRes.json, { ok: true });
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
