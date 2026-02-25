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

async function postJsonExpect<T>(
  baseUrl: string,
  urlPath: string,
  body: unknown,
  expectedStatus: number,
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
  if (res.status !== expectedStatus) {
    throw new Error(`POST ${urlPath} expected ${expectedStatus}, got ${res.status} ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function getJson<T>(
  baseUrl: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers: { ...(headers ?? {}) },
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

  const workspaceHeader = { "x-workspace-id": "ws_contract_incidents" };

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Incidents Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const { run_id } = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      {
        room_id,
        title: "Contract run for incident",
        goal: "validate incident workflow",
      },
      workspaceHeader,
    );

    const duplicateIdempotencyKey = `incident_dedupe_${Date.now()}`;
    const firstIdempotent = await postJson<{ incident_id: string; deduped: boolean }>(
      baseUrl,
      "/v1/incidents",
      {
        room_id,
        run_id,
        title: "Duplicate-safe incident",
        summary: "Same incident should dedupe",
        severity: "medium",
        idempotency_key: duplicateIdempotencyKey,
      },
      workspaceHeader,
    );
    assert.ok(firstIdempotent.incident_id.startsWith("inc_"));
    assert.equal(firstIdempotent.deduped, false);

    const secondIdempotent = await postJson<{ incident_id: string; deduped: boolean }>(
      baseUrl,
      "/v1/incidents",
      {
        room_id,
        run_id,
        title: "Duplicate-safe incident changed payload",
        summary: "This request should return same incident",
        severity: "high",
        idempotency_key: duplicateIdempotencyKey,
      },
      workspaceHeader,
    );
    assert.equal(secondIdempotent.incident_id, firstIdempotent.incident_id);
    assert.equal(secondIdempotent.deduped, true);

    const duplicateEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'incident.opened'
         AND idempotency_key = $2`,
      [workspaceHeader["x-workspace-id"], duplicateIdempotencyKey],
    );
    assert.equal(Number.parseInt(duplicateEvents.rows[0].count, 10), 1);

    const { incident_id, deduped } = await postJson<{ incident_id: string; deduped: boolean }>(
      baseUrl,
      "/v1/incidents",
      {
        room_id,
        run_id,
        title: "Tool call failed",
        summary: "Third-party API timeout",
        severity: "high",
      },
      workspaceHeader,
    );
    assert.ok(incident_id.startsWith("inc_"));
    assert.equal(deduped, false);

    const closeWithoutRca = await postJsonExpect<{ error: string }>(
      baseUrl,
      `/v1/incidents/${incident_id}/close`,
      {},
      409,
      workspaceHeader,
    );
    assert.equal(closeWithoutRca.error, "incident_close_blocked_missing_rca");

    await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/incidents/${incident_id}/rca`,
      {
        summary: "API provider degraded",
        analysis: {
          root_cause: "provider_timeout",
          five_whys: ["provider overloaded", "retry budget exhausted"],
        },
      },
      workspaceHeader,
    );

    const closeWithoutLearning = await postJsonExpect<{ error: string }>(
      baseUrl,
      `/v1/incidents/${incident_id}/close`,
      {},
      409,
      workspaceHeader,
    );
    assert.equal(closeWithoutLearning.error, "incident_close_blocked_missing_learning");

    const learning = await postJson<{ learning_id: string }>(
      baseUrl,
      `/v1/incidents/${incident_id}/learning`,
      {
        note: "Add fallback provider and tighten timeout budget",
        tags: ["fallback", "timeout"],
      },
      workspaceHeader,
    );
    assert.ok(learning.learning_id.startsWith("learn_"));

    const closeOk = await postJson<{ ok: boolean }>(
      baseUrl,
      `/v1/incidents/${incident_id}/close`,
      { reason: "RCA complete and corrective action logged" },
      workspaceHeader,
    );
    assert.equal(closeOk.ok, true);

    const detail = await getJson<{
      incident: {
        incident_id: string;
        status: string;
        learning_count: number;
        rca: Record<string, unknown>;
        closed_reason: string | null;
      };
      learning: Array<{ learning_id: string; note: string }>;
    }>(baseUrl, `/v1/incidents/${incident_id}`, workspaceHeader);

    assert.equal(detail.incident.incident_id, incident_id);
    assert.equal(detail.incident.status, "closed");
    assert.equal(detail.incident.learning_count, 1);
    assert.equal(detail.incident.closed_reason, "RCA complete and corrective action logged");
    assert.equal(detail.learning.length, 1);
    assert.equal(detail.learning[0].learning_id, learning.learning_id);
    assert.equal(
      detail.learning[0].note,
      "Add fallback provider and tighten timeout budget",
    );
    assert.equal(detail.incident.rca.summary, "API provider degraded");

    const incidentEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND data->>'incident_id' = $2
         AND event_type IN ('incident.opened', 'incident.rca.updated', 'incident.learning.logged', 'incident.closed')`,
      [workspaceHeader["x-workspace-id"], incident_id],
    );
    assert.equal(Number.parseInt(incidentEvents.rows[0].count, 10), 4);
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
