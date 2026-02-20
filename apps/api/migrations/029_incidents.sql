-- Incidents projection + learning ledger projection (Learn or Die closure workflow)

CREATE TABLE IF NOT EXISTS proj_incidents (
  incident_id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  run_id TEXT NULL,

  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  title TEXT NOT NULL,
  summary TEXT NULL,
  severity TEXT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  rca JSONB NOT NULL DEFAULT '{}'::jsonb,
  rca_updated_at TIMESTAMPTZ NULL,
  learning_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_count >= 0),
  closed_reason TEXT NULL,

  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('service', 'user', 'agent')),
  created_by_id TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  correlation_id TEXT NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_incidents_workspace_status_updated_at_idx
  ON proj_incidents (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS proj_incidents_room_status_updated_at_idx
  ON proj_incidents (room_id, status, updated_at DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_incidents_run_updated_at_idx
  ON proj_incidents (run_id, updated_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_incidents_correlation_id_idx
  ON proj_incidents (correlation_id);

CREATE TABLE IF NOT EXISTS proj_incident_learning (
  learning_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES proj_incidents(incident_id),

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  run_id TEXT NULL,

  note TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('service', 'user', 'agent')),
  created_by_id TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_incident_learning_incident_created_at_idx
  ON proj_incident_learning (incident_id, created_at ASC);

CREATE INDEX IF NOT EXISTS proj_incident_learning_workspace_created_at_idx
  ON proj_incident_learning (workspace_id, created_at DESC);
