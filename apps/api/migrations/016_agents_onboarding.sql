-- Agent onboarding registry + imported skill inventory links

CREATE TABLE IF NOT EXISTS sec_agents (
  agent_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL UNIQUE REFERENCES sec_principals(principal_id),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS sec_agent_skill_packages (
  agent_id TEXT NOT NULL REFERENCES sec_agents(agent_id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'quarantined')),
  skill_package_id TEXT NULL REFERENCES sec_skill_packages(skill_package_id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id, version)
);

CREATE INDEX IF NOT EXISTS sec_agent_skill_packages_agent_status_idx
  ON sec_agent_skill_packages (agent_id, verification_status, updated_at DESC);

