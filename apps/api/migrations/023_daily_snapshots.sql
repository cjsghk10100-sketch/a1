-- Daily growth snapshots (idempotent per workspace/agent/day)

CREATE TABLE IF NOT EXISTS sec_daily_agent_snapshots (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES sec_agents(agent_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  trust_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 1),
  autonomy_rate_7d DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (autonomy_rate_7d >= 0 AND autonomy_rate_7d <= 1),
  new_skills_learned_7d INTEGER NOT NULL DEFAULT 0 CHECK (new_skills_learned_7d >= 0),
  constraints_learned_7d INTEGER NOT NULL DEFAULT 0 CHECK (constraints_learned_7d >= 0),
  repeated_mistakes_7d INTEGER NOT NULL DEFAULT 0 CHECK (repeated_mistakes_7d >= 0),

  extras JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, agent_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS sec_daily_agent_snapshots_workspace_date_idx
  ON sec_daily_agent_snapshots (workspace_id, snapshot_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS sec_daily_agent_snapshots_agent_date_idx
  ON sec_daily_agent_snapshots (agent_id, snapshot_date DESC, updated_at DESC);
