import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type {
  DiscordChannelMappingRowV1,
  DiscordChannelMappingUpsertV1,
  DiscordEmojiDecisionMapResultV1,
  DiscordEmojiDecisionMapV1,
  DiscordParseEventLinesResultV1,
  DiscordParsedEventRowV1,
  DiscordParsedEventStatus,
  DiscordMessageIngestResultV1,
  DiscordMessageIngestV1,
  DiscordIngestedMessageRowV1,
} from "@agentapp/shared";
import { ApprovalDecision, type ApprovalEventV1 } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";
import { applyApprovalEvent } from "../../projectors/approvalProjector.js";

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

type ParsedEventDbRow = {
  parsed_event_id: string;
  workspace_id: string;
  ingest_id: string;
  discord_message_id: string;
  line_index: number;
  line_raw: string;
  action: string | null;
  payload: unknown;
  status: DiscordParsedEventStatus;
  parse_error: string | null;
  created_at: string;
};

type ParsedEventLineCandidate = {
  line_index: number;
  line_raw: string;
  action?: string;
  payload: Record<string, unknown>;
  status: DiscordParsedEventStatus;
  parse_error?: string;
};

type ApprovalLookupRow = {
  workspace_id: string;
  room_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  step_id: string | null;
  correlation_id: string;
  last_event_id: string | null;
};

type EmojiDecisionDbRow = {
  decision_map_id: string;
  workspace_id: string;
  discord_message_id: string;
  reply_to_discord_message_id: string;
  approval_id: string;
  emoji: string;
  mapped_decision: ApprovalDecision;
  actor_discord_id: string | null;
  actor_name: string | null;
  reason: string | null;
  correlation_id: string;
  event_id: string | null;
  created_at: string;
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

function toParsedEventRow(row: ParsedEventDbRow): DiscordParsedEventRowV1 {
  return {
    parsed_event_id: row.parsed_event_id,
    workspace_id: row.workspace_id,
    ingest_id: row.ingest_id,
    discord_message_id: row.discord_message_id,
    line_index: row.line_index,
    line_raw: row.line_raw,
    action: row.action ?? undefined,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    status: row.status,
    parse_error: row.parse_error ?? undefined,
    created_at: row.created_at,
  };
}

function splitTokens(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return matches ?? [];
}

function unquote(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }
  return input;
}

function normalizeEventAction(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "request_approval") return "approval.requested";
  if (v === "decide_approval") return "approval.decided";
  return v;
}

function normalizeDecision(raw: string | undefined): "approve" | "deny" | "hold" | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "approve" || v === "approved" || v === "yes" || v === "y") return "approve";
  if (v === "deny" || v === "denied" || v === "no" || v === "n" || v === "reject" || v === "rejected") {
    return "deny";
  }
  if (v === "hold" || v === "pending") return "hold";
  return undefined;
}

function normalizeEmojiDecision(raw: string | undefined): ApprovalDecision | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "✅" || v === "✔️" || v === "☑️" || v === ":white_check_mark:" || v === "white_check_mark") {
    return ApprovalDecision.Approve;
  }
  if (v === "❌" || v === "✖️" || v === "🚫" || v === "⛔" || v === ":x:" || v === "x") {
    return ApprovalDecision.Deny;
  }
  if (v === "🟨" || v === "🟡" || v === "⏸️" || v === ":yellow_square:" || v === "yellow_square") {
    return ApprovalDecision.Hold;
  }
  return undefined;
}

function parseEventLine(line_raw: string, line_index: number): ParsedEventLineCandidate {
  const trimmed = line_raw.trim();
  const tokens = splitTokens(trimmed);
  if (tokens.length === 0 || tokens[0] !== "@event") {
    return {
      line_index,
      line_raw,
      payload: {},
      status: "invalid",
      parse_error: "invalid_event_prefix",
    };
  }

  const payload: Record<string, unknown> = {};
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf("=");
    if (eq <= 0 || eq === token.length - 1) {
      return {
        line_index,
        line_raw,
        payload: {},
        status: "invalid",
        parse_error: "invalid_token_format",
      };
    }
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = unquote(token.slice(eq + 1).trim());
    if (!key) {
      return {
        line_index,
        line_raw,
        payload: {},
        status: "invalid",
        parse_error: "invalid_token_key",
      };
    }
    payload[key] = value;
  }

  const action = normalizeEventAction(
    (payload.action as string | undefined) ?? (payload.type as string | undefined),
  );
  if (!action) {
    return {
      line_index,
      line_raw,
      payload,
      status: "invalid",
      parse_error: "missing_action",
    };
  }

  if (action === "approval.requested") {
    const approval_id =
      normalizeOptionalString(payload.approval_id) ?? normalizeOptionalString(payload.id);
    if (!approval_id) {
      return {
        line_index,
        line_raw,
        action,
        payload,
        status: "invalid",
        parse_error: "missing_approval_id",
      };
    }
    return {
      line_index,
      line_raw,
      action,
      payload: {
        ...payload,
        action,
        approval_id,
      },
      status: "valid",
    };
  }

  if (action === "approval.decided") {
    const approval_id =
      normalizeOptionalString(payload.approval_id) ?? normalizeOptionalString(payload.id);
    const decision = normalizeDecision(
      normalizeOptionalString(payload.decision) ?? normalizeOptionalString(payload.state),
    );
    if (!approval_id) {
      return {
        line_index,
        line_raw,
        action,
        payload,
        status: "invalid",
        parse_error: "missing_approval_id",
      };
    }
    if (!decision) {
      return {
        line_index,
        line_raw,
        action,
        payload,
        status: "invalid",
        parse_error: "invalid_decision",
      };
    }
    return {
      line_index,
      line_raw,
      action,
      payload: {
        ...payload,
        action,
        approval_id,
        decision,
      },
      status: "valid",
    };
  }

  return {
    line_index,
    line_raw,
    action,
    payload,
    status: "invalid",
    parse_error: "unsupported_action",
  };
}

function extractParsedEventLines(content_raw: string): ParsedEventLineCandidate[] {
  const out: ParsedEventLineCandidate[] = [];
  const lines = content_raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("@event")) continue;
    out.push(parseEventLine(line, i));
  }
  return out;
}

function newMappingId(): string {
  return `dmap_${randomUUID().replaceAll("-", "")}`;
}

function newIngestId(): string {
  return `dmsg_${randomUUID().replaceAll("-", "")}`;
}

function newParsedEventId(): string {
  return `devt_${randomUUID().replaceAll("-", "")}`;
}

function newDecisionMapId(): string {
  return `demj_${randomUUID().replaceAll("-", "")}`;
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

async function loadMessageByIngestId(
  pool: DbPool,
  workspace_id: string,
  ingest_id: string,
): Promise<MessageDbRow | null> {
  const res = await pool.query<MessageDbRow>(
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
       AND ingest_id = $2`,
    [workspace_id, ingest_id],
  );
  if (res.rowCount !== 1) return null;
  return res.rows[0];
}

async function parseAndPersistEventLines(
  pool: DbPool,
  input: { workspace_id: string; message: MessageDbRow },
): Promise<DiscordParseEventLinesResultV1> {
  const parsed = extractParsedEventLines(input.message.content_raw);
  let inserted_count = 0;

  for (const line of parsed) {
    const res = await pool.query(
      `INSERT INTO integ_discord_event_lines (
         parsed_event_id,
         workspace_id,
         ingest_id,
         discord_message_id,
         line_index,
         line_raw,
         action,
         payload,
         status,
         parse_error,
         created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11
       )
       ON CONFLICT (workspace_id, ingest_id, line_index)
       DO NOTHING`,
      [
        newParsedEventId(),
        input.workspace_id,
        input.message.ingest_id,
        input.message.discord_message_id,
        line.line_index,
        line.line_raw,
        line.action ?? null,
        JSON.stringify(line.payload),
        line.status,
        line.parse_error ?? null,
        input.message.ingested_at,
      ],
    );

    if (res.rowCount === 1) inserted_count += 1;
  }

  const valid_count = parsed.filter((line) => line.status === "valid").length;
  const invalid_count = parsed.length - valid_count;

  return {
    ingest_id: input.message.ingest_id,
    total_lines: parsed.length,
    inserted_count,
    deduped_count: parsed.length - inserted_count,
    valid_count,
    invalid_count,
  };
}

async function resolveApprovalIdFromReplyMessage(
  pool: DbPool,
  input: { workspace_id: string; reply_to_discord_message_id: string },
): Promise<string | null> {
  const rows = await pool.query<{ payload: unknown }>(
    `SELECT p.payload
     FROM integ_discord_messages m
     JOIN integ_discord_event_lines p
       ON p.workspace_id = m.workspace_id
      AND p.ingest_id = m.ingest_id
     WHERE m.workspace_id = $1
       AND m.discord_message_id = $2
       AND p.status = 'valid'
       AND p.action = 'approval.requested'
     ORDER BY p.line_index DESC
     LIMIT 1`,
    [input.workspace_id, input.reply_to_discord_message_id],
  );

  if (rows.rowCount !== 1) return null;
  const payload = rows.rows[0].payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return normalizeOptionalString((payload as Record<string, unknown>).approval_id) ?? null;
}

async function loadApprovalForDecision(
  pool: DbPool,
  workspace_id: string,
  approval_id: string,
): Promise<ApprovalLookupRow | null> {
  const res = await pool.query<ApprovalLookupRow>(
    `SELECT
       workspace_id,
       room_id,
       thread_id,
       run_id,
       step_id,
       correlation_id,
       last_event_id
     FROM proj_approvals
     WHERE workspace_id = $1
       AND approval_id = $2`,
    [workspace_id, approval_id],
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

      await parseAndPersistEventLines(pool, {
        workspace_id,
        message: row,
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

  app.post<{
    Params: { ingestId: string };
  }>(
    "/v1/integrations/discord/messages/:ingestId/parse-events",
    async (req, reply): Promise<DiscordParseEventLinesResultV1> => {
      const workspace_id = workspaceIdFromReq(req);
      const ingest_id = normalizeRequiredString(req.params.ingestId);
      if (!ingest_id) return reply.code(400).send({ error: "invalid_ingest_id" });

      const message = await loadMessageByIngestId(pool, workspace_id, ingest_id);
      if (!message) return reply.code(404).send({ error: "discord_message_not_found" });

      const result = await parseAndPersistEventLines(pool, { workspace_id, message });
      return reply.code(200).send(result);
    },
  );

  app.get<{
    Querystring: { ingest_id?: string; status?: string; action?: string; limit?: string };
  }>("/v1/integrations/discord/event-lines", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const ingest_id = normalizeOptionalString(req.query.ingest_id);
    const status =
      req.query.status === "valid" || req.query.status === "invalid"
        ? req.query.status
        : undefined;
    if (req.query.status && !status) {
      return reply.code(400).send({ error: "invalid_status" });
    }
    const action = normalizeOptionalString(req.query.action);
    const limit = parseLimit(req.query.limit, 100);

    const args: unknown[] = [workspace_id];
    let where = "workspace_id = $1";
    if (ingest_id) {
      args.push(ingest_id);
      where += ` AND ingest_id = $${args.length}`;
    }
    if (status) {
      args.push(status);
      where += ` AND status = $${args.length}`;
    }
    if (action) {
      args.push(action);
      where += ` AND action = $${args.length}`;
    }
    args.push(limit);

    const rows = await pool.query<ParsedEventDbRow>(
      `SELECT
         parsed_event_id,
         workspace_id,
         ingest_id,
         discord_message_id,
         line_index,
         line_raw,
         action,
         payload,
         status,
         parse_error,
         created_at::text AS created_at
       FROM integ_discord_event_lines
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length}`,
      args,
    );

    return reply.code(200).send({ events: rows.rows.map(toParsedEventRow) });
  });

  app.post<{
    Body: DiscordEmojiDecisionMapV1;
  }>("/v1/integrations/discord/emoji-decisions", async (req, reply): Promise<DiscordEmojiDecisionMapResultV1> => {
    const workspace_id = workspaceIdFromReq(req);
    const discord_message_id = normalizeRequiredString(req.body.discord_message_id);
    const reply_to_discord_message_id = normalizeRequiredString(req.body.reply_to_discord_message_id);
    const emoji = normalizeRequiredString(req.body.emoji);
    const reason = normalizeOptionalString(req.body.reason);
    const decision = normalizeEmojiDecision(emoji ?? undefined);

    if (!discord_message_id) return reply.code(400).send({ error: "invalid_discord_message_id" });
    if (!reply_to_discord_message_id) {
      return reply.code(400).send({ error: "invalid_reply_to_discord_message_id" });
    }
    if (!emoji || !decision) return reply.code(400).send({ error: "invalid_emoji_decision" });

    const approval_id = await resolveApprovalIdFromReplyMessage(pool, {
      workspace_id,
      reply_to_discord_message_id,
    });
    if (!approval_id) {
      return reply.code(404).send({ error: "approval_request_not_found_from_reply_message" });
    }

    const approval = await loadApprovalForDecision(pool, workspace_id, approval_id);
    if (!approval) return reply.code(404).send({ error: "approval_not_found" });

    const actor_id =
      normalizeOptionalString(req.body.actor_discord_id) ||
      normalizeOptionalString(req.body.actor_name) ||
      "discord_ceo";
    const actor_name = normalizeOptionalString(req.body.actor_name);
    const correlation_id = approval.correlation_id || randomUUID();
    const now = new Date().toISOString();

    const inserted = await pool.query<EmojiDecisionDbRow>(
      `INSERT INTO integ_discord_emoji_decisions (
         decision_map_id,
         workspace_id,
         discord_message_id,
         reply_to_discord_message_id,
         approval_id,
         emoji,
         mapped_decision,
         actor_discord_id,
         actor_name,
         reason,
         correlation_id,
         event_id,
         created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12
       )
       ON CONFLICT (workspace_id, discord_message_id)
       DO NOTHING
       RETURNING
         decision_map_id,
         workspace_id,
         discord_message_id,
         reply_to_discord_message_id,
         approval_id,
         emoji,
         mapped_decision,
         actor_discord_id,
         actor_name,
         reason,
         correlation_id,
         event_id,
         created_at::text AS created_at`,
      [
        newDecisionMapId(),
        workspace_id,
        discord_message_id,
        reply_to_discord_message_id,
        approval_id,
        emoji,
        decision,
        normalizeOptionalString(req.body.actor_discord_id) ?? null,
        actor_name ?? null,
        reason ?? null,
        correlation_id,
        now,
      ],
    );

    if (inserted.rowCount !== 1) {
      const existing = await pool.query<EmojiDecisionDbRow>(
        `SELECT
           decision_map_id,
           workspace_id,
           discord_message_id,
           reply_to_discord_message_id,
           approval_id,
           emoji,
           mapped_decision,
           actor_discord_id,
           actor_name,
           reason,
           correlation_id,
           event_id,
           created_at::text AS created_at
         FROM integ_discord_emoji_decisions
         WHERE workspace_id = $1
           AND discord_message_id = $2`,
        [workspace_id, discord_message_id],
      );
      if (existing.rowCount !== 1) {
        return reply.code(500).send({ error: "discord_emoji_dedupe_lookup_failed" });
      }
      const row = existing.rows[0];
      return reply.code(200).send({
        ok: true,
        deduped: true,
        approval_id: row.approval_id,
        decision: row.mapped_decision,
      });
    }

    const stream =
      approval.room_id != null
        ? { stream_type: "room" as const, stream_id: approval.room_id }
        : { stream_type: "workspace" as const, stream_id: workspace_id };

    const event = await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "approval.decided",
      event_version: 1,
      occurred_at: now,
      workspace_id,
      room_id: approval.room_id ?? undefined,
      thread_id: approval.thread_id ?? undefined,
      run_id: approval.run_id ?? undefined,
      step_id: approval.step_id ?? undefined,
      actor: { actor_type: "user", actor_id },
      stream,
      correlation_id,
      causation_id: approval.last_event_id ?? undefined,
      data: {
        approval_id,
        decision,
        reason:
          reason ??
          `discord_emoji:${emoji}`,
        source: {
          transport: "discord",
          discord_message_id,
          reply_to_discord_message_id,
          emoji,
        },
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    await applyApprovalEvent(pool, event as ApprovalEventV1);
    await pool.query(
      `UPDATE integ_discord_emoji_decisions
       SET event_id = $3
       WHERE workspace_id = $1
         AND discord_message_id = $2`,
      [workspace_id, discord_message_id, event.event_id],
    );

    return reply.code(200).send({
      ok: true,
      deduped: false,
      approval_id,
      decision,
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
