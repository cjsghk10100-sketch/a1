-- Event store (append-only)

CREATE TABLE IF NOT EXISTS evt_stream_heads (
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  next_seq BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (stream_type, stream_id),
  CHECK (next_seq > 0)
);

CREATE TABLE IF NOT EXISTS evt_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_version INT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  workspace_id TEXT NOT NULL,
  mission_id TEXT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,

  actor_type TEXT NOT NULL CHECK (actor_type IN ('service', 'user')),
  actor_id TEXT NOT NULL,

  run_id TEXT NULL,
  step_id TEXT NULL,

  stream_type TEXT NOT NULL CHECK (stream_type IN ('room', 'thread', 'workspace')),
  stream_id TEXT NOT NULL,
  stream_seq BIGINT NOT NULL,

  redaction_level TEXT NOT NULL DEFAULT 'none' CHECK (redaction_level IN ('none', 'partial', 'full')),
  contains_secrets BOOLEAN NOT NULL DEFAULT FALSE,

  policy_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  display JSONB NOT NULL DEFAULT '{}'::jsonb,

  data JSONB NOT NULL,

  idempotency_key TEXT NULL,

  CHECK (stream_seq > 0)
);

-- Uniqueness per stream ordering
CREATE UNIQUE INDEX IF NOT EXISTS evt_events_stream_seq_uq
  ON evt_events (stream_type, stream_id, stream_seq);

-- Fast type/time lookups
CREATE INDEX IF NOT EXISTS evt_events_type_recorded_at_idx
  ON evt_events (event_type, recorded_at DESC);

-- Room feed reads
CREATE INDEX IF NOT EXISTS evt_events_room_recorded_at_idx
  ON evt_events (workspace_id, room_id, recorded_at DESC);

-- Optional but recommended idempotency guard
CREATE UNIQUE INDEX IF NOT EXISTS evt_events_idempotency_uq
  ON evt_events (stream_type, stream_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Append-only guard
CREATE OR REPLACE FUNCTION evt_events_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'evt_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evt_events_append_only ON evt_events;
CREATE TRIGGER trg_evt_events_append_only
BEFORE UPDATE OR DELETE ON evt_events
FOR EACH ROW EXECUTE FUNCTION evt_events_append_only_guard();

