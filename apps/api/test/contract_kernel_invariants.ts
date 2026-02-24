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
      while (true) {
        const sep = buf.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line.slice("data: ".length));
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

    throw new Error("SSE ended before expected event");
  } catch (err) {
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
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const workspaceHeader = { "x-workspace-id": "ws_contract" };

    const { room_id } = await postJson<{ room_id: string }>(
      baseUrl,
      "/v1/rooms",
      { title: "Kernel Contract Room", room_mode: "default", default_lang: "en" },
      workspaceHeader,
    );

    const policy = await postJson<{ decision: string; reason_code: string }>(
      baseUrl,
      "/v1/policy/evaluate",
      { action: "external.write", actor_type: "user", actor_id: "ceo", room_id },
      workspaceHeader,
    );
    assert.equal(policy.decision, "require_approval");
    assert.equal(policy.reason_code, "external_write_requires_approval");

    const { thread_id } = await postJson<{ thread_id: string }>(
      baseUrl,
      `/v1/rooms/${encodeURIComponent(room_id)}/threads`,
      { title: "kernel-thread" },
      workspaceHeader,
    );

    const maxSeq = await db.query<{ max_seq: string }>(
      `SELECT COALESCE(MAX(stream_seq), 0)::text AS max_seq
       FROM evt_events
       WHERE stream_type = 'room'
         AND stream_id = $1`,
      [room_id],
    );
    const startSeq = Number(maxSeq.rows[0]?.max_seq ?? "0");
    assert.ok(Number.isFinite(startSeq));

    const firstMessagePromise = waitForSseEvent<{
      event_id: string;
      event_type: string;
      stream_seq: number;
      data: { message_id?: string };
    }>(
      `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${startSeq}`,
      (ev) => ev.event_type === "message.created",
      10_000,
    );

    const firstMessage = await postJson<{ message_id: string }>(
      baseUrl,
      `/v1/threads/${encodeURIComponent(thread_id)}/messages`,
      { content_md: "kernel invariant check", lang: "en" },
      workspaceHeader,
    );
    const firstEvent = await firstMessagePromise;
    assert.equal(firstEvent.data.message_id, firstMessage.message_id);
    assert.ok(firstEvent.stream_seq > startSeq);

    const secondMessagePromise = waitForSseEvent<{
      event_id: string;
      event_type: string;
      stream_seq: number;
      data: { message_id?: string };
    }>(
      `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${firstEvent.stream_seq}`,
      (ev) => ev.event_type === "message.created",
      10_000,
    );

    const leakedValue = "Bearer ghp_abcdefghijklmnopqrstuvwxyz123456";
    const secondMessage = await postJson<{ message_id: string }>(
      baseUrl,
      `/v1/threads/${encodeURIComponent(thread_id)}/messages`,
      { content_md: `sensitive payload ${leakedValue}`, lang: "en" },
      workspaceHeader,
    );
    const secondEvent = await secondMessagePromise;
    assert.equal(secondEvent.data.message_id, secondMessage.message_id);
    assert.ok(secondEvent.stream_seq > firstEvent.stream_seq);

    const appendOnlyTarget = await db.query<{ event_id: string }>(
      `SELECT event_id
       FROM evt_events
       WHERE stream_type = 'room'
         AND stream_id = $1
       ORDER BY stream_seq ASC
       LIMIT 1`,
      [room_id],
    );
    assert.equal(appendOnlyTarget.rowCount, 1);

    let appendOnlyErr: unknown = null;
    try {
      await db.query(
        `UPDATE evt_events
         SET event_type = 'mutated.event'
         WHERE event_id = $1`,
        [appendOnlyTarget.rows[0].event_id],
      );
    } catch (err) {
      appendOnlyErr = err;
    }
    assert.ok(appendOnlyErr instanceof Error, "expected append-only update to fail");
    const pgErr = appendOnlyErr as Error & { code?: string; message: string };
    assert.ok(
      pgErr.code === "P0001" || pgErr.message.toLowerCase().includes("append-only"),
      `unexpected append-only error: ${pgErr.code ?? "no_code"} ${pgErr.message}`,
    );

    const messageEvent = await db.query<{
      event_id: string;
      contains_secrets: boolean;
      data_text: string;
    }>(
      `SELECT event_id, contains_secrets, data::text AS data_text
       FROM evt_events
       WHERE event_type = 'message.created'
         AND data->>'message_id' = $1`,
      [secondMessage.message_id],
    );
    assert.equal(messageEvent.rowCount, 1);
    assert.equal(messageEvent.rows[0].contains_secrets, true);
    assert.ok(!messageEvent.rows[0].data_text.includes("ghp_abcdefghijklmnopqrstuvwxyz123456"));

    const redactedEvent = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type = 'event.redacted'
         AND data->>'target_event_id' = $1`,
      [messageEvent.rows[0].event_id],
    );
    assert.ok(Number(redactedEvent.rows[0]?.count ?? "0") >= 1);

    const leakedDetected = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM evt_events
       WHERE event_type = 'secret.leaked.detected'
         AND data->>'source_event_id' = $1`,
      [messageEvent.rows[0].event_id],
    );
    assert.ok(Number(leakedDetected.rows[0]?.count ?? "0") >= 1);

    const redactionLog = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM sec_redaction_log
       WHERE event_id = $1`,
      [messageEvent.rows[0].event_id],
    );
    assert.ok(Number(redactionLog.rows[0]?.count ?? "0") >= 1);
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
