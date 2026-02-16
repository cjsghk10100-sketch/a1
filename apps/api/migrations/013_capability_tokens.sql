-- Capability tokens (explicit scopes + delegation via parent_token_id)

CREATE TABLE IF NOT EXISTS sec_capability_tokens (
  token_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  issued_to_principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),
  granted_by_principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),

  parent_token_id TEXT NULL REFERENCES sec_capability_tokens(token_id),

  scopes JSONB NOT NULL DEFAULT '{}'::jsonb,

  valid_until TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_capability_tokens_principal_created_at_idx
  ON sec_capability_tokens (workspace_id, issued_to_principal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_capability_tokens_parent_idx
  ON sec_capability_tokens (workspace_id, parent_token_id)
  WHERE parent_token_id IS NOT NULL;

