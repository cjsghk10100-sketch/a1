import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { createPool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const { Client } = pg;
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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

function readSessionTokens(body: unknown): { access_token: string; refresh_token: string } {
  if (!body || typeof body !== "object") throw new Error("invalid_auth_payload");
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_auth_session");
  const access_token = (session as { access_token?: unknown }).access_token;
  const refresh_token = (session as { refresh_token?: unknown }).refresh_token;
  if (typeof access_token !== "string" || !access_token.trim()) throw new Error("missing_access_token");
  if (typeof refresh_token !== "string" || !refresh_token.trim()) throw new Error("missing_refresh_token");
  return { access_token, refresh_token };
}

async function bootstrapOwner(input: {
  baseUrl: string;
  workspaceId: string;
  passphrase: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const response = await requestJson(input.baseUrl, "POST", "/v1/auth/bootstrap-owner", {
    workspace_id: input.workspaceId,
    display_name: "Engine Refresh Owner",
    passphrase: input.passphrase,
  });
  if (response.status === 201) return readSessionTokens(response.json);
  assert.equal(response.status, 409);
  const login = await requestJson(input.baseUrl, "POST", "/v1/auth/login", {
    workspace_id: input.workspaceId,
    passphrase: input.passphrase,
  });
  assert.equal(login.status, 200);
  return readSessionTokens(login.json);
}

async function createRoom(baseUrl: string, authHeaders: Record<string, string>, title: string): Promise<string> {
  const response = await requestJson(
    baseUrl,
    "POST",
    "/v1/rooms",
    { title, room_mode: "default", default_lang: "en" },
    authHeaders,
  );
  assert.equal(response.status, 201);
  return (response.json as { room_id: string }).room_id;
}

async function createRun(baseUrl: string, authHeaders: Record<string, string>, room_id: string): Promise<string> {
  const response = await requestJson(
    baseUrl,
    "POST",
    "/v1/runs",
    { room_id, title: "engine bearer refresh contract run" },
    authHeaders,
  );
  assert.equal(response.status, 201);
  return (response.json as { run_id: string }).run_id;
}

async function registerEngine(input: {
  baseUrl: string;
  authHeaders: Record<string, string>;
  actorId: string;
}): Promise<{ engine_id: string; engine_token: string }> {
  const response = await requestJson(
    input.baseUrl,
    "POST",
    "/v1/engines/register",
    {
      actor_id: input.actorId,
      engine_name: `Engine ${input.actorId}`,
      token_label: "refresh_contract",
    },
    input.authHeaders,
  );
  assert.equal(response.status, 201);
  const payload = response.json as {
    engine: { engine_id: string };
    token: { engine_token: string };
  };
  return {
    engine_id: payload.engine.engine_id,
    engine_token: payload.token.engine_token,
  };
}

async function runEngineOnce(input: {
  apiBaseUrl: string;
  workspaceId: string;
  roomId: string;
  actorId: string;
  bearerToken?: string;
  refreshToken?: string;
  engineId?: string;
  engineToken?: string;
}): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PNPM_BIN, ["-C", "apps/engine", "start"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ENGINE_API_BASE_URL: input.apiBaseUrl,
        ENGINE_WORKSPACE_ID: input.workspaceId,
        ENGINE_ROOM_ID: input.roomId,
        ENGINE_ACTOR_ID: input.actorId,
        ENGINE_BEARER_TOKEN: input.bearerToken ?? "",
        ENGINE_REFRESH_TOKEN: input.refreshToken ?? "",
        ENGINE_ID: input.engineId ?? "",
        ENGINE_AUTH_TOKEN: input.engineToken ?? "",
        ENGINE_RUN_ONCE: "true",
        ENGINE_POLL_MS: "100",
        ENGINE_MAX_CLAIMS_PER_CYCLE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("engine_run_once_timeout"));
    }, 30_000);

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `engine_run_once_failed:code=${code ?? "null"}:signal=${signal ?? "null"}:stderr=${stderr.slice(0, 400)}`,
        ),
      );
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitForRunStatus(
  db: pg.Client,
  run_id: string,
  expected: "running" | "succeeded" | "failed",
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await db.query<{ status: "running" | "succeeded" | "failed" }>(
      "SELECT status FROM proj_runs WHERE run_id = $1",
      [run_id],
    );
    if (row.rowCount === 1 && row.rows[0].status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`run_status_timeout:${run_id}:${expected}`);
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
      authSessionAccessTtlSec: 1,
      authSessionRefreshTtlSec: 60 * 60,
    },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected_tcp_server_address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const workspaceId = `ws_engine_refresh_${randomUUID().slice(0, 8)}`;
    const passphrase = "engine_refresh_contract_passphrase";
    const session = await bootstrapOwner({ baseUrl, workspaceId, passphrase });
    const ownerHeaders = { authorization: `Bearer ${session.access_token}` };

    const refreshRoomId = await createRoom(baseUrl, ownerHeaders, "Engine Refresh Room");
    const noRefreshRoomId = await createRoom(baseUrl, ownerHeaders, "Engine No-Refresh Room");
    const refreshRunId = await createRun(baseUrl, ownerHeaders, refreshRoomId);
    const noRefreshRunId = await createRun(baseUrl, ownerHeaders, noRefreshRoomId);

    const fixedEngine = await registerEngine({
      baseUrl,
      authHeaders: ownerHeaders,
      actorId: `engine_no_refresh_${randomUUID().slice(0, 6)}`,
    });

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    await runEngineOnce({
      apiBaseUrl: baseUrl,
      workspaceId,
      roomId: refreshRoomId,
      actorId: `engine_refresh_${randomUUID().slice(0, 6)}`,
      bearerToken: session.access_token,
      refreshToken: session.refresh_token,
    });
    await waitForRunStatus(db, refreshRunId, "succeeded");

    const refreshLease = await db.query<{ claim_token: string | null; lease_expires_at: string | null }>(
      "SELECT claim_token, lease_expires_at::text FROM proj_runs WHERE run_id = $1",
      [refreshRunId],
    );
    assert.equal(refreshLease.rowCount, 1);
    assert.equal(refreshLease.rows[0].claim_token, null);
    assert.equal(refreshLease.rows[0].lease_expires_at, null);

    await runEngineOnce({
      apiBaseUrl: baseUrl,
      workspaceId,
      roomId: noRefreshRoomId,
      actorId: `engine_no_refresh_runner_${randomUUID().slice(0, 6)}`,
      bearerToken: session.access_token,
      engineId: fixedEngine.engine_id,
      engineToken: fixedEngine.engine_token,
    });

    await waitForRunStatus(db, noRefreshRunId, "running");

    const noRefreshLease = await db.query<{
      claim_token: string | null;
      lease_expires_at: string | null;
      claimed_by_actor_id: string | null;
    }>(
      `SELECT
         claim_token,
         lease_expires_at::text,
         claimed_by_actor_id
       FROM proj_runs
       WHERE run_id = $1`,
      [noRefreshRunId],
    );
    assert.equal(noRefreshLease.rowCount, 1);
    assert.ok(typeof noRefreshLease.rows[0].claim_token === "string");
    assert.ok(typeof noRefreshLease.rows[0].lease_expires_at === "string");
    assert.ok(typeof noRefreshLease.rows[0].claimed_by_actor_id === "string");
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
