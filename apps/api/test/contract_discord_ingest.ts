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
    const headers = { "x-workspace-id": "ws_contract_discord_ingest" };
    const runSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const guildId = `guild_${runSuffix}`;
    const channelId = `chan_${runSuffix}`;
    const messageId = `msg_${runSuffix}`;

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      {
        title: "Discord ingest room",
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
        discord_guild_id: guildId,
        discord_channel_id: channelId,
        is_active: true,
      },
      headers,
    );
    assert.equal(mapRes.status, 201);
    const mapping = mapRes.json as {
      mapping: { room_id: string; discord_channel_id: string; is_active: boolean };
    };
    assert.equal(mapping.mapping.room_id, room.room_id);
    assert.equal(mapping.mapping.discord_channel_id, channelId);
    assert.equal(mapping.mapping.is_active, true);

    const listMap = await requestJson(
      baseUrl,
      "GET",
      `/v1/integrations/discord/channel-mappings?discord_channel_id=${encodeURIComponent(channelId)}&limit=10`,
      undefined,
      headers,
    );
    assert.equal(listMap.status, 200);
    const mappingsPayload = listMap.json as {
      mappings: Array<{ room_id: string; discord_channel_id: string }>;
    };
    assert.equal(mappingsPayload.mappings.length, 1);
    assert.equal(mappingsPayload.mappings[0].room_id, room.room_id);

    const ingestRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/messages/ingest",
      {
        discord_message_id: messageId,
        discord_channel_id: channelId,
        discord_guild_id: guildId,
        author_discord_id: "user_100",
        author_name: "ceo",
        content_raw: "@event action=request_approval id=appr_1",
        attachments: [{ type: "file", name: "a.txt" }],
        embeds: [],
        source: { transport: "webhook-test" },
        message_created_at: "2026-02-20T00:00:00.000Z",
      },
      headers,
    );
    assert.equal(ingestRes.status, 201);
    const ingestBody = ingestRes.json as {
      ingest_id: string;
      room_id?: string;
      discord_message_id: string;
      deduped: boolean;
    };
    assert.equal(typeof ingestBody.ingest_id, "string");
    assert.equal(ingestBody.room_id, room.room_id);
    assert.equal(ingestBody.discord_message_id, messageId);
    assert.equal(ingestBody.deduped, false);

    const ingestDup = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/messages/ingest",
      {
        discord_message_id: messageId,
        discord_channel_id: channelId,
        content_raw: "duplicate",
      },
      headers,
    );
    assert.equal(ingestDup.status, 200);
    const ingestDupBody = ingestDup.json as {
      ingest_id: string;
      room_id?: string;
      discord_message_id: string;
      deduped: boolean;
    };
    assert.equal(ingestDupBody.ingest_id, ingestBody.ingest_id);
    assert.equal(ingestDupBody.room_id, room.room_id);
    assert.equal(ingestDupBody.discord_message_id, messageId);
    assert.equal(ingestDupBody.deduped, true);

    const listMessages = await requestJson(
      baseUrl,
      "GET",
      `/v1/integrations/discord/messages?discord_channel_id=${encodeURIComponent(channelId)}&limit=10`,
      undefined,
      headers,
    );
    assert.equal(listMessages.status, 200);
    const messagesPayload = listMessages.json as {
      messages: Array<{
        ingest_id: string;
        room_id?: string;
        discord_message_id: string;
        discord_channel_id: string;
      }>;
    };
    assert.equal(messagesPayload.messages.length, 1);
    assert.equal(messagesPayload.messages[0].ingest_id, ingestBody.ingest_id);
    assert.equal(messagesPayload.messages[0].room_id, room.room_id);
    assert.equal(messagesPayload.messages[0].discord_message_id, messageId);
    assert.equal(messagesPayload.messages[0].discord_channel_id, channelId);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
