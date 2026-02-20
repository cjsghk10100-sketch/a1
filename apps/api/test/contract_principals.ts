import assert from "node:assert/strict";
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
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const firstUser = await requestJson(
      baseUrl,
      "POST",
      "/v1/principals/legacy/ensure",
      { actor_type: "user", actor_id: "anon" },
      workspaceHeader,
    );
    assert.equal(firstUser.status, 200);
    const userPrincipal = firstUser.json as {
      principal: { principal_id: string; principal_type: string; legacy_actor_type: string; legacy_actor_id: string };
    };
    assert.ok(userPrincipal.principal.principal_id.length > 0);
    assert.equal(userPrincipal.principal.principal_type, "user");
    assert.equal(userPrincipal.principal.legacy_actor_type, "user");
    assert.equal(userPrincipal.principal.legacy_actor_id, "anon");

    const secondUser = await requestJson(
      baseUrl,
      "POST",
      "/v1/principals/legacy/ensure",
      { actor_type: "user", actor_id: "anon" },
      workspaceHeader,
    );
    assert.equal(secondUser.status, 200);
    const userPrincipal2 = secondUser.json as {
      principal: { principal_id: string };
    };
    assert.equal(userPrincipal2.principal.principal_id, userPrincipal.principal.principal_id);

    const service = await requestJson(
      baseUrl,
      "POST",
      "/v1/principals/legacy/ensure",
      { actor_type: "service", actor_id: "api" },
      workspaceHeader,
    );
    assert.equal(service.status, 200);
    const servicePrincipal = service.json as {
      principal: { principal_id: string; principal_type: string; legacy_actor_type: string; legacy_actor_id: string };
    };
    assert.ok(servicePrincipal.principal.principal_id.length > 0);
    assert.equal(servicePrincipal.principal.principal_type, "service");
    assert.equal(servicePrincipal.principal.legacy_actor_type, "service");
    assert.equal(servicePrincipal.principal.legacy_actor_id, "api");

    const agent = await requestJson(
      baseUrl,
      "POST",
      "/v1/principals/legacy/ensure",
      { actor_type: "agent", actor_id: "agt_contract" },
      workspaceHeader,
    );
    assert.equal(agent.status, 200);
    const agentPrincipal = agent.json as {
      principal: { principal_id: string; principal_type: string; legacy_actor_type: string; legacy_actor_id: string };
    };
    assert.ok(agentPrincipal.principal.principal_id.length > 0);
    assert.equal(agentPrincipal.principal.principal_type, "agent");
    assert.equal(agentPrincipal.principal.legacy_actor_type, "agent");
    assert.equal(agentPrincipal.principal.legacy_actor_id, "agt_contract");

    const agent2 = await requestJson(
      baseUrl,
      "POST",
      "/v1/principals/legacy/ensure",
      { actor_type: "agent", actor_id: "agt_contract" },
      workspaceHeader,
    );
    assert.equal(agent2.status, 200);
    const agentPrincipal2 = agent2.json as {
      principal: { principal_id: string };
    };
    assert.equal(agentPrincipal2.principal.principal_id, agentPrincipal.principal.principal_id);

    const rows = await db.query<{ principal_type: string }>(
      `SELECT principal_type
       FROM sec_principals
       WHERE principal_id = $1`,
      [userPrincipal.principal.principal_id],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].principal_type, "user");
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
