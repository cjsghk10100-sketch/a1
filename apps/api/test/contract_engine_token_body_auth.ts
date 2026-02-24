import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

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
    const appliedSet = new Set(applied.rows.map((r) => r.version));

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
  pathName: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${baseUrl}${pathName}`, {
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
    json: text.length ? (JSON.parse(text) as unknown) : {},
    text,
  };
}

function readSessionTokens(body: unknown): { access_token: string } {
  if (!body || typeof body !== "object") throw new Error("invalid_auth_payload");
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_auth_session");
  const access_token = (session as { access_token?: unknown }).access_token;
  if (typeof access_token !== "string" || !access_token.trim()) {
    throw new Error("missing_access_token");
  }
  return { access_token };
}

async function ensureOwnerToken(baseUrl: string, workspaceId: string): Promise<string> {
  const passphrase = `pass_${workspaceId}`;
  const bootstrap = await requestJson(baseUrl, "POST", "/v1/auth/bootstrap-owner", {
    workspace_id: workspaceId,
    display_name: "Engine Body Cred Owner",
    passphrase,
  });
  if (bootstrap.status === 201) {
    return readSessionTokens(bootstrap.json).access_token;
  }
  assert.equal(bootstrap.status, 409);
  const login = await requestJson(baseUrl, "POST", "/v1/auth/login", {
    workspace_id: workspaceId,
    passphrase,
  });
  assert.equal(login.status, 200);
  return readSessionTokens(login.json).access_token;
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
    throw new Error("expected tcp address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const workspaceId = `ws_contract_engine_body_${randomUUID().slice(0, 8)}`;
    const accessToken = await ensureOwnerToken(baseUrl, workspaceId);
    const ownerHeaders = { authorization: `Bearer ${accessToken}` };

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Body Cred Room", room_mode: "default", default_lang: "en" },
      ownerHeaders,
    );
    assert.equal(roomRes.status, 201);
    const room_id = (roomRes.json as { room_id: string }).room_id;

    const runRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs",
      { room_id, title: "Body Cred Run" },
      ownerHeaders,
    );
    assert.equal(runRes.status, 201);
    const run_id = (runRes.json as { run_id: string }).run_id;

    const registerRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/engines/register",
      {
        actor_id: `engine_body_${randomUUID().slice(0, 6)}`,
        engine_name: "Body Cred Engine",
        token_label: "body-cred",
      },
      ownerHeaders,
    );
    assert.equal(registerRes.status, 201);
    const registerJson = registerRes.json as {
      engine: { engine_id: string };
      token: { engine_token: string };
    };

    const workspaceHeaderOnly = { "x-workspace-id": workspaceId };
    const claimRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/runs/claim",
      {
        room_id,
        engine_id: registerJson.engine.engine_id,
        engine_token: registerJson.token.engine_token,
      },
      workspaceHeaderOnly,
    );
    assert.equal(claimRes.status, 200);
    const claimJson = claimRes.json as {
      claimed: boolean;
      run: null | { run_id: string; claim_token: string };
    };
    assert.equal(claimJson.claimed, true);
    assert.ok(claimJson.run);
    assert.equal(claimJson.run.run_id, run_id);

    const heartbeatRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id}/lease/heartbeat`,
      {
        claim_token: claimJson.run.claim_token,
        engine_id: registerJson.engine.engine_id,
        engine_token: registerJson.token.engine_token,
      },
      workspaceHeaderOnly,
    );
    assert.equal(heartbeatRes.status, 200);

    const releaseRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${run_id}/lease/release`,
      {
        claim_token: claimJson.run.claim_token,
        engine_id: registerJson.engine.engine_id,
        engine_token: registerJson.token.engine_token,
      },
      workspaceHeaderOnly,
    );
    assert.equal(releaseRes.status, 200);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
