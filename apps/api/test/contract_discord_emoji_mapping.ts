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

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const headers = { "x-workspace-id": "ws_contract_discord_emoji" };
    const runSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const channelId = `chan_emoji_${runSuffix}`;
    const sourceMessageId = `discord_msg_src_${runSuffix}`;
    const reactionMessageId = `discord_msg_react_${runSuffix}`;

    const roomRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/rooms",
      {
        title: "Discord emoji room",
        room_mode: "ops",
        default_lang: "en",
      },
      headers,
    );
    assert.equal(roomRes.status, 201);
    const room = roomRes.json as { room_id: string };

    const approvalRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/approvals",
      {
        action: "external.write",
        title: "Approve outbound change",
        room_id: room.room_id,
      },
      headers,
    );
    assert.equal(approvalRes.status, 201);
    const approval = approvalRes.json as { approval_id: string };

    const mapRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/channel-mappings",
      {
        room_id: room.room_id,
        discord_channel_id: channelId,
      },
      headers,
    );
    assert.equal(mapRes.status, 201);

    const ingestRes = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/messages/ingest",
      {
        discord_message_id: sourceMessageId,
        discord_channel_id: channelId,
        content_raw: `@event action=request_approval approval_id=${approval.approval_id}`,
      },
      headers,
    );
    assert.equal(ingestRes.status, 201);

    const firstMap = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/emoji-decisions",
      {
        discord_message_id: reactionMessageId,
        reply_to_discord_message_id: sourceMessageId,
        emoji: "✅",
        actor_discord_id: "ceo_user_1",
        reason: "LGTM",
      },
      headers,
    );
    assert.equal(firstMap.status, 200);
    const firstBody = firstMap.json as {
      ok: boolean;
      deduped: boolean;
      approval_id: string;
      decision: string;
    };
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.deduped, false);
    assert.equal(firstBody.approval_id, approval.approval_id);
    assert.equal(firstBody.decision, "approve");

    const approvalDetail = await requestJson(
      baseUrl,
      "GET",
      `/v1/approvals/${encodeURIComponent(approval.approval_id)}`,
      undefined,
      headers,
    );
    assert.equal(approvalDetail.status, 200);
    const detail = approvalDetail.json as {
      approval: {
        status: string;
        decision: string | null;
        decided_by_id: string | null;
      };
    };
    assert.equal(detail.approval.status, "approved");
    assert.equal(detail.approval.decision, "approve");
    assert.equal(detail.approval.decided_by_id, "ceo_user_1");

    const secondMap = await requestJson(
      baseUrl,
      "POST",
      "/v1/integrations/discord/emoji-decisions",
      {
        discord_message_id: reactionMessageId,
        reply_to_discord_message_id: sourceMessageId,
        emoji: "✅",
      },
      headers,
    );
    assert.equal(secondMap.status, 200);
    const secondBody = secondMap.json as {
      ok: boolean;
      deduped: boolean;
      approval_id: string;
      decision: string;
    };
    assert.equal(secondBody.ok, true);
    assert.equal(secondBody.deduped, true);
    assert.equal(secondBody.approval_id, approval.approval_id);
    assert.equal(secondBody.decision, "approve");

    const decidedEvents = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evt_events
       WHERE workspace_id = $1
         AND event_type = 'approval.decided'
         AND data->>'approval_id' = $2`,
      [headers["x-workspace-id"], approval.approval_id],
    );
    assert.equal(Number.parseInt(decidedEvents.rows[0].count, 10), 1);
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
