-- Idempotent tracking table for Discord emoji -> approval decision mapping.

CREATE TABLE IF NOT EXISTS integ_discord_emoji_decisions (
  decision_map_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  reply_to_discord_message_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  mapped_decision TEXT NOT NULL CHECK (mapped_decision IN ('approve', 'deny', 'hold')),
  actor_discord_id TEXT NULL,
  actor_name TEXT NULL,
  reason TEXT NULL,
  correlation_id TEXT NOT NULL,
  event_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integ_discord_emoji_decisions_workspace_message_uq
  ON integ_discord_emoji_decisions (workspace_id, discord_message_id);

CREATE INDEX IF NOT EXISTS integ_discord_emoji_decisions_workspace_approval_created_idx
  ON integ_discord_emoji_decisions (workspace_id, approval_id, created_at DESC);
