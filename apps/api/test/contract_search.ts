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

async function getJson<T>(baseUrl: string, urlPath: string, headers?: Record<string, string>): Promise<T> {
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
    const workspaceHeader = { "x-workspace-id": "ws_contract_search" };

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Search Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const { thread_id } = await postJson<{ thread_id: string }>(
      baseUrl,
      `/v1/rooms/${encodeURIComponent(room_id)}/threads`,
      { title: "General" },
      workspaceHeader,
    );

    const needle = `hello-search-${Date.now()}`;
    const { message_id } = await postJson<{ message_id: string }>(
      baseUrl,
      `/v1/threads/${encodeURIComponent(thread_id)}/messages`,
      { sender_type: "user", sender_id: "anon", content_md: `Needle ${needle}`, lang: "en" },
    );

    const results = await getJson<{
      docs: Array<{
        doc_id: string;
        doc_type: string;
        workspace_id: string;
        room_id: string | null;
        thread_id: string | null;
        content_text: string;
        lang: string;
        updated_at: string;
      }>;
    }>(
      baseUrl,
      `/v1/search?q=${encodeURIComponent(needle)}&room_id=${encodeURIComponent(room_id)}&limit=10`,
      workspaceHeader,
    );

    assert.equal(results.docs.length, 1);
    const doc = results.docs[0];
    assert.equal(doc.doc_type, "message");
    assert.equal(doc.doc_id, message_id);
    assert.equal(doc.workspace_id, "ws_contract_search");
    assert.equal(doc.room_id, room_id);
    assert.equal(doc.thread_id, thread_id);
    assert.equal(doc.lang, "en");
    assert.ok(doc.content_text.includes(needle));
    assert.ok(new Date(doc.updated_at).getTime() > 0);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
