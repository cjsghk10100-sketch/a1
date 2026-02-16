-- Progressive trust score + autonomy recommendation/approval flow

CREATE TABLE IF NOT EXISTS sec_agent_trust (
  agent_id TEXT PRIMARY KEY REFERENCES sec_agents(agent_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,

  trust_score DOUBLE PRECISION NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
  success_rate_7d DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (success_rate_7d >= 0 AND success_rate_7d <= 1),
  eval_quality_trend DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (eval_quality_trend >= -1 AND eval_quality_trend <= 1),
  user_feedback_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (user_feedback_score >= 0 AND user_feedback_score <= 1),
  policy_violations_7d INTEGER NOT NULL DEFAULT 0 CHECK (policy_violations_7d >= 0),
  time_in_service_days INTEGER NOT NULL DEFAULT 0 CHECK (time_in_service_days >= 0),

  components JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_recalculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_agent_trust_workspace_score_idx
  ON sec_agent_trust (workspace_id, trust_score DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS sec_autonomy_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES sec_agents(agent_id) ON DELETE CASCADE,

  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  scope_delta JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NOT NULL,
  trust_score_before DOUBLE PRECISION NOT NULL CHECK (trust_score_before >= 0 AND trust_score_before <= 1),
  trust_score_after DOUBLE PRECISION NOT NULL CHECK (trust_score_after >= 0 AND trust_score_after <= 1),
  trust_components JSONB NOT NULL DEFAULT '{}'::jsonb,

  recommended_by_type TEXT NOT NULL CHECK (recommended_by_type IN ('user', 'agent', 'service')),
  recommended_by_id TEXT NOT NULL,
  recommended_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),

  approved_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),
  approved_token_id TEXT NULL REFERENCES sec_capability_tokens(token_id),
  approved_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_autonomy_recommendations_workspace_agent_created_at_idx
  ON sec_autonomy_recommendations (workspace_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_autonomy_recommendations_workspace_status_created_at_idx
  ON sec_autonomy_recommendations (workspace_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sec_autonomy_recommendations_pending_uq
  ON sec_autonomy_recommendations (workspace_id, agent_id)
  WHERE status = 'pending';
