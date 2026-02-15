-- Projector state + idempotency

CREATE TABLE IF NOT EXISTS proj_projectors (
  projector_name TEXT PRIMARY KEY,
  last_recorded_at TIMESTAMPTZ NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_projectors_last_recorded_at_idx
  ON proj_projectors (last_recorded_at);

CREATE TABLE IF NOT EXISTS proj_applied_events (
  projector_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (projector_name, event_id)
);

