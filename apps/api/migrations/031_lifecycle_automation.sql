-- Lifecycle automation state + transition history (ACTIVE -> PROBATION -> SUNSET)

CREATE TABLE IF NOT EXISTS sec_lifecycle_states (
  workspace_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('workspace', 'agent')),
  target_id TEXT NOT NULL,

  current_state TEXT NOT NULL CHECK (current_state IN ('active', 'probation', 'sunset')),
  recommended_state TEXT NOT NULL CHECK (recommended_state IN ('active', 'probation', 'sunset')),

  last_snapshot_date DATE NOT NULL,
  last_survival_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (last_survival_score >= 0 AND last_survival_score <= 1),
  last_budget_utilization DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (last_budget_utilization >= 0),
  consecutive_healthy_days INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_healthy_days >= 0),
  consecutive_risky_days INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_risky_days >= 0),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_transition_at TIMESTAMPTZ NULL,
  last_event_id TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sec_lifecycle_states_target_uq
  ON sec_lifecycle_states (workspace_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS sec_lifecycle_states_workspace_state_idx
  ON sec_lifecycle_states (workspace_id, current_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS sec_lifecycle_transitions (
  transition_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('workspace', 'agent')),
  target_id TEXT NOT NULL,

  from_state TEXT NULL CHECK (from_state IN ('active', 'probation', 'sunset')),
  to_state TEXT NOT NULL CHECK (to_state IN ('active', 'probation', 'sunset')),
  recommended_state TEXT NOT NULL CHECK (recommended_state IN ('active', 'probation', 'sunset')),
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

  snapshot_date DATE NOT NULL,
  survival_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (survival_score >= 0 AND survival_score <= 1),
  budget_utilization DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (budget_utilization >= 0),

  correlation_id TEXT NOT NULL,
  event_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_lifecycle_transitions_target_created_idx
  ON sec_lifecycle_transitions (workspace_id, target_type, target_id, created_at DESC);
