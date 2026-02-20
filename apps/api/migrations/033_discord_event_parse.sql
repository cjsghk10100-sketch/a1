-- Parsed @event command lines from ingested Discord messages.
-- This table stores both valid and invalid parses for auditability.

CREATE TABLE IF NOT EXISTS integ_discord_event_lines (
  parsed_event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ingest_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  line_raw TEXT NOT NULL,
  action TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
  parse_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integ_discord_event_lines_dedupe_uq
  ON integ_discord_event_lines (workspace_id, ingest_id, line_index);

CREATE INDEX IF NOT EXISTS integ_discord_event_lines_workspace_status_created_idx
  ON integ_discord_event_lines (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS integ_discord_event_lines_workspace_action_created_idx
  ON integ_discord_event_lines (workspace_id, action, created_at DESC);
