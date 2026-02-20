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

async function postJsonAny(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  return { status: res.status, json, text };
}

async function getJson<T>(
  baseUrl: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers: {
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${urlPath} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
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

    const issued_to_principal_id = randomUUID();
    const granted_by_principal_id = randomUUID();
    const rogue_grantor_principal_id = randomUUID();
    const delegated_issued_to_principal_id = randomUUID();

    await db.query(
      `INSERT INTO sec_principals (principal_id, principal_type)
       VALUES ($1, 'agent'), ($2, 'user'), ($3, 'user'), ($4, 'agent')`,
      [
        issued_to_principal_id,
        granted_by_principal_id,
        rogue_grantor_principal_id,
        delegated_issued_to_principal_id,
      ],
    );

    const grant = await postJson<{ token_id: string }>(
      baseUrl,
      "/v1/capabilities/grant",
      {
        issued_to_principal_id,
        granted_by_principal_id,
        scopes: { rooms: ["room_a", "room_b"], tools: ["web_search"] },
        valid_until: new Date(Date.now() + 60_000).toISOString(),
      },
      workspaceHeader,
    );

    assert.ok(grant.token_id);

    const row = await db.query<{ scopes: unknown; revoked_at: string | null }>(
      "SELECT scopes, revoked_at FROM sec_capability_tokens WHERE token_id = $1",
      [grant.token_id],
    );
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].revoked_at, null);

    const grantedEvent = await db.query<{ event_type: string }>(
      "SELECT event_type FROM evt_events WHERE event_type = 'agent.capability.granted' AND data->>'token_id' = $1",
      [grant.token_id],
    );
    assert.ok((grantedEvent.rowCount ?? 0) >= 1);

    const list = await getJson<{ tokens: Array<{ token_id: string }> }>(
      baseUrl,
      `/v1/capabilities?principal_id=${encodeURIComponent(issued_to_principal_id)}`,
      workspaceHeader,
    );
    assert.ok(list.tokens.some((t) => t.token_id === grant.token_id));

    const principalMismatch = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      {
        action: "internal.read",
        actor_type: "user",
        actor_id: "tester",
        principal_id: randomUUID(),
        capability_token_id: grant.token_id,
      },
      workspaceHeader,
    );
    assert.equal(principalMismatch.decision, "deny");
    assert.equal(principalMismatch.reason_code, "capability_token_principal_mismatch");

    const missingIssuedPrincipal = await postJsonAny(
      baseUrl,
      "/v1/capabilities/grant",
      {
        issued_to_principal_id: randomUUID(),
        granted_by_principal_id,
        scopes: { tools: ["web_search"] },
      },
      workspaceHeader,
    );
    assert.equal(missingIssuedPrincipal.status, 400);
    const missingIssuedPrincipalJson = missingIssuedPrincipal.json as { error: string };
    assert.equal(missingIssuedPrincipalJson.error, "issued_to_principal_not_found");

    const parentGrantorMismatch = await postJsonAny(
      baseUrl,
      "/v1/capabilities/grant",
      {
        issued_to_principal_id: delegated_issued_to_principal_id,
        granted_by_principal_id: rogue_grantor_principal_id,
        parent_token_id: grant.token_id,
        scopes: { tools: ["web_search"] },
      },
      workspaceHeader,
    );
    assert.equal(parentGrantorMismatch.status, 403);
    const parentGrantorMismatchJson = parentGrantorMismatch.json as { error: string };
    assert.equal(parentGrantorMismatchJson.error, "parent_token_grantor_mismatch");

    const mismatchEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.delegation.attempted'
         AND data->>'parent_token_id' = $1
         AND data->>'denied_reason' = 'parent_token_grantor_mismatch'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [grant.token_id],
    );
    assert.equal(mismatchEvent.rowCount, 1);

    const revoke = await postJson<{ ok: boolean }>(
      baseUrl,
      "/v1/capabilities/revoke",
      { token_id: grant.token_id, reason: "test" },
      workspaceHeader,
    );
    assert.equal(revoke.ok, true);

    const revokedDecision = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      {
        action: "internal.read",
        actor_type: "user",
        actor_id: "tester",
        principal_id: issued_to_principal_id,
        capability_token_id: grant.token_id,
      },
      workspaceHeader,
    );
    assert.equal(revokedDecision.decision, "deny");
    assert.equal(revokedDecision.reason_code, "capability_token_revoked");

    const revoked = await db.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM sec_capability_tokens WHERE token_id = $1",
      [grant.token_id],
    );
    assert.equal(revoked.rowCount, 1);
    assert.ok(revoked.rows[0].revoked_at !== null);

    const revokedEvent = await db.query<{ event_type: string }>(
      "SELECT event_type FROM evt_events WHERE event_type = 'agent.capability.revoked' AND data->>'token_id' = $1",
      [grant.token_id],
    );
    assert.ok((revokedEvent.rowCount ?? 0) >= 1);

    const expiredTokenId = randomUUID();
    await db.query(
      `INSERT INTO sec_capability_tokens (
         token_id, workspace_id, issued_to_principal_id, granted_by_principal_id, scopes, valid_until
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        expiredTokenId,
        workspaceHeader["x-workspace-id"],
        issued_to_principal_id,
        granted_by_principal_id,
        JSON.stringify({ action_types: ["internal.read"] }),
        new Date(Date.now() - 30_000).toISOString(),
      ],
    );

    const expiredDecision = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      {
        action: "internal.read",
        actor_type: "user",
        actor_id: "tester",
        principal_id: issued_to_principal_id,
        capability_token_id: expiredTokenId,
      },
      workspaceHeader,
    );
    assert.equal(expiredDecision.decision, "deny");
    assert.equal(expiredDecision.reason_code, "capability_token_expired");
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
