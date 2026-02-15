import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { buildServer } from "../src/server.js";
import { createPool } from "../src/db/pool.js";

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

async function postJson<T>(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  delete process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE;

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

  try {
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Policy Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const before = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      { action: "external.write", actor_type: "user", actor_id: "ceo", room_id },
      workspaceHeader,
    );
    assert.equal(before.decision, "require_approval");
    assert.equal(before.reason_code, "external_write_requires_approval");

    const { approval_id } = await postJson<{ approval_id: string }>(
      baseUrl,
      "/v1/approvals",
      { action: "external.write", title: "Allow external write", room_id },
      workspaceHeader,
    );

    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/approvals/${approval_id}/decide`,
      { decision: "approve", scope: { type: "room", room_id } },
      workspaceHeader,
    );

    const after = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      { action: "external.write", actor_type: "user", actor_id: "ceo", room_id },
      workspaceHeader,
    );
    assert.equal(after.decision, "allow");
    assert.equal(after.reason_code, "approval_allows_action");

    process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE = "1";
    const killed = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      { action: "external.write", actor_type: "user", actor_id: "ceo", room_id },
      workspaceHeader,
    );
    assert.equal(killed.decision, "deny");
    assert.equal(killed.reason_code, "kill_switch_active");
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

