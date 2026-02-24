-- Experiments projection + optional run linkage

CREATE TABLE IF NOT EXISTS proj_experiments (
  experiment_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'stopped')),
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  success_criteria JSONB NOT NULL,
  stop_conditions JSONB NOT NULL,
  budget_cap_units DOUBLE PRECISION NOT NULL CHECK (budget_cap_units >= 0),
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('service', 'user', 'agent')),
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS proj_experiments_workspace_status_updated_idx
  ON proj_experiments (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS proj_experiments_workspace_room_updated_idx
  ON proj_experiments (workspace_id, room_id, updated_at DESC)
  WHERE room_id IS NOT NULL;

ALTER TABLE proj_runs
  ADD COLUMN IF NOT EXISTS experiment_id TEXT NULL REFERENCES proj_experiments(experiment_id);

CREATE INDEX IF NOT EXISTS proj_runs_workspace_experiment_updated_idx
  ON proj_runs (workspace_id, experiment_id, updated_at DESC)
  WHERE experiment_id IS NOT NULL;
