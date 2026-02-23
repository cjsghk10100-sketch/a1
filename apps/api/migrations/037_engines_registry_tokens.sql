-- Engine runtime identity registry + hashed engine auth tokens.

CREATE TABLE IF NOT EXISTS sec_engines (
  engine_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  engine_name TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ NULL,
  deactivated_reason TEXT NULL,
  UNIQUE (workspace_id, actor_id)
);

CREATE INDEX IF NOT EXISTS sec_engines_workspace_status_updated_idx
  ON sec_engines (workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sec_engine_tokens (
  token_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  engine_id TEXT NOT NULL REFERENCES sec_engines(engine_id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),
  capability_token_id TEXT NOT NULL REFERENCES sec_capability_tokens(token_id),
  token_hash TEXT NOT NULL UNIQUE,
  token_label TEXT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NULL,
  valid_until TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_reason TEXT NULL,
  created_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id)
);

CREATE INDEX IF NOT EXISTS sec_engine_tokens_workspace_engine_issued_idx
  ON sec_engine_tokens (workspace_id, engine_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS sec_engine_tokens_workspace_active_idx
  ON sec_engine_tokens (workspace_id, engine_id, valid_until, issued_at DESC)
  WHERE revoked_at IS NULL;
