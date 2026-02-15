-- Core projections + search

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS proj_rooms (
  room_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NULL,
  title TEXT NOT NULL,
  topic TEXT NULL,
  room_mode TEXT NOT NULL,
  default_lang TEXT NOT NULL,
  tool_policy_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_rooms_workspace_mission_idx
  ON proj_rooms (workspace_id, mission_id);

CREATE TABLE IF NOT EXISTS proj_threads (
  thread_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_threads_room_updated_at_idx
  ON proj_threads (room_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS proj_messages (
  message_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content_md TEXT NOT NULL,
  lang TEXT NOT NULL,
  parent_message_id TEXT NULL,
  run_id TEXT NULL,
  step_id TEXT NULL,
  labels TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_messages_room_created_at_idx
  ON proj_messages (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proj_messages_thread_created_at_idx
  ON proj_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proj_messages_run_created_at_idx
  ON proj_messages (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS proj_search_docs (
  doc_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  doc_type TEXT NOT NULL,
  content_text TEXT NOT NULL,
  lang TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS proj_search_docs_content_trgm_idx
  ON proj_search_docs
  USING gin (content_text gin_trgm_ops);

