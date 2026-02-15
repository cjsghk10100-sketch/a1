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

async function waitForSseEvent<T>(
  url: string,
  predicate: (ev: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`SSE request failed: ${res.status}`);
    if (!res.body) throw new Error("SSE response has no body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      while (true) {
        const sep = buf.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice("data: ".length);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }

          const ev = parsed as T;
          if (predicate(ev)) {
            ac.abort(new Error("found"));
            return ev;
          }
        }
      }
    }

    throw new Error("SSE ended before the expected event");
  } catch (err) {
    // If we aborted because we found the event, we already returned.
    if (ac.signal.aborted) {
      const reason = (ac.signal as unknown as { reason?: unknown }).reason;
      if (reason instanceof Error && reason.message === "timeout") {
        throw new Error("SSE timed out");
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Contract Room", room_mode: "default", default_lang: "en" },
      { "x-workspace-id": "ws_contract" },
    );

    const { thread_id } = await postJson<{ thread_id: string }>(
      baseUrl,
      `/v1/rooms/${room_id}/threads`,
      { title: "Contract Thread" },
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const maxSeq = await client.query<{ max_seq: string }>(
        "SELECT COALESCE(MAX(stream_seq), 0)::text AS max_seq FROM evt_events WHERE stream_type = 'room' AND stream_id = $1",
        [room_id],
      );
      const fromSeq = Number(maxSeq.rows[0]?.max_seq ?? "0");
      assert.ok(Number.isFinite(fromSeq));

      const ssePromise = waitForSseEvent<{
        event_id: string;
        event_type: string;
        workspace_id: string;
        room_id: string | null;
        thread_id: string | null;
        stream_type: string;
        stream_id: string;
        stream_seq: number;
        correlation_id: string;
        causation_id: string | null;
        data: { message_id?: string };
      }>(
        `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${fromSeq}`,
        (ev) => ev.event_type === "message.created",
        10_000,
      );

      const { message_id } = await postJson<{ message_id: string }>(
        baseUrl,
        `/v1/threads/${thread_id}/messages`,
        { content_md: "hello", lang: "en" },
      );

      const ev = await ssePromise;

      assert.equal(ev.event_type, "message.created");
      assert.equal(ev.stream_type, "room");
      assert.equal(ev.stream_id, room_id);
      assert.equal(ev.room_id, room_id);
      assert.equal(ev.thread_id, thread_id);
      assert.equal(ev.data.message_id, message_id);
      assert.notEqual(ev.event_id, message_id);
      assert.ok(message_id.startsWith("msg_"));
      assert.ok(ev.correlation_id.length > 0);
      assert.equal(ev.causation_id, null);

      const row = await client.query<{ message_id: string; last_event_id: string }>(
        "SELECT message_id, last_event_id FROM proj_messages WHERE message_id = $1",
        [message_id],
      );
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0].message_id, message_id);
      assert.equal(row.rows[0].last_event_id, ev.event_id);
    } finally {
      await client.end();
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
