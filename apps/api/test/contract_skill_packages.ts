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

    const installed = await postJson<{
      skill_package_id: string;
      verification_status: string;
    }>(
      baseUrl,
      "/v1/skills/packages/install",
      {
        skill_id: "web_search_v2",
        version: "1.2.0",
        hash_sha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        signature: "sig_example",
        manifest: {
          required_tools: ["http_client"],
          data_access: { read: ["web"] },
          egress_domains: ["example.com"],
          sandbox_required: true,
        },
      },
      workspaceHeader,
    );
    assert.equal(installed.verification_status, "pending");

    const pendingRow = await db.query<{ verification_status: string }>(
      "SELECT verification_status FROM sec_skill_packages WHERE skill_package_id = $1",
      [installed.skill_package_id],
    );
    assert.equal(pendingRow.rowCount, 1);
    assert.equal(pendingRow.rows[0].verification_status, "pending");

    const installedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'skill.package.installed'
         AND data->>'skill_package_id' = $1`,
      [installed.skill_package_id],
    );
    assert.equal(installedEvent.rowCount, 1);

    const failingInstall = await postJson<{
      skill_package_id: string;
      verification_status: string;
    }>(
      baseUrl,
      "/v1/skills/packages/install",
      {
        skill_id: "web_search_bad",
        version: "1.2.1",
        hash_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        signature: "sig_bad",
        manifest: {
          required_tools: ["http_client"],
          data_access: { read: ["web"] },
          egress_domains: ["example.com"],
          sandbox_required: true,
        },
      },
      workspaceHeader,
    );
    assert.equal(failingInstall.verification_status, "pending");

    const failedVerify = await postJsonAny(
      baseUrl,
      `/v1/skills/packages/${encodeURIComponent(failingInstall.skill_package_id)}/verify`,
      {
        expected_hash_sha256:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      workspaceHeader,
    );
    assert.equal(failedVerify.status, 400);
    const failedVerifyJson = failedVerify.json as { error: string };
    assert.equal(failedVerifyJson.error, "hash_mismatch");

    const failedRow = await db.query<{
      verification_status: string;
      quarantine_reason: string | null;
    }>(
      "SELECT verification_status, quarantine_reason FROM sec_skill_packages WHERE skill_package_id = $1",
      [failingInstall.skill_package_id],
    );
    assert.equal(failedRow.rowCount, 1);
    assert.equal(failedRow.rows[0].verification_status, "quarantined");
    assert.equal(failedRow.rows[0].quarantine_reason, "verify_hash_mismatch");

    const autoQuarantinedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'skill.package.quarantined'
         AND data->>'skill_package_id' = $1`,
      [failingInstall.skill_package_id],
    );
    assert.equal(autoQuarantinedEvent.rowCount, 1);

    const verified = await postJson<{
      ok: boolean;
      verification_status: string;
    }>(
      baseUrl,
      `/v1/skills/packages/${encodeURIComponent(installed.skill_package_id)}/verify`,
      {
        expected_hash_sha256:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
      workspaceHeader,
    );
    assert.equal(verified.ok, true);
    assert.equal(verified.verification_status, "verified");

    const verifiedRow = await db.query<{
      verification_status: string;
      verified_at: string | null;
    }>(
      "SELECT verification_status, verified_at FROM sec_skill_packages WHERE skill_package_id = $1",
      [installed.skill_package_id],
    );
    assert.equal(verifiedRow.rowCount, 1);
    assert.equal(verifiedRow.rows[0].verification_status, "verified");
    assert.ok(verifiedRow.rows[0].verified_at !== null);

    const verifiedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'skill.package.verified'
         AND data->>'skill_package_id' = $1`,
      [installed.skill_package_id],
    );
    assert.equal(verifiedEvent.rowCount, 1);

    const quarantined = await postJson<{
      ok: boolean;
      verification_status: string;
    }>(
      baseUrl,
      `/v1/skills/packages/${encodeURIComponent(installed.skill_package_id)}/quarantine`,
      { reason: "manual_review_required" },
      workspaceHeader,
    );
    assert.equal(quarantined.ok, true);
    assert.equal(quarantined.verification_status, "quarantined");

    const quarantinedRow = await db.query<{
      verification_status: string;
      quarantine_reason: string | null;
    }>(
      "SELECT verification_status, quarantine_reason FROM sec_skill_packages WHERE skill_package_id = $1",
      [installed.skill_package_id],
    );
    assert.equal(quarantinedRow.rowCount, 1);
    assert.equal(quarantinedRow.rows[0].verification_status, "quarantined");
    assert.equal(quarantinedRow.rows[0].quarantine_reason, "manual_review_required");

    const quarantinedEvent = await db.query<{ event_type: string }>(
      `SELECT event_type
       FROM evt_events
       WHERE event_type = 'skill.package.quarantined'
         AND data->>'skill_package_id' = $1`,
      [installed.skill_package_id],
    );
    assert.equal(quarantinedEvent.rowCount, 1);

    const listed = await getJson<{ packages: Array<{ skill_package_id: string }> }>(
      baseUrl,
      "/v1/skills/packages?status=quarantined&limit=20",
      workspaceHeader,
    );
    assert.ok(listed.packages.some((pkg) => pkg.skill_package_id === installed.skill_package_id));
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
