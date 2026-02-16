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

    const registered = await requestJson(
      baseUrl,
      "POST",
      "/v1/agents",
      { display_name: "Quarantine Agent" },
      workspaceHeader,
    );
    assert.equal(registered.status, 201);
    const agent = registered.json as { agent_id: string; principal_id: string };

    const quarantined = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/quarantine`,
      { quarantine_reason: "repeated_violations" },
      workspaceHeader,
    );
    assert.equal(quarantined.status, 200);

    const agentRow = await db.query<{ quarantined_at: string | null; quarantine_reason: string | null }>(
      `SELECT quarantined_at::text AS quarantined_at, quarantine_reason
       FROM sec_agents
       WHERE agent_id = $1`,
      [agent.agent_id],
    );
    assert.equal(agentRow.rowCount, 1);
    assert.ok(typeof agentRow.rows[0].quarantined_at === "string");
    assert.equal(agentRow.rows[0].quarantine_reason, "repeated_violations");

    const quarantineEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.quarantined'
         AND data->>'agent_id' = $1
       LIMIT 1`,
      [agent.agent_id],
    );
    assert.equal(quarantineEvent.rowCount, 1);

    const room = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      { title: "Quarantine Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );
    assert.equal(room.status, 201);
    const room_id = (room.json as { room_id: string }).room_id;

    const blocked = await requestJson(
      baseUrl,
      "POST",
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://example.com/data",
        method: "GET",
        room_id,
        principal_id: agent.principal_id,
      },
      workspaceHeader,
    );
    assert.equal(blocked.status, 201);
    const blockedJson = blocked.json as { decision: string; reason_code: string };
    assert.equal(blockedJson.decision, "deny");
    assert.equal(blockedJson.reason_code, "agent_quarantined");

    const unquarantined = await requestJson(
      baseUrl,
      "POST",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}/unquarantine`,
      {},
      workspaceHeader,
    );
    assert.equal(unquarantined.status, 200);

    const unquarantineEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.unquarantined'
         AND data->>'agent_id' = $1
       LIMIT 1`,
      [agent.agent_id],
    );
    assert.equal(unquarantineEvent.rowCount, 1);

    const allowed = await requestJson(
      baseUrl,
      "POST",
      "/v1/egress/requests",
      {
        action: "internal.read",
        target_url: "https://example.com/data",
        method: "GET",
        room_id,
        principal_id: agent.principal_id,
      },
      workspaceHeader,
    );
    assert.equal(allowed.status, 201);
    const allowedJson = allowed.json as { decision: string };
    assert.equal(allowedJson.decision, "allow");

    const getAgent = await requestJson(
      baseUrl,
      "GET",
      `/v1/agents/${encodeURIComponent(agent.agent_id)}`,
      undefined,
      workspaceHeader,
    );
    assert.equal(getAgent.status, 200);
    const agentRead = getAgent.json as { agent: { quarantined_at?: string } };
    assert.equal(agentRead.agent.quarantined_at, undefined);
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

