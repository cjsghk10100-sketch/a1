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

  let json: unknown = {};
  if (text.length > 0) {
    json = JSON.parse(text);
  }
  return { status: res.status, json, text };
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  await applyMigrations(databaseUrl);

  const previousMasterKey = process.env.SECRETS_MASTER_KEY;
  delete process.env.SECRETS_MASTER_KEY;

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
    const runSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const workspaceHeader = { "x-workspace-id": `ws_contract_secrets_${runSuffix}` };
    const secretName = `github_token_${runSuffix}`;

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      {
        title: "Secrets Contract Room",
        room_mode: "default",
        default_lang: "en",
      },
      workspaceHeader,
    );
    assert.equal(roomRes.status, 201);
    const room_id = (roomRes.json as { room_id: string }).room_id;
    assert.ok(room_id.startsWith("room_"));

    const noKeyRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/secrets",
      { secret_name: "api_token", secret_value: "sk-local-disabled" },
      workspaceHeader,
    );
    assert.equal(noKeyRes.status, 501);
    assert.equal((noKeyRes.json as { error: string }).error, "secrets_vault_not_configured");

    process.env.SECRETS_MASTER_KEY = "local-dev-master-key-contract";

    const secretValue = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    const createRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/secrets",
      {
        secret_name: secretName,
        secret_value: secretValue,
        description: "token for local tests",
      },
      workspaceHeader,
    );
    assert.equal(createRes.status, 201);
    const created = createRes.json as {
      secret_id: string;
      secret_name: string;
      created: boolean;
      created_at: string;
      updated_at: string;
    };
    assert.equal(created.secret_name, secretName);
    assert.equal(created.created, true);
    assert.ok(created.secret_id.startsWith("sec_"));
    assert.ok(typeof created.created_at === "string");
    assert.ok(typeof created.updated_at === "string");
    assert.equal("secret_value" in (createRes.json as Record<string, unknown>), false);

    const listRes = await requestJson(baseUrl, "GET", "/v1/secrets?limit=10", undefined, workspaceHeader);
    assert.equal(listRes.status, 200);
    const listed = listRes.json as {
      secrets: Array<{
        secret_id: string;
        secret_name: string;
        algorithm: string;
      }>;
    };
    assert.equal(listed.secrets.length, 1);
    assert.equal(listed.secrets[0].secret_id, created.secret_id);
    assert.equal(listed.secrets[0].secret_name, secretName);
    assert.equal(listed.secrets[0].algorithm, "aes-256-gcm");
    assert.equal("secret_value" in (listed.secrets[0] as Record<string, unknown>), false);

    const userPrincipalId = randomUUID();
    const servicePrincipalId = randomUUID();
    await db.query("INSERT INTO sec_principals (principal_id, principal_type) VALUES ($1, 'user')", [
      userPrincipalId,
    ]);
    await db.query("INSERT INTO sec_principals (principal_id, principal_type) VALUES ($1, 'service')", [
      servicePrincipalId,
    ]);

    const deniedAccessRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/secrets/${encodeURIComponent(created.secret_id)}/access`,
      {
        actor_type: "user",
        actor_id: "tester",
        actor_principal_id: userPrincipalId,
      },
      workspaceHeader,
    );
    assert.equal(deniedAccessRes.status, 403);
    assert.equal((deniedAccessRes.json as { error: string }).error, "service_principal_required");

    const accessRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/secrets/${encodeURIComponent(created.secret_id)}/access`,
      {
        actor_type: "service",
        actor_id: "runtime",
        actor_principal_id: servicePrincipalId,
      },
      workspaceHeader,
    );
    assert.equal(accessRes.status, 200);
    const accessed = accessRes.json as {
      secret_id: string;
      secret_name: string;
      secret_value: string;
    };
    assert.equal(accessed.secret_id, created.secret_id);
    assert.equal(accessed.secret_name, secretName);
    assert.equal(accessed.secret_value, secretValue);

    const storedSecret = await db.query<{
      nonce_b64: string;
      ciphertext_b64: string;
      auth_tag_b64: string;
      last_accessed_at: string | null;
    }>(
      `SELECT nonce_b64, ciphertext_b64, auth_tag_b64, last_accessed_at
       FROM sec_secrets
       WHERE secret_id = $1`,
      [created.secret_id],
    );
    assert.equal(storedSecret.rowCount, 1);
    assert.notEqual(storedSecret.rows[0].ciphertext_b64, secretValue);
    assert.ok(storedSecret.rows[0].nonce_b64.length > 0);
    assert.ok(storedSecret.rows[0].auth_tag_b64.length > 0);
    assert.ok(storedSecret.rows[0].last_accessed_at !== null);

    const accessedEvent = await db.query<{ event_type: string; data_text: string }>(
      `SELECT event_type, data::text AS data_text
       FROM evt_events
       WHERE event_type = 'secret.accessed'
         AND data->>'secret_id' = $1`,
      [created.secret_id],
    );
    assert.equal(accessedEvent.rowCount, 1);
    assert.equal(accessedEvent.rows[0].event_type, "secret.accessed");
    assert.ok(!accessedEvent.rows[0].data_text.includes(secretValue));

    const threadRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/rooms/${encodeURIComponent(room_id)}/threads`,
      { title: "secret leak test" },
      workspaceHeader,
    );
    assert.equal(threadRes.status, 201);
    const thread_id = (threadRes.json as { thread_id: string }).thread_id;

    const leakedContent = "debug token ghp_abcdefghijklmnopqrstuvwxyz123456 should be flagged";
    const messageRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/threads/${encodeURIComponent(thread_id)}/messages`,
      {
        content_md: leakedContent,
        lang: "en",
      },
      workspaceHeader,
    );
    assert.equal(messageRes.status, 201);
    const message_id = (messageRes.json as { message_id: string }).message_id;

    const messageEvent = await db.query<{ event_id: string; contains_secrets: boolean; data_text: string }>(
      `SELECT event_id, contains_secrets, data::text AS data_text
       FROM evt_events
       WHERE event_type = 'message.created'
         AND data->>'message_id' = $1`,
      [message_id],
    );
    assert.equal(messageEvent.rowCount, 1);
    assert.equal(messageEvent.rows[0].contains_secrets, true);
    assert.ok(!messageEvent.rows[0].data_text.includes("ghp_abcdefghijklmnopqrstuvwxyz123456"));

    const eventRedactedEvent = await db.query<{ data_text: string }>(
      `SELECT data::text AS data_text
       FROM evt_events
       WHERE event_type = 'event.redacted'
         AND data->>'target_event_id' = $1`,
      [messageEvent.rows[0].event_id],
    );
    assert.equal(eventRedactedEvent.rowCount, 1);
    const redactedData = JSON.parse(eventRedactedEvent.rows[0].data_text) as {
      target_event_id?: string;
      intended_redaction_level?: string;
    };
    assert.equal(redactedData.target_event_id, messageEvent.rows[0].event_id);
    assert.equal(redactedData.intended_redaction_level, "partial");

    const leakDetectedEvent = await db.query<{ data_text: string }>(
      `SELECT data::text AS data_text
       FROM evt_events
       WHERE event_type = 'secret.leaked.detected'
         AND data->>'source_event_id' = $1`,
      [messageEvent.rows[0].event_id],
    );
    assert.equal(leakDetectedEvent.rowCount, 1);
    assert.ok(!leakDetectedEvent.rows[0].data_text.includes(leakedContent));

    const redactionFindings = await db.query<{ rule_id: string; action: string; match_preview: string }>(
      `SELECT rule_id, action, match_preview
       FROM sec_redaction_log
       WHERE event_id = $1
       ORDER BY created_at ASC`,
      [messageEvent.rows[0].event_id],
    );
    assert.ok((redactionFindings.rowCount ?? 0) >= 1);
    assert.ok(redactionFindings.rows.some((row) => row.rule_id === "github_pat"));
    assert.ok(redactionFindings.rows.every((row) => row.action === "shadow_flagged"));
    assert.ok(redactionFindings.rows.every((row) => !row.match_preview.includes("abcdefghijklmnopqrstuvwxyz")));

    const redactionApiRes = await requestJson(
      baseUrl,
      "GET",
      `/v1/audit/redactions?event_id=${encodeURIComponent(messageEvent.rows[0].event_id)}&limit=20`,
      undefined,
      workspaceHeader,
    );
    assert.equal(redactionApiRes.status, 200);
    const redactionApiPayload = redactionApiRes.json as {
      redactions: Array<{ event_id: string | null; rule_id: string; action: string }>;
    };
    assert.ok(redactionApiPayload.redactions.length >= 1);
    assert.ok(redactionApiPayload.redactions.every((row) => row.event_id === messageEvent.rows[0].event_id));
    assert.ok(redactionApiPayload.redactions.some((row) => row.rule_id === "github_pat"));
  } finally {
    if (previousMasterKey) {
      process.env.SECRETS_MASTER_KEY = previousMasterKey;
    } else {
      delete process.env.SECRETS_MASTER_KEY;
    }
    await db.end();
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
