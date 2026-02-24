-- Scorecards + lessons projections

CREATE TABLE IF NOT EXISTS proj_scorecards (
  scorecard_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  experiment_id TEXT NULL REFERENCES proj_experiments(experiment_id) ON DELETE SET NULL,
  run_id TEXT NULL REFERENCES proj_runs(run_id) ON DELETE SET NULL,
  evidence_id TEXT NULL REFERENCES proj_evidence_manifests(evidence_id) ON DELETE SET NULL,
  agent_id TEXT NULL REFERENCES sec_agents(agent_id) ON DELETE SET NULL,
  principal_id TEXT NULL REFERENCES sec_principals(principal_id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  metrics JSONB NOT NULL,
  metrics_hash TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'warn', 'fail')),
  rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('service', 'user', 'agent')),
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS proj_scorecards_workspace_created_idx
  ON proj_scorecards (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proj_scorecards_workspace_agent_created_idx
  ON proj_scorecards (workspace_id, agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_scorecards_workspace_experiment_created_idx
  ON proj_scorecards (workspace_id, experiment_id, created_at DESC)
  WHERE experiment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_scorecards_workspace_run_created_idx
  ON proj_scorecards (workspace_id, run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS proj_lessons (
  lesson_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  experiment_id TEXT NULL REFERENCES proj_experiments(experiment_id) ON DELETE SET NULL,
  run_id TEXT NULL REFERENCES proj_runs(run_id) ON DELETE SET NULL,
  scorecard_id TEXT NULL REFERENCES proj_scorecards(scorecard_id) ON DELETE SET NULL,
  incident_id TEXT NULL REFERENCES proj_incidents(incident_id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('service', 'user', 'agent')),
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS proj_lessons_workspace_created_idx
  ON proj_lessons (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proj_lessons_workspace_run_created_idx
  ON proj_lessons (workspace_id, run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS proj_lessons_workspace_scorecard_created_idx
  ON proj_lessons (workspace_id, scorecard_id, created_at DESC)
  WHERE scorecard_id IS NOT NULL;
