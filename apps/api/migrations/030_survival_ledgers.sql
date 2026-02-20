-- Daily survival ledgers (Sustain or Sunset substrate)

CREATE TABLE IF NOT EXISTS sec_survival_ledger_daily (
  workspace_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('workspace', 'agent')),
  target_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,

  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  incident_opened_count INTEGER NOT NULL DEFAULT 0 CHECK (incident_opened_count >= 0),
  incident_closed_count INTEGER NOT NULL DEFAULT 0 CHECK (incident_closed_count >= 0),
  learning_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_count >= 0),
  repeated_mistakes_count INTEGER NOT NULL DEFAULT 0 CHECK (repeated_mistakes_count >= 0),
  egress_requests_count INTEGER NOT NULL DEFAULT 0 CHECK (egress_requests_count >= 0),
  blocked_requests_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_requests_count >= 0),

  estimated_cost_units DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (estimated_cost_units >= 0),
  value_units DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (value_units >= 0),
  budget_cap_units DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (budget_cap_units > 0),
  budget_utilization DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (budget_utilization >= 0),
  survival_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (survival_score >= 0 AND survival_score <= 1),

  extras JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, target_type, target_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS sec_survival_ledger_daily_workspace_date_idx
  ON sec_survival_ledger_daily (workspace_id, snapshot_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS sec_survival_ledger_daily_target_date_idx
  ON sec_survival_ledger_daily (workspace_id, target_type, target_id, snapshot_date DESC);
