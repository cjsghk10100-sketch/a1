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
  delete process.env.POLICY_ENFORCEMENT_MODE;

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

    const beforeAudit = await db.query<{
      enforcement_mode: string | null;
      blocked: boolean | null;
    }>(
      `SELECT
         data->>'enforcement_mode' AS enforcement_mode,
         (data->>'blocked')::boolean AS blocked
       FROM evt_events
       WHERE event_type = 'policy.requires_approval'
         AND workspace_id = $1
         AND room_id = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      ["ws_contract", room_id],
    );
    assert.equal(beforeAudit.rowCount, 1);
    assert.equal(beforeAudit.rows[0].enforcement_mode, "shadow");
    assert.equal(beforeAudit.rows[0].blocked, false);

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

    const allowAuditCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE event_type IN ('policy.denied', 'policy.requires_approval')
         AND workspace_id = $1
         AND room_id = $2`,
      ["ws_contract", room_id],
    );
    assert.equal(Number.parseInt(allowAuditCount.rows[0].count, 10), 1);

    process.env.POLICY_KILL_SWITCH_EXTERNAL_WRITE = "1";
    const killed = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      { action: "external.write", actor_type: "user", actor_id: "ceo", room_id },
      workspaceHeader,
    );
    assert.equal(killed.decision, "deny");
    assert.equal(killed.reason_code, "kill_switch_active");

    const deniedAudit = await db.query<{
      enforcement_mode: string | null;
      blocked: boolean | null;
    }>(
      `SELECT
         data->>'enforcement_mode' AS enforcement_mode,
         (data->>'blocked')::boolean AS blocked
       FROM evt_events
       WHERE event_type = 'policy.denied'
         AND workspace_id = $1
         AND room_id = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      ["ws_contract", room_id],
    );
    assert.equal(deniedAudit.rowCount, 1);
    assert.equal(deniedAudit.rows[0].enforcement_mode, "shadow");
    assert.equal(deniedAudit.rows[0].blocked, false);
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
