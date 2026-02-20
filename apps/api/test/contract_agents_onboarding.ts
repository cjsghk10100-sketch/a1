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

    const registered = await postJson<{ agent_id: string; principal_id: string }>(
      baseUrl,
      "/v1/agents",
      { display_name: "Imported Agent" },
      workspaceHeader,
    );
    assert.ok(registered.agent_id.startsWith("agt_"));
    assert.ok(registered.principal_id.length > 0);

    const inventory = {
      packages: [
        {
          skill_id: "skill.good.verified",
          version: "1.0.0",
          hash_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          signature: "sig_v1",
          manifest: {
            required_tools: ["http_client"],
            data_access: { read: ["web"] },
            egress_domains: ["example.com"],
            sandbox_required: true,
          },
        },
        {
          skill_id: "skill.bad.missing_manifest",
          version: "1.0.0",
          hash_sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          skill_id: "skill.pending.no_signature",
          version: "1.0.0",
          hash_sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          manifest: {
            required_tools: ["fs_reader"],
            data_access: { read: ["artifacts"] },
            egress_domains: [],
            sandbox_required: true,
          },
        },
      ],
    };

    const imported = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
      items: Array<{ skill_id: string; status: string; skill_package_id: string }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/import`,
      inventory,
      workspaceHeader,
    );
    assert.equal(imported.summary.total, 3);
    assert.equal(imported.summary.verified, 1);
    assert.equal(imported.summary.pending, 1);
    assert.equal(imported.summary.quarantined, 1);

    const importedAgain = await postJson<{
      summary: { total: number; verified: number; pending: number; quarantined: number };
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/import`,
      inventory,
      workspaceHeader,
    );
    assert.equal(importedAgain.summary.total, 3);
    assert.equal(importedAgain.summary.verified, 1);
    assert.equal(importedAgain.summary.pending, 1);
    assert.equal(importedAgain.summary.quarantined, 1);

    const pendingImported = imported.items.find((item) => item.status === "pending");
    assert.ok(pendingImported);

    const reviewed = await postJson<{
      summary: { total: number; verified: number; quarantined: number };
      items: Array<{
        skill_package_id: string;
        skill_id: string;
        status: string;
        reason?: string;
      }>;
    }>(
      baseUrl,
      `/v1/agents/${encodeURIComponent(registered.agent_id)}/skills/review-pending`,
      {},
      workspaceHeader,
    );
    assert.equal(reviewed.summary.total, 1);
    assert.equal(reviewed.summary.verified, 0);
    assert.equal(reviewed.summary.quarantined, 1);
    assert.equal(reviewed.items.length, 1);
    assert.equal(reviewed.items[0].skill_package_id, pendingImported?.skill_package_id);
    assert.equal(reviewed.items[0].status, "quarantined");
    assert.equal(reviewed.items[0].reason, "verify_signature_required");

    const agentRow = await db.query<{ principal_id: string }>(
      "SELECT principal_id FROM sec_agents WHERE agent_id = $1",
      [registered.agent_id],
    );
    assert.equal(agentRow.rowCount, 1);
    assert.equal(agentRow.rows[0].principal_id, registered.principal_id);

    const principalRow = await db.query<{ principal_type: string }>(
      "SELECT principal_type FROM sec_principals WHERE principal_id = $1",
      [registered.principal_id],
    );
    assert.equal(principalRow.rowCount, 1);
    assert.equal(principalRow.rows[0].principal_type, "agent");

    const linkRows = await db.query<{ verification_status: string }>(
      `SELECT verification_status
       FROM sec_agent_skill_packages
       WHERE agent_id = $1`,
      [registered.agent_id],
    );
    assert.equal(linkRows.rowCount, 3);
    assert.ok(linkRows.rows.some((r) => r.verification_status === "verified"));
    assert.ok(!linkRows.rows.some((r) => r.verification_status === "pending"));
    assert.equal(
      linkRows.rows.filter((r) => r.verification_status === "quarantined").length,
      2,
    );

    const registeredEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.registered'
         AND data->>'agent_id' = $1`,
      [registered.agent_id],
    );
    assert.equal(registeredEvent.rowCount, 1);

    const importedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'agent.skills.imported'
         AND data->>'agent_id' = $1`,
      [registered.agent_id],
    );
    assert.equal(importedEvent.rowCount, 2);
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
