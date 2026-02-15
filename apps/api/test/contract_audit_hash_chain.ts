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

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Hash Chain Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    // Two more room-scoped events.
    const { thread_id } = await postJson<{ thread_id: string }>(
      baseUrl,
      `/v1/rooms/${encodeURIComponent(room_id)}/threads`,
      { title: "t1" },
      workspaceHeader,
    );

    await postJson<{ message_id: string }>(
      baseUrl,
      `/v1/threads/${encodeURIComponent(thread_id)}/messages`,
      { content_md: "hello", lang: "en" },
      workspaceHeader,
    );

    const res = await db.query<{
      stream_seq: string;
      event_type: string;
      prev_event_hash: string | null;
      event_hash: string | null;
    }>(
      `SELECT stream_seq::text, event_type, prev_event_hash, event_hash
       FROM evt_events
       WHERE stream_type = 'room'
         AND stream_id = $1
       ORDER BY stream_seq ASC`,
      [room_id],
    );

    assert.ok((res.rowCount ?? 0) >= 3);

    const rows = res.rows.map((r) => ({
      stream_seq: Number(r.stream_seq),
      event_type: r.event_type,
      prev_event_hash: r.prev_event_hash,
      event_hash: r.event_hash,
    }));

    // All new events should have hashes.
    for (const r of rows) {
      assert.ok(Number.isFinite(r.stream_seq));
      assert.ok(typeof r.event_hash === "string" && r.event_hash.length > 0);
    }

    // Chain linkage within the stream.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      // When the previous event has a hash, the next should link to it.
      assert.equal(cur.prev_event_hash, prev.event_hash);
    }
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
