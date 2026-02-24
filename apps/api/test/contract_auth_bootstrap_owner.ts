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

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const prevAuthSessionSecret = process.env.AUTH_SESSION_SECRET;
  const prevBootstrapAllowLoopback = process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK;
  process.env.AUTH_SESSION_SECRET = `session_secret_${randomUUID().slice(0, 10)}`;
  delete process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK;

  const primaryPool = createPool(databaseUrl);
  try {
    const bootstrapToken = `bootstrap_${randomUUID().slice(0, 8)}`;
    const app = await buildServer({
      config: {
        port: 0,
        databaseUrl,
        authRequireSession: true,
        authAllowLegacyWorkspaceHeader: false,
        authBootstrapAllowLoopback: false,
        authBootstrapToken: bootstrapToken,
      },
      pool: primaryPool,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const workspaceA = `ws_bootstrap_a_${randomUUID().slice(0, 6)}`;
      const workspaceB = `ws_bootstrap_b_${randomUUID().slice(0, 6)}`;
      const workspaceAPassphrase = `pass_${workspaceA}`;
      const workspaceBPassphrase = `pass_${workspaceB}`;

      const unauthorized = await requestJson(baseUrl, "POST", "/v1/auth/bootstrap-owner", {
        workspace_id: workspaceA,
        display_name: "Owner A",
      });
      assert.equal(unauthorized.status, 403);
      assert.deepEqual(unauthorized.json, { error: "bootstrap_forbidden" });

      const wrongToken = await requestJson(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceA,
          display_name: "Owner A",
          passphrase: workspaceAPassphrase,
        },
        { "x-bootstrap-token": `${bootstrapToken}_wrong` },
      );
      assert.equal(wrongToken.status, 403);
      assert.deepEqual(wrongToken.json, { error: "bootstrap_forbidden" });

      const missingPassphrase = await requestJson(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceA,
          display_name: "Owner A",
        },
        { "x-bootstrap-token": bootstrapToken },
      );
      assert.equal(missingPassphrase.status, 400);
      assert.deepEqual(missingPassphrase.json, { error: "missing_passphrase" });

      const bootstrapped = await requestJson(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceA,
          display_name: "Owner A",
          passphrase: workspaceAPassphrase,
        },
        { "x-bootstrap-token": bootstrapToken },
      );
      assert.equal(bootstrapped.status, 201);
      const accessToken = readAccessToken(bootstrapped.json);

      const roomsByAccessToken = await requestJson(
        baseUrl,
        "GET",
        "/v1/rooms",
        undefined,
        { authorization: `Bearer ${accessToken}` },
      );
      assert.equal(roomsByAccessToken.status, 200);

      const loginMissingPassphrase = await requestJson(baseUrl, "POST", "/v1/auth/login", {
        workspace_id: workspaceA,
      });
      assert.equal(loginMissingPassphrase.status, 401);
      assert.deepEqual(loginMissingPassphrase.json, { error: "invalid_credentials" });

      const loginWrongPassphrase = await requestJson(baseUrl, "POST", "/v1/auth/login", {
        workspace_id: workspaceA,
        passphrase: `${workspaceAPassphrase}_wrong`,
      });
      assert.equal(loginWrongPassphrase.status, 401);
      assert.deepEqual(loginWrongPassphrase.json, { error: "invalid_credentials" });

      const loginCorrectPassphrase = await requestJson(baseUrl, "POST", "/v1/auth/login", {
        workspace_id: workspaceA,
        passphrase: workspaceAPassphrase,
      });
      assert.equal(loginCorrectPassphrase.status, 200);

      const bootstrapBySession = await requestJson(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceB,
          display_name: "Owner B",
          passphrase: workspaceBPassphrase,
        },
        { authorization: `Bearer ${accessToken}` },
      );
      assert.equal(bootstrapBySession.status, 403);
      assert.deepEqual(bootstrapBySession.json, { error: "bootstrap_forbidden" });

      const bootstrapWorkspaceBWithToken = await requestJson(
        baseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceB,
          display_name: "Owner B",
          passphrase: workspaceBPassphrase,
        },
        { "x-bootstrap-token": bootstrapToken },
      );
      assert.equal(bootstrapWorkspaceBWithToken.status, 201);

      await primaryPool.query(
        `UPDATE sec_local_owners
         SET passphrase_hash = NULL
         WHERE workspace_id = $1`,
        [workspaceB],
      );

      const loginUnsetPassphraseHash = await requestJson(baseUrl, "POST", "/v1/auth/login", {
        workspace_id: workspaceB,
        passphrase: workspaceBPassphrase,
      });
      assert.equal(loginUnsetPassphraseHash.status, 401);
      assert.deepEqual(loginUnsetPassphraseHash.json, { error: "invalid_credentials" });
    } finally {
      await app.close();
    }

    const loopbackPool = createPool(databaseUrl);
    const loopbackDisabledByDefaultApp = await buildServer({
      config: {
        port: 0,
        databaseUrl,
        authRequireSession: true,
        authAllowLegacyWorkspaceHeader: false,
      },
      pool: loopbackPool,
    });
    await loopbackDisabledByDefaultApp.listen({ host: "127.0.0.1", port: 0 });
    const loopbackDisabledAddress = loopbackDisabledByDefaultApp.server.address();
    if (!loopbackDisabledAddress || typeof loopbackDisabledAddress === "string") {
      throw new Error("expected tcp address");
    }
    const loopbackDisabledBaseUrl = `http://127.0.0.1:${loopbackDisabledAddress.port}`;
    try {
      const workspaceLoopback = `ws_bootstrap_loopback_${randomUUID().slice(0, 6)}`;
      const loopbackBootstrap = await requestJson(
        loopbackDisabledBaseUrl,
        "POST",
        "/v1/auth/bootstrap-owner",
        {
          workspace_id: workspaceLoopback,
          display_name: "Loopback Owner",
          passphrase: `pass_${workspaceLoopback}`,
        },
      );
      assert.equal(loopbackBootstrap.status, 403);
      assert.deepEqual(loopbackBootstrap.json, { error: "bootstrap_forbidden" });
    } finally {
      await loopbackDisabledByDefaultApp.close();
    }
  } finally {
    if (typeof prevAuthSessionSecret === "string") {
      process.env.AUTH_SESSION_SECRET = prevAuthSessionSecret;
    } else {
      delete process.env.AUTH_SESSION_SECRET;
    }
    if (typeof prevBootstrapAllowLoopback === "string") {
      process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK = prevBootstrapAllowLoopback;
    } else {
      delete process.env.AUTH_BOOTSTRAP_ALLOW_LOOPBACK;
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
