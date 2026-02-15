-- Runs + Steps projections (for timeline/inspector)

CREATE TABLE IF NOT EXISTS proj_runs (
  run_id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,

  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),

  title TEXT NULL,
  goal TEXT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NULL,
  ended_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  correlation_id TEXT NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_runs_workspace_status_updated_at_idx
  ON proj_runs (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS proj_runs_room_updated_at_idx
  ON proj_runs (room_id, updated_at DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_runs_correlation_id_idx
  ON proj_runs (correlation_id);

CREATE TABLE IF NOT EXISTS proj_steps (
  step_id TEXT PRIMARY KEY,

  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,

  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),

  title TEXT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_steps_run_created_at_idx
  ON proj_steps (run_id, created_at ASC);

