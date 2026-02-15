-- Approvals projection (current state for inbox / policy checks)

CREATE TABLE IF NOT EXISTS proj_approvals (
  approval_id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  run_id TEXT NULL,
  step_id TEXT NULL,

  action TEXT NOT NULL,

  status TEXT NOT NULL CHECK (status IN ('pending', 'held', 'approved', 'denied')),

  title TEXT NULL,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NULL,

  requested_by_type TEXT NOT NULL CHECK (requested_by_type IN ('service', 'user')),
  requested_by_id TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,

  decided_by_type TEXT NULL CHECK (decided_by_type IN ('service', 'user')),
  decided_by_id TEXT NULL,
  decided_at TIMESTAMPTZ NULL,
  decision TEXT NULL CHECK (decision IN ('approve', 'deny', 'hold')),
  decision_reason TEXT NULL,

  correlation_id TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_approvals_workspace_status_updated_at_idx
  ON proj_approvals (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS proj_approvals_room_status_updated_at_idx
  ON proj_approvals (room_id, status, updated_at DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_approvals_correlation_id_idx
  ON proj_approvals (correlation_id);

