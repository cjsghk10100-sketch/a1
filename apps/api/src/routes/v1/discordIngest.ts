import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  DiscordChannelMappingRowV1,
  DiscordChannelMappingUpsertV1,
  DiscordMessageIngestResultV1,
  DiscordMessageIngestV1,
  DiscordIngestedMessageRowV1,
} from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";

type MappingDbRow = {
  mapping_id: string;
  workspace_id: string;
  room_id: string;
  discord_guild_id: string | null;
  discord_channel_id: string;
  discord_thread_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type MessageDbRow = {
  ingest_id: string;
  workspace_id: string;
  room_id: string | null;
  discord_guild_id: string | null;
  discord_channel_id: string;
  discord_thread_id: string | null;
  discord_message_id: string;
  author_discord_id: string | null;
  author_name: string | null;
  content_raw: string;
  attachments: unknown;
  embeds: unknown;
  source: unknown;
  message_created_at: string | null;
  ingested_at: string;
};

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function parseLimit(raw: unknown, fallback = 100): number {
  const n = Number(raw ?? `${fallback}`);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length ? v : undefined;
}

function normalizeRequiredString(raw: unknown): string | null {
  const v = normalizeOptionalString(raw);
  return v ?? null;
}

function normalizeOptionalBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  return undefined;
}

function normalizeOptionalIso(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

function normalizeUnknownArray(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown[];
}

function normalizeUnknownObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function toMappingRow(row: MappingDbRow): DiscordChannelMappingRowV1 {
  return {
    mapping_id: row.mapping_id,
    workspace_id: row.workspace_id,
    room_id: row.room_id,
    discord_guild_id: row.discord_guild_id ?? undefined,
    discord_channel_id: row.discord_channel_id,
    discord_thread_id: row.discord_thread_id ?? undefined,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMessageRow(row: MessageDbRow): DiscordIngestedMessageRowV1 {
  return {
    ingest_id: row.ingest_id,
    workspace_id: row.workspace_id,
    room_id: row.room_id ?? undefined,
    discord_guild_id: row.discord_guild_id ?? undefined,
    discord_channel_id: row.discord_channel_id,
    discord_thread_id: row.discord_thread_id ?? undefined,
    discord_message_id: row.discord_message_id,
    author_discord_id: row.author_discord_id ?? undefined,
    author_name: row.author_name ?? undefined,
    content_raw: row.content_raw,
    attachments: Array.isArray(row.attachments) ? (row.attachments as unknown[]) : [],
    embeds: Array.isArray(row.embeds) ? (row.embeds as unknown[]) : [],
    source:
      row.source && typeof row.source === "object" && !Array.isArray(row.source)
        ? (row.source as Record<string, unknown>)
        : {},
    message_created_at: row.message_created_at ?? undefined,
    ingested_at: row.ingested_at,
  };
}

function newMappingId(): string {
  return `dmap_${randomUUID().replaceAll("-", "")}`;
}

function newIngestId(): string {
  return `dmsg_${randomUUID().replaceAll("-", "")}`;
}

async function loadMappingByChannel(
  pool: DbPool,
  workspace_id: string,
  discord_channel_id: string,
): Promise<MappingDbRow | null> {
  const res = await pool.query<MappingDbRow>(
    `SELECT
       mapping_id,
       workspace_id,
       room_id,
       discord_guild_id,
       discord_channel_id,
       discord_thread_id,
       is_active,
       created_at::text AS created_at,
       updated_at::text AS updated_at
     FROM integ_discord_channel_mappings
     WHERE workspace_id = $1
       AND discord_channel_id = $2
       AND is_active = TRUE
     ORDER BY updated_at DESC
     LIMIT 1`,
    [workspace_id, discord_channel_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

export async function registerDiscordIngestRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{
    Body: DiscordChannelMappingUpsertV1;
  }>("/v1/integrations/discord/channel-mappings", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeRequiredString(req.body.room_id);
    const discord_channel_id = normalizeRequiredString(req.body.discord_channel_id);
    if (!room_id) return reply.code(400).send({ error: "invalid_room_id" });
    if (!discord_channel_id) return reply.code(400).send({ error: "invalid_discord_channel_id" });

    const discord_guild_id = normalizeOptionalString(req.body.discord_guild_id) ?? null;
    const discord_thread_id = normalizeOptionalString(req.body.discord_thread_id) ?? null;
    const is_active = normalizeOptionalBoolean(req.body.is_active) ?? true;
    const now = new Date().toISOString();

    const mapped = await pool.query<MappingDbRow>(
      `INSERT INTO integ_discord_channel_mappings (
         mapping_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         is_active,
         created_at,
         updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$8
       )
       ON CONFLICT (workspace_id, discord_channel_id)
       DO UPDATE SET
         room_id = EXCLUDED.room_id,
         discord_guild_id = EXCLUDED.discord_guild_id,
         discord_thread_id = EXCLUDED.discord_thread_id,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at
       RETURNING
         mapping_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         is_active,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [newMappingId(), workspace_id, room_id, discord_guild_id, discord_channel_id, discord_thread_id, is_active, now],
    );

    const row = mapped.rows[0];
    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "discord.channel.mapped",
      event_version: 1,
      occurred_at: now,
      workspace_id,
      room_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "room", stream_id: room_id },
      correlation_id: randomUUID(),
      data: {
        mapping_id: row.mapping_id,
        room_id,
        discord_guild_id: row.discord_guild_id ?? undefined,
        discord_channel_id,
        discord_thread_id: row.discord_thread_id ?? undefined,
        is_active,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await pool.query(
      `UPDATE integ_discord_channel_mappings
       SET updated_at = $2
       WHERE mapping_id = $1`,
      [row.mapping_id, event.occurred_at],
    );

    return reply.code(201).send({ mapping: toMappingRow({ ...row, updated_at: event.occurred_at }) });
  });

  app.get<{
    Querystring: { room_id?: string; discord_channel_id?: string; is_active?: string; limit?: string };
  }>("/v1/integrations/discord/channel-mappings", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id);
    const discord_channel_id = normalizeOptionalString(req.query.discord_channel_id);
    const is_active =
      req.query.is_active === "true" ? true : req.query.is_active === "false" ? false : undefined;
    const limit = parseLimit(req.query.limit, 100);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    if (discord_channel_id) {
      args.push(discord_channel_id);
      where += ` AND discord_channel_id = $${args.length}`;
    }
    if (typeof is_active === "boolean") {
      args.push(is_active);
      where += ` AND is_active = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query<MappingDbRow>(
      `SELECT
         mapping_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         is_active,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM integ_discord_channel_mappings
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ mappings: rows.rows.map(toMappingRow) });
  });

  app.post<{
    Body: DiscordMessageIngestV1;
  }>("/v1/integrations/discord/messages/ingest", async (req, reply): Promise<DiscordMessageIngestResultV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const discord_message_id = normalizeRequiredString(req.body.discord_message_id);
    const discord_channel_id = normalizeRequiredString(req.body.discord_channel_id);
    const content_raw = normalizeRequiredString(req.body.content_raw);
    if (!discord_message_id) return reply.code(400).send({ error: "invalid_discord_message_id" });
    if (!discord_channel_id) return reply.code(400).send({ error: "invalid_discord_channel_id" });
    if (!content_raw) return reply.code(400).send({ error: "invalid_content_raw" });

    const mapping = await loadMappingByChannel(pool, workspace_id, discord_channel_id);
    const room_id = mapping?.room_id ?? null;
    const now = new Date().toISOString();
    const ingest_id = newIngestId();

    const inserted = await pool.query<MessageDbRow>(
      `INSERT INTO integ_discord_messages (
         ingest_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         discord_message_id,
         author_discord_id,
         author_name,
         content_raw,
         attachments,
         embeds,
         source,
         message_created_at,
         ingested_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15
       )
       ON CONFLICT (workspace_id, discord_message_id)
       DO NOTHING
       RETURNING
         ingest_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         discord_message_id,
         author_discord_id,
         author_name,
         content_raw,
         attachments,
         embeds,
         source,
         message_created_at::text AS message_created_at,
         ingested_at::text AS ingested_at`,
      [
        ingest_id,
        workspace_id,
        room_id,
        normalizeOptionalString(req.body.discord_guild_id) ?? null,
        discord_channel_id,
        normalizeOptionalString(req.body.discord_thread_id) ?? null,
        discord_message_id,
        normalizeOptionalString(req.body.author_discord_id) ?? null,
        normalizeOptionalString(req.body.author_name) ?? null,
        content_raw,
        JSON.stringify(normalizeUnknownArray(req.body.attachments)),
        JSON.stringify(normalizeUnknownArray(req.body.embeds)),
        JSON.stringify(normalizeUnknownObject(req.body.source)),
        normalizeOptionalIso(req.body.message_created_at) ?? null,
        now,
      ],
    );

    if (inserted.rowCount === 1) {
      const row = inserted.rows[0];
      const eventStream = row.room_id
        ? { stream_type: "room" as const, stream_id: row.room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

      await appendToStream(pool, {
        event_id: randomUUID(),
        event_type: "discord.message.ingested",
        event_version: 1,
        occurred_at: row.ingested_at,
        workspace_id,
        room_id: row.room_id ?? undefined,
        actor: { actor_type: "service", actor_id: "api" },
        stream: eventStream,
        correlation_id: randomUUID(),
        data: {
          ingest_id: row.ingest_id,
          room_id: row.room_id ?? undefined,
          discord_guild_id: row.discord_guild_id ?? undefined,
          discord_channel_id: row.discord_channel_id,
          discord_thread_id: row.discord_thread_id ?? undefined,
          discord_message_id: row.discord_message_id,
          deduped: false,
        },
        policy_context: {},
        model_context: {},
        display: {},
      });

      return reply.code(201).send({
        ingest_id: row.ingest_id,
        room_id: row.room_id ?? undefined,
        discord_message_id: row.discord_message_id,
        deduped: false,
      });
    }

    const existing = await pool.query<MessageDbRow>(
      `SELECT
         ingest_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         discord_message_id,
         author_discord_id,
         author_name,
         content_raw,
         attachments,
         embeds,
         source,
         message_created_at::text AS message_created_at,
         ingested_at::text AS ingested_at
       FROM integ_discord_messages
       WHERE workspace_id = $1
         AND discord_message_id = $2`,
      [workspace_id, discord_message_id],
    );

    if (existing.rowCount !== 1) {
      return reply.code(500).send({ error: "discord_ingest_dedupe_lookup_failed" });
    }

    const row = existing.rows[0];
    return reply.code(200).send({
      ingest_id: row.ingest_id,
      room_id: row.room_id ?? undefined,
      discord_message_id: row.discord_message_id,
      deduped: true,
    });
  });

  app.get<{
    Querystring: { room_id?: string; discord_channel_id?: string; limit?: string };
  }>("/v1/integrations/discord/messages", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const room_id = normalizeOptionalString(req.query.room_id);
    const discord_channel_id = normalizeOptionalString(req.query.discord_channel_id);
    const limit = parseLimit(req.query.limit, 100);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (room_id) {
      args.push(room_id);
      where += ` AND room_id = $${args.length}`;
    }
    if (discord_channel_id) {
      args.push(discord_channel_id);
      where += ` AND discord_channel_id = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query<MessageDbRow>(
      `SELECT
         ingest_id,
         workspace_id,
         room_id,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         discord_message_id,
         author_discord_id,
         author_name,
         content_raw,
         attachments,
         embeds,
         source,
         message_created_at::text AS message_created_at,
         ingested_at::text AS ingested_at
       FROM integ_discord_messages
       WHERE ${where}
       ORDER BY ingested_at DESC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ messages: rows.rows.map(toMessageRow) });
  });
}
