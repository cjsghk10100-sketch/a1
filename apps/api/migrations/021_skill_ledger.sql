-- Skill ledger + assessment harness substrate

CREATE TABLE IF NOT EXISTS sec_skill_catalog (
  workspace_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,

  name TEXT NOT NULL,
  description TEXT NULL,
  skill_type TEXT NOT NULL CHECK (skill_type IN ('tool', 'workflow', 'cognitive')),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high')),

  assessment_suite JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_manifest_caps JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, skill_id)
);

CREATE INDEX IF NOT EXISTS sec_skill_catalog_workspace_updated_at_idx
  ON sec_skill_catalog (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sec_agent_skills (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES sec_agents(agent_id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,

  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 5),
  learned_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,

  usage_total INTEGER NOT NULL DEFAULT 0 CHECK (usage_total >= 0),
  usage_7d INTEGER NOT NULL DEFAULT 0 CHECK (usage_7d >= 0),
  usage_30d INTEGER NOT NULL DEFAULT 0 CHECK (usage_30d >= 0),

  assessment_total INTEGER NOT NULL DEFAULT 0 CHECK (assessment_total >= 0),
  assessment_passed INTEGER NOT NULL DEFAULT 0 CHECK (assessment_passed >= 0),

  reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (reliability_score >= 0 AND reliability_score <= 1),
  impact_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,

  source_skill_package_id TEXT NULL REFERENCES sec_skill_packages(skill_package_id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, agent_id, skill_id),
  FOREIGN KEY (workspace_id, skill_id)
    REFERENCES sec_skill_catalog(workspace_id, skill_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sec_agent_skills_workspace_agent_usage_idx
  ON sec_agent_skills (workspace_id, agent_id, usage_total DESC, reliability_score DESC, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sec_agent_skills_primary_uq
  ON sec_agent_skills (workspace_id, agent_id)
  WHERE is_primary = TRUE;

CREATE TABLE IF NOT EXISTS sec_skill_assessments (
  assessment_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES sec_agents(agent_id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,

  status TEXT NOT NULL CHECK (status IN ('started', 'passed', 'failed')),
  trigger_reason TEXT NULL,
  suite JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  score DOUBLE PRECISION NULL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  run_id TEXT NULL,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,

  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user', 'agent', 'service')),
  created_by_id TEXT NOT NULL,
  created_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_skill_assessments_workspace_agent_started_at_idx
  ON sec_skill_assessments (workspace_id, agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS sec_skill_assessments_workspace_skill_started_at_idx
  ON sec_skill_assessments (workspace_id, skill_id, started_at DESC);
