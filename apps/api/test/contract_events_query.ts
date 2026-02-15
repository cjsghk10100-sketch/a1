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

  try {
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Events Query Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const { run_id } = await postJson<{ run_id: string }>(
      baseUrl,
      "/v1/runs",
      { room_id, title: "Events Query Run" },
      workspaceHeader,
    );

    await postJson<{ ok: boolean }>(baseUrl, `/v1/runs/${run_id}/start`, {}, workspaceHeader);

    const { step_id } = await postJson<{ step_id: string }>(
      baseUrl,
      `/v1/runs/${run_id}/steps`,
      { kind: "tool", title: "Events Query Step" },
      workspaceHeader,
    );

    const runEvents = await getJson<{
      events: Array<{
        event_id: string;
        event_type: string;
        run_id: string | null;
        step_id: string | null;
        correlation_id: string;
        causation_id: string | null;
        stream_seq: number;
        data: { run_id?: string; step_id?: string };
      }>;
    }>(baseUrl, `/v1/events?run_id=${encodeURIComponent(run_id)}`, workspaceHeader);

    assert.equal(runEvents.events.length >= 3, true);

    const created = runEvents.events.find((e) => e.event_type === "run.created");
    const started = runEvents.events.find((e) => e.event_type === "run.started");
    const stepCreated = runEvents.events.find((e) => e.event_type === "step.created");

    assert.ok(created);
    assert.ok(started);
    assert.ok(stepCreated);

    assert.equal(created.run_id, run_id);
    assert.equal(created.data.run_id, run_id);
    assert.notEqual(created.event_id, run_id);

    assert.equal(started.run_id, run_id);
    assert.equal(started.data.run_id, run_id);
    assert.equal(started.correlation_id, created.correlation_id);
    assert.equal(started.causation_id, created.event_id);

    assert.equal(stepCreated.run_id, run_id);
    assert.equal(stepCreated.step_id, step_id);
    assert.equal(stepCreated.data.step_id, step_id);
    assert.notEqual(stepCreated.event_id, step_id);
    assert.equal(stepCreated.correlation_id, created.correlation_id);
    assert.equal(stepCreated.causation_id, started.event_id);

    // Correlation query should include the same chain.
    const corrEvents = await getJson<{
      events: Array<{ event_id: string; event_type: string; correlation_id: string }>;
    }>(
      baseUrl,
      `/v1/events?correlation_id=${encodeURIComponent(created.correlation_id)}`,
      workspaceHeader,
    );

    const corrTypes = new Set(corrEvents.events.map((e) => e.event_type));
    assert.ok(corrTypes.has("run.created"));
    assert.ok(corrTypes.has("run.started"));
    assert.ok(corrTypes.has("step.created"));

    // Detail endpoint returns a single event.
    const detail = await getJson<{
      event: { event_id: string; event_type: string; correlation_id: string; data: unknown };
    }>(baseUrl, `/v1/events/${encodeURIComponent(stepCreated.event_id)}`, workspaceHeader);

    assert.equal(detail.event.event_id, stepCreated.event_id);
    assert.equal(detail.event.event_type, "step.created");
    assert.equal(detail.event.correlation_id, created.correlation_id);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

