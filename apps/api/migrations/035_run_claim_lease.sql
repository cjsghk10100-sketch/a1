ALTER TABLE proj_runs
  ADD COLUMN IF NOT EXISTS claim_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_actor_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS lease_heartbeat_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS proj_runs_workspace_status_lease_expires_idx
  ON proj_runs (workspace_id, status, lease_expires_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS proj_runs_claim_token_idx
  ON proj_runs (claim_token)
  WHERE claim_token IS NOT NULL;
