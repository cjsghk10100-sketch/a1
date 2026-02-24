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

function readAccessToken(body: unknown): string {
  if (!body || typeof body !== "object") throw new Error("invalid_auth_payload");
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_auth_session");
  const access_token = (session as { access_token?: unknown }).access_token;
  if (typeof access_token !== "string" || !access_token.trim()) {
    throw new Error("missing_access_token");
  }
  return access_token;
}

async function ensureOwnerAccessToken(baseUrl: string, workspaceId: string): Promise<string> {
  const passphrase = `pass_${workspaceId}`;
  const bootstrap = await requestJson(baseUrl, "POST", "/v1/auth/bootstrap-owner", {
    workspace_id: workspaceId,
    display_name: "Engine Lease Owner",
    passphrase,
  });
  if (bootstrap.status === 201) {
    return readAccessToken(bootstrap.json);
  }
  assert.equal(bootstrap.status, 409);
  const login = await requestJson(baseUrl, "POST", "/v1/auth/login", {
    workspace_id: workspaceId,
    passphrase,
  });
  assert.equal(login.status, 200);
  return readAccessToken(login.json);
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

async function createRun(baseUrl: string, workspaceHeader: Record<string, string>, room_id: string): Promise<string> {
  const res = await requestJson(baseUrl, "POST", "/v1/runs", { room_id, title: "engine lease run" }, workspaceHeader);
  assert.equal(res.status, 201);
  const json = res.json as { run_id: string };
  return json.run_id;
}

async function waitForRunStatus(
  baseUrl: string,
  workspaceHeader: Record<string, string>,
  run_id: string,
  expected: "running" | "succeeded" | "failed",
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runRes = await requestJson(baseUrl, "GET", `/v1/runs/${run_id}`, undefined, workspaceHeader);
    if (runRes.status === 200) {
      const runJson = runRes.json as { run: { status: string } };
      if (runJson.run.status === expected) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`run_status_timeout:${run_id}:${expected}`);
}

async function runEngineOnce(input: {
  apiBaseUrl: string;
  workspaceId: string;
  actorId: string;
  bearerToken: string;
}): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PNPM_BIN, ["-C", "apps/engine", "start"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ENGINE_API_BASE_URL: input.apiBaseUrl,
        ENGINE_WORKSPACE_ID: input.workspaceId,
        ENGINE_ACTOR_ID: input.actorId,
        ENGINE_BEARER_TOKEN: input.bearerToken,
        ENGINE_RUN_ONCE: "true",
        ENGINE_POLL_MS: "100",
        ENGINE_MAX_CLAIMS_PER_CYCLE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stdout.on("data", () => {});
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
  if (!address || typeof address === "string") {
    throw new Error("expected server to listen on a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const runIdSuffix = randomUUID().slice(0, 8);
    const workspaceId = `ws_contract_engine_lease_${runIdSuffix}`;
    const ownerAccessToken = await ensureOwnerAccessToken(baseUrl, workspaceId);
    const ownerHeaders = { authorization: `Bearer ${ownerAccessToken}` };
    const actorId = `engine_contract_lease_${runIdSuffix}`;
    const roomId = await createRoom(baseUrl, ownerHeaders, "Engine Lease Room");
    const runId = await createRun(baseUrl, ownerHeaders, roomId);

    await runEngineOnce({
      apiBaseUrl: baseUrl,
      workspaceId,
      actorId,
      bearerToken: ownerAccessToken,
    });
    await waitForRunStatus(baseUrl, ownerHeaders, runId, "succeeded");

    const lease = await db.query<{
      claim_token: string | null;
      claimed_by_actor_id: string | null;
      lease_expires_at: string | null;
      lease_heartbeat_at: string | null;
    }>(
      `SELECT
        claim_token,
        claimed_by_actor_id,
        lease_expires_at::text,
        lease_heartbeat_at::text
      FROM proj_runs
      WHERE run_id = $1`,
      [runId],
    );
    assert.equal(lease.rowCount, 1);
    assert.equal(lease.rows[0].claim_token, null);
    assert.equal(lease.rows[0].claimed_by_actor_id, null);
    assert.equal(lease.rows[0].lease_expires_at, null);
    assert.equal(lease.rows[0].lease_heartbeat_at, null);

    const attempts = await db.query<{
      attempt_no: number;
      claimed_by_actor_id: string;
      release_reason: string | null;
      engine_id: string | null;
    }>(
      `SELECT
         attempt_no,
         claimed_by_actor_id,
         release_reason,
         engine_id
       FROM run_attempts
       WHERE run_id = $1
       ORDER BY attempt_no ASC`,
      [runId],
    );
    assert.equal(attempts.rowCount, 1);
    assert.equal(attempts.rows[0].claimed_by_actor_id, actorId);
    assert.equal(attempts.rows[0].release_reason, "run_completed");
    assert.ok(Boolean(attempts.rows[0].engine_id));

    const started = await db.query<{ actor_id: string }>(
      `SELECT actor_id
       FROM evt_events
       WHERE run_id = $1
         AND event_type = 'run.started'
       ORDER BY stream_seq DESC
       LIMIT 1`,
      [runId],
    );
    assert.equal(started.rowCount, 1);
    assert.equal(started.rows[0].actor_id, actorId);
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
