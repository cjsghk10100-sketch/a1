import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

    const a = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "DAC Room A", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    const b = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "DAC Room B", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    await postJson(
      baseUrl,
      "/v1/resources/labels",
      {
        resource_type: "artifact",
        resource_id: "art_test_1",
        label: "restricted",
        room_id: a.room_id,
        purpose_tags: ["timeline"],
      },
      workspaceHeader,
    );

    const denied = await postJson<{
      decision: string;
      reason_code: string;
      resolved_label: string;
    }>(
      baseUrl,
      "/v1/data/access/requests",
      {
        action: "data.read",
        resource_type: "artifact",
        resource_id: "art_test_1",
        room_id: b.room_id,
        purpose_tags: ["timeline"],
      },
      workspaceHeader,
    );
    assert.equal(denied.decision, "deny");
    assert.equal(denied.reason_code, "data_access_restricted_room_mismatch");
    assert.equal(denied.resolved_label, "restricted");

    const deniedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'data.access.denied'
         AND workspace_id = $1
         AND room_id = $2
         AND data->>'resource_id' = $3
       ORDER BY recorded_at DESC
       LIMIT 1`,
      ["ws_contract", b.room_id, "art_test_1"],
    );
    assert.equal(deniedEvent.rowCount, 1);

    await postJson(
      baseUrl,
      "/v1/resources/labels",
      {
        resource_type: "memory",
        resource_id: "mem_test_1",
        label: "confidential",
        purpose_tags: ["finance"],
      },
      workspaceHeader,
    );

    const mismatch = await postJson<{
      decision: string;
      reason_code: string;
      resolved_label: string;
    }>(
      baseUrl,
      "/v1/data/access/requests",
      {
        action: "data.read",
        resource_type: "memory",
        resource_id: "mem_test_1",
        room_id: a.room_id,
        purpose_tags: ["engineering"],
      },
      workspaceHeader,
    );
    assert.equal(mismatch.decision, "require_approval");
    assert.equal(mismatch.reason_code, "data_access_purpose_hint_mismatch");
    assert.equal(mismatch.resolved_label, "confidential");

    const mismatchEvents = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE workspace_id = $1
         AND room_id = $2
         AND event_type IN ('data.access.purpose_hint_mismatch', 'data.access.unjustified')
         AND data->>'resource_id' = $3
       ORDER BY recorded_at DESC
       LIMIT 2`,
      ["ws_contract", a.room_id, "mem_test_1"],
    );
    assert.equal(mismatchEvents.rowCount, 2);
    const mismatchTypes = new Set(mismatchEvents.rows.map((r) => r.event_type));
    assert.ok(mismatchTypes.has("data.access.purpose_hint_mismatch"));
    assert.ok(mismatchTypes.has("data.access.unjustified"));

    const justified = await postJson<{
      decision: string;
      reason_code: string;
    }>(
      baseUrl,
      "/v1/data/access/requests",
      {
        action: "data.read",
        resource_type: "memory",
        resource_id: "mem_test_1",
        room_id: a.room_id,
        purpose_tags: ["engineering"],
        justification: "Used for debugging a projection inconsistency.",
      },
      workspaceHeader,
    );
    assert.equal(justified.decision, "allow");

    const justifiedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'data.access.justified'
         AND room_id = $2
         AND data->>'resource_id' = $3
       ORDER BY recorded_at DESC
       LIMIT 1`,
      ["ws_contract", a.room_id, "mem_test_1"],
    );
    assert.equal(justifiedEvent.rowCount, 1);

    const principal_id = randomUUID();
    const grantor_id = randomUUID();
    await db.query(
      `INSERT INTO sec_principals (principal_id, principal_type)
       VALUES ($1, 'agent'), ($2, 'user')`,
      [principal_id, grantor_id],
    );

    const scopedToken = await postJson<{ token_id: string }>(
      baseUrl,
      "/v1/capabilities/grant",
      {
        issued_to_principal_id: principal_id,
        granted_by_principal_id: grantor_id,
        scopes: {
          rooms: [a.room_id],
          data_access: {
            read: ["resource_type:artifact"],
          },
        },
      },
      workspaceHeader,
    );

    const scopedAllow = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/data/access/requests",
      {
        action: "data.read",
        resource_type: "artifact",
        resource_id: "art_scoped_1",
        room_id: a.room_id,
        principal_id,
        capability_token_id: scopedToken.token_id,
      },
      workspaceHeader,
    );
    assert.equal(scopedAllow.decision, "allow");

    const scopedDeny = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/data/access/requests",
      {
        action: "data.read",
        resource_type: "memory",
        resource_id: "mem_scoped_1",
        room_id: a.room_id,
        principal_id,
        capability_token_id: scopedToken.token_id,
      },
      workspaceHeader,
    );
    assert.equal(scopedDeny.decision, "deny");
    assert.equal(scopedDeny.reason_code, "capability_scope_data_access_not_allowed");
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
