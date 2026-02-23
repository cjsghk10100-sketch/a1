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
): Promise<{ status: number; json: unknown }> {
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
  };
}

async function createRoom(baseUrl: string, headers: Record<string, string>): Promise<string> {
  const created = await requestJson(
    baseUrl,
    "POST",
    "/v1/rooms",
    {
      title: "Engine Contract Room",
      room_mode: "default",
      default_lang: "en",
    },
    headers,
  );
  assert.equal(created.status, 201);
  const json = created.json as { room_id: string };
  return json.room_id;
}

async function createRun(baseUrl: string, headers: Record<string, string>, room_id: string): Promise<string> {
  const created = await requestJson(
    baseUrl,
    "POST",
    "/v1/runs",
    {
      room_id,
      title: "engine contract run",
    },
    headers,
  );
  assert.equal(created.status, 201);
  const json = created.json as { run_id: string };
  return json.run_id;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  const app = await buildServer({ config: { port: 0, databaseUrl }, pool });
  await app.listen({ host: "127.0.0.1", port: 0 });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected tcp address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const workspace = `ws_contract_engines_${randomUUID().slice(0, 8)}`;
    const workspaceHeader = { "x-workspace-id": workspace };
    const actor_id = `engine_contract_${randomUUID().slice(0, 8)}`;

    const register = await requestJson(
      baseUrl,
      "POST",
      "/v1/engines/register",
      {
        actor_id,
        engine_name: "Contract Engine",
        token_label: "contract",
      },
      workspaceHeader,
    );
    assert.equal(register.status, 201);
    const registerJson = register.json as {
      engine: { engine_id: string; status: "active" | "inactive" };
      token: { token_id: string; engine_token: string };
    };
    assert.equal(registerJson.engine.status, "active");

    const engineHeaders = {
      ...workspaceHeader,
      "x-engine-id": registerJson.engine.engine_id,
      "x-engine-token": registerJson.token.engine_token,
    };

    const list = await requestJson(baseUrl, "GET", "/v1/engines", undefined, workspaceHeader);
    assert.equal(list.status, 200);
    const listJson = list.json as { engines: Array<{ engine_id: string; status: string }> };
    assert.ok(listJson.engines.some((row) => row.engine_id === registerJson.engine.engine_id));

    const listTokens = await requestJson(
      baseUrl,
      "GET",
      `/v1/engines/${registerJson.engine.engine_id}/tokens`,
      undefined,
      workspaceHeader,
    );
    assert.equal(listTokens.status, 200);
    const listTokensJson = listTokens.json as { tokens: Array<{ token_id: string }> };
    assert.ok(listTokensJson.tokens.some((row) => row.token_id === registerJson.token.token_id));

    const room_id = await createRoom(baseUrl, workspaceHeader);
    await createRun(baseUrl, workspaceHeader, room_id);

    const missingEngineToken = await requestJson(baseUrl, "POST", "/v1/runs/claim", {}, workspaceHeader);
    assert.equal(missingEngineToken.status, 401);
    assert.deepEqual(missingEngineToken.json, { error: "missing_engine_token" });

    const claim = await requestJson(baseUrl, "POST", "/v1/runs/claim", { room_id }, engineHeaders);
    assert.equal(claim.status, 200);
    const claimJson = claim.json as {
      claimed: boolean;
      run: { run_id: string; claim_token: string } | null;
    };
    assert.equal(claimJson.claimed, true);
    assert.ok(claimJson.run?.run_id);
    const claimedRun = claimJson.run;
    assert.ok(claimedRun);

    const revoke = await requestJson(
      baseUrl,
      "POST",
      `/v1/engines/${registerJson.engine.engine_id}/tokens/${registerJson.token.token_id}/revoke`,
      { reason: "contract_revoke" },
      workspaceHeader,
    );
    assert.equal(revoke.status, 200);

    const heartbeatWithRevoked = await requestJson(
      baseUrl,
      "POST",
      `/v1/runs/${claimedRun.run_id}/lease/heartbeat`,
      { claim_token: claimedRun.claim_token },
      engineHeaders,
    );
    assert.equal(heartbeatWithRevoked.status, 401);

    const issueNewToken = await requestJson(
      baseUrl,
      "POST",
      `/v1/engines/${registerJson.engine.engine_id}/tokens/issue`,
      {},
      workspaceHeader,
    );
    assert.equal(issueNewToken.status, 201);
    const newTokenJson = issueNewToken.json as { token: { engine_token: string } };
    const nextEngineHeaders = {
      ...workspaceHeader,
      "x-engine-id": registerJson.engine.engine_id,
      "x-engine-token": newTokenJson.token.engine_token,
    };

    const deactivate = await requestJson(
      baseUrl,
      "POST",
      `/v1/engines/${registerJson.engine.engine_id}/deactivate`,
      { reason: "contract_shutdown" },
      workspaceHeader,
    );
    assert.equal(deactivate.status, 200);

    await createRun(baseUrl, workspaceHeader, room_id);
    const claimInactive = await requestJson(baseUrl, "POST", "/v1/runs/claim", { room_id }, nextEngineHeaders);
    assert.equal(claimInactive.status, 403);
    assert.deepEqual(claimInactive.json, { error: "engine_inactive" });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
