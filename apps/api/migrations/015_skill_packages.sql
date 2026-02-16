-- Skill package supply-chain metadata (manifest + hash + quarantine)

CREATE TABLE IF NOT EXISTS sec_skill_packages (
  skill_package_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  signature TEXT NULL,
  manifest JSONB NOT NULL,

  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'quarantined')),
  verified_at TIMESTAMPTZ NULL,
  quarantine_reason TEXT NULL,

  installed_by_type TEXT NOT NULL CHECK (installed_by_type IN ('user', 'agent', 'service')),
  installed_by_id TEXT NOT NULL,
  installed_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, skill_id, version)
);

CREATE INDEX IF NOT EXISTS sec_skill_packages_workspace_created_at_idx
  ON sec_skill_packages (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_skill_packages_workspace_status_updated_at_idx
  ON sec_skill_packages (workspace_id, verification_status, updated_at DESC);

