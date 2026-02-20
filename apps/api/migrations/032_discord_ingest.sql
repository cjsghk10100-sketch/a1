-- Discord ingest normalization tables:
-- - channel mapping: discord channel -> room
-- - raw ingested messages: dedupe + auditable payload snapshot

CREATE TABLE IF NOT EXISTS integ_discord_channel_mappings (
  mapping_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discord_guild_id TEXT NULL,
  discord_channel_id TEXT NOT NULL,
  discord_thread_id TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integ_discord_channel_mappings_workspace_channel_uq
  ON integ_discord_channel_mappings (workspace_id, discord_channel_id);

CREATE INDEX IF NOT EXISTS integ_discord_channel_mappings_workspace_room_idx
  ON integ_discord_channel_mappings (workspace_id, room_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS integ_discord_messages (
  ingest_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  discord_guild_id TEXT NULL,
  discord_channel_id TEXT NOT NULL,
  discord_thread_id TEXT NULL,
  discord_message_id TEXT NOT NULL,
  author_discord_id TEXT NULL,
  author_name TEXT NULL,
  content_raw TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  embeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_created_at TIMESTAMPTZ NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integ_discord_messages_workspace_message_uq
  ON integ_discord_messages (workspace_id, discord_message_id);

CREATE INDEX IF NOT EXISTS integ_discord_messages_workspace_channel_ingested_idx
  ON integ_discord_messages (workspace_id, discord_channel_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS integ_discord_messages_workspace_room_ingested_idx
  ON integ_discord_messages (workspace_id, room_id, ingested_at DESC);
