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
  if (!address || typeof address === "string") throw new Error("expected TCP listener");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = { "x-workspace-id": "ws_contract_discord_parse" };

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      {
        title: "Discord parse room",
        room_mode: "ops",
        default_lang: "en",
      },
      headers,
    );
    assert.equal(roomRes.status, 201);
    const room = roomRes.json as { room_id: string };

    const mapRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/channel-mappings",
      {
        room_id: room.room_id,
        discord_guild_id: "guild_parse",
        discord_channel_id: "chan_parse",
      },
      headers,
    );
    assert.equal(mapRes.status, 201);

    const ingestRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/messages/ingest",
      {
        discord_message_id: "msg_parse_1",
        discord_channel_id: "chan_parse",
        content_raw: [
          "hello",
          "@event action=request_approval id=appr_parse_1",
          "@event action=approval.decided approval_id=appr_parse_1 decision=approve",
          "@event action=approval.decided approval_id=appr_parse_1 decision=maybe",
          "@event badtoken",
        ].join("\n"),
      },
      headers,
    );
    assert.equal(ingestRes.status, 201);
    const ingest = ingestRes.json as { ingest_id: string };

    const allEvents = await requestJson(
      baseUrl,
      "GET",
      `/v1/integrations/discord/event-lines?ingest_id=${encodeURIComponent(ingest.ingest_id)}&limit=20`,
      undefined,
      headers,
    );
    assert.equal(allEvents.status, 200);
    const allEventsBody = allEvents.json as {
      events: Array<{
        status: "valid" | "invalid";
        action?: string;
        parse_error?: string;
      }>;
    };
    assert.equal(allEventsBody.events.length, 4);
    assert.equal(allEventsBody.events.filter((e) => e.status === "valid").length, 2);
    assert.equal(allEventsBody.events.filter((e) => e.status === "invalid").length, 2);
    assert.ok(
      allEventsBody.events.some((e) => e.status === "invalid" && e.parse_error === "invalid_decision"),
    );
    assert.ok(
      allEventsBody.events.some((e) => e.status === "invalid" && e.parse_error === "invalid_token_format"),
    );

    const validEvents = await requestJson(
      baseUrl,
      "GET",
      `/v1/integrations/discord/event-lines?ingest_id=${encodeURIComponent(ingest.ingest_id)}&status=valid&limit=20`,
      undefined,
      headers,
    );
    assert.equal(validEvents.status, 200);
    const validBody = validEvents.json as {
      events: Array<{ status: "valid" | "invalid"; action?: string }>;
    };
    assert.equal(validBody.events.length, 2);
    assert.ok(validBody.events.every((e) => e.status === "valid"));
    assert.ok(validBody.events.some((e) => e.action === "approval.requested"));
    assert.ok(validBody.events.some((e) => e.action === "approval.decided"));

    const reparse = await requestJson(
      baseUrl,
      "POST",
      `/v1/integrations/discord/messages/${encodeURIComponent(ingest.ingest_id)}/parse-events`,
      {},
      headers,
    );
    assert.equal(reparse.status, 200);
    const reparseBody = reparse.json as {
      ingest_id: string;
      total_lines: number;
      inserted_count: number;
      deduped_count: number;
      valid_count: number;
      invalid_count: number;
    };
    assert.equal(reparseBody.ingest_id, ingest.ingest_id);
    assert.equal(reparseBody.total_lines, 4);
    assert.equal(reparseBody.inserted_count, 0);
    assert.equal(reparseBody.deduped_count, 4);
    assert.equal(reparseBody.valid_count, 2);
    assert.equal(reparseBody.invalid_count, 2);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
