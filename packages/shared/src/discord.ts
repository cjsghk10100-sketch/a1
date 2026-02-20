import type { EventEnvelopeV1 } from "./events.js";

export interface DiscordChannelMappingRowV1 {
  mapping_id: string;
  workspace_id: string;
  room_id: string;
  discord_guild_id?: string;
  discord_channel_id: string;
  discord_thread_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscordIngestedMessageRowV1 {
  ingest_id: string;
  workspace_id: string;
  room_id?: string;
  discord_guild_id?: string;
  discord_channel_id: string;
  discord_thread_id?: string;
  discord_message_id: string;
  author_discord_id?: string;
  author_name?: string;
  content_raw: string;
  attachments: unknown[];
  embeds: unknown[];
  source: Record<string, unknown>;
  message_created_at?: string;
  ingested_at: string;
}

export interface DiscordChannelMappingUpsertV1 {
  room_id: string;
  discord_channel_id: string;
  discord_guild_id?: string;
  discord_thread_id?: string;
  is_active?: boolean;
}

export interface DiscordMessageIngestV1 {
  discord_message_id: string;
  discord_channel_id: string;
  discord_guild_id?: string;
  discord_thread_id?: string;
  author_discord_id?: string;
  author_name?: string;
  content_raw: string;
  attachments?: unknown[];
  embeds?: unknown[];
  source?: Record<string, unknown>;
  message_created_at?: string;
}

export interface DiscordMessageIngestResultV1 {
  ingest_id: string;
  room_id?: string;
  discord_message_id: string;
  deduped: boolean;
}

export const DiscordParsedEventStatus = {
  Valid: "valid",
  Invalid: "invalid",
} as const;

export type DiscordParsedEventStatus =
  (typeof DiscordParsedEventStatus)[keyof typeof DiscordParsedEventStatus];

export interface DiscordParsedEventRowV1 {
  parsed_event_id: string;
  workspace_id: string;
  ingest_id: string;
  discord_message_id: string;
  line_index: number;
  line_raw: string;
  action?: string;
  payload: Record<string, unknown>;
  status: DiscordParsedEventStatus;
  parse_error?: string;
  created_at: string;
}

export interface DiscordParseEventLinesResultV1 {
  ingest_id: string;
  total_lines: number;
  inserted_count: number;
  deduped_count: number;
  valid_count: number;
  invalid_count: number;
}

export interface DiscordChannelMappedDataV1 {
  mapping_id: string;
  room_id: string;
  discord_guild_id?: string;
  discord_channel_id: string;
  discord_thread_id?: string;
  is_active: boolean;
}

export interface DiscordMessageIngestedDataV1 {
  ingest_id: string;
  room_id?: string;
  discord_guild_id?: string;
  discord_channel_id: string;
  discord_thread_id?: string;
  discord_message_id: string;
  deduped: boolean;
}

export type DiscordChannelMappedEventV1 = EventEnvelopeV1<
  "discord.channel.mapped",
  DiscordChannelMappedDataV1
>;

export type DiscordMessageIngestedEventV1 = EventEnvelopeV1<
  "discord.message.ingested",
  DiscordMessageIngestedDataV1
>;
