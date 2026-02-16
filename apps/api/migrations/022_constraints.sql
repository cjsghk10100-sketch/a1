-- Learning from failures: durable constraints + repeated mistake counters

CREATE TABLE IF NOT EXISTS sec_constraints (
  constraint_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  subject_key TEXT NOT NULL,
  principal_id TEXT NULL REFERENCES sec_principals(principal_id) ON DELETE SET NULL,
  agent_id TEXT NULL REFERENCES sec_agents(agent_id) ON DELETE SET NULL,

  category TEXT NOT NULL CHECK (category IN ('tool', 'data', 'egress', 'action')),
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,

  pattern TEXT NOT NULL,
  pattern_hash TEXT NOT NULL,
  guidance TEXT NOT NULL,

  learned_from_event_id TEXT NULL REFERENCES evt_events(event_id) ON DELETE SET NULL,
  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count > 0),
  first_learned_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sec_constraints_subject_pattern_uq
  ON sec_constraints (workspace_id, subject_key, category, pattern_hash);

CREATE INDEX IF NOT EXISTS sec_constraints_workspace_seen_idx
  ON sec_constraints (workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS sec_constraints_workspace_agent_seen_idx
  ON sec_constraints (workspace_id, agent_id, last_seen_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sec_mistake_counters (
  workspace_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  principal_id TEXT NULL REFERENCES sec_principals(principal_id) ON DELETE SET NULL,
  agent_id TEXT NULL REFERENCES sec_agents(agent_id) ON DELETE SET NULL,

  category TEXT NOT NULL CHECK (category IN ('tool', 'data', 'egress', 'action')),
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  pattern_hash TEXT NOT NULL,

  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,

  last_failure_event_id TEXT NULL REFERENCES evt_events(event_id) ON DELETE SET NULL,
  last_constraint_id TEXT NULL REFERENCES sec_constraints(constraint_id) ON DELETE SET NULL,

  PRIMARY KEY (workspace_id, subject_key, category, pattern_hash)
);

CREATE INDEX IF NOT EXISTS sec_mistake_counters_workspace_seen_idx
  ON sec_mistake_counters (workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS sec_mistake_counters_workspace_agent_seen_idx
  ON sec_mistake_counters (workspace_id, agent_id, last_seen_at DESC)
  WHERE agent_id IS NOT NULL;
