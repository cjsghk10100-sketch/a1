-- Explicit run attempt history for claim/recovery/retry observability.

CREATE TABLE IF NOT EXISTS run_attempts (
  run_attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES proj_runs(run_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),

  claim_token TEXT NOT NULL UNIQUE,
  claimed_by_actor_id TEXT NOT NULL,
  actor_principal_id TEXT NULL REFERENCES sec_principals(principal_id),
  engine_id TEXT NULL REFERENCES sec_engines(engine_id),

  claimed_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ NULL,
  release_reason TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (run_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS run_attempts_run_claimed_idx
  ON run_attempts (run_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS run_attempts_workspace_open_idx
  ON run_attempts (workspace_id, claimed_at DESC)
  WHERE released_at IS NULL;
