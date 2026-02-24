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
    const appliedSet = new Set(applied.rows.map((row) => row.version));

    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
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

function readAccessToken(body: unknown): string {
  if (!body || typeof body !== "object") throw new Error("invalid_auth_payload");
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") throw new Error("invalid_auth_session");
  const access_token = (session as { access_token?: unknown }).access_token;
  if (typeof access_token !== "string" || !access_token.trim()) {
    throw new Error("missing_access_token");
  }
  return access_token;
}

async function waitForSseEvent<T>(
  url: string,
  headers: Record<string, string>,
  predicate: (ev: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        ...headers,
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`sse_open_failed:${res.status}`);
    if (!res.body) throw new Error("sse_body_missing");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice("data: ".length);
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const event = parsed as T;
          if (predicate(event)) {
            ac.abort(new Error("found"));
            return event;
          }
        }
      }
    }
    throw new Error("sse_closed_before_match");
  } catch (err) {
    if (ac.signal.aborted) {
      const reason = (ac.signal as unknown as { reason?: unknown }).reason;
      if (reason instanceof Error && reason.message === "timeout") {
        throw new Error("sse_timeout");
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
    config: {
      port: 0,
      databaseUrl,
      authRequireSession: true,
      authAllowLegacyWorkspaceHeader: false,
      authBootstrapAllowLoopback: true,
    },
    pool,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected_tcp_server_address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const workspaceId = `ws_cookie_stream_${randomUUID().slice(0, 8)}`;
    const passphrase = "cookie_stream_passphrase";
    const bootstrap = await requestJson(baseUrl, "POST", "/v1/auth/bootstrap-owner", {
      workspace_id: workspaceId,
      display_name: "Cookie Stream Owner",
      passphrase,
    });
    assert.equal(bootstrap.status, 201);
    const accessToken = readAccessToken(bootstrap.json);
    const authHeaders = { authorization: `Bearer ${accessToken}` };

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      {
        title: "Cookie Stream Room",
        room_mode: "default",
        default_lang: "en",
      },
      authHeaders,
    );
    assert.equal(roomRes.status, 201);
    const room_id = (roomRes.json as { room_id: string }).room_id;

    const threadRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/rooms/${room_id}/threads`,
      { title: "Cookie Stream Thread" },
      authHeaders,
    );
    assert.equal(threadRes.status, 201);
    const thread_id = (threadRes.json as { thread_id: string }).thread_id;

    const unauthorized = await fetch(`${baseUrl}/v1/streams/rooms/${room_id}?from_seq=0`, {
      headers: { accept: "text/event-stream" },
    });
    assert.equal(unauthorized.status, 401);

    const seqRes = await db.query<{ max_seq: string }>(
      "SELECT COALESCE(MAX(stream_seq), 0)::text AS max_seq FROM evt_events WHERE stream_type = 'room' AND stream_id = $1",
      [room_id],
    );
    const fromSeq = Number(seqRes.rows[0]?.max_seq ?? "0");

    const ssePromise = waitForSseEvent<{
      event_type: string;
      stream_seq: number;
      room_id: string | null;
      thread_id: string | null;
      data: { message_id?: string };
    }>(
      `${baseUrl}/v1/streams/rooms/${room_id}?from_seq=${fromSeq}`,
      {
        cookie: `agentapp_access_token=${encodeURIComponent(accessToken)}`,
      },
      (ev) => ev.event_type === "message.created",
      10_000,
    );

    const messageRes = await requestJson(
      baseUrl,
      "POST",
      `/v1/threads/${thread_id}/messages`,
      { content_md: "cookie-auth stream event", lang: "en" },
      authHeaders,
    );
    assert.equal(messageRes.status, 201);
    const message_id = (messageRes.json as { message_id: string }).message_id;

    const event = await ssePromise;
    assert.equal(event.event_type, "message.created");
    assert.equal(event.room_id, room_id);
    assert.equal(event.thread_id, thread_id);
    assert.equal(event.data.message_id, message_id);
    assert.ok(event.stream_seq > fromSeq);
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
