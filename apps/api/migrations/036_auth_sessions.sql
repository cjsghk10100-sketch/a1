-- Local owner account + session token storage (hashed tokens only).

CREATE TABLE IF NOT EXISTS sec_local_owners (
  owner_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL UNIQUE REFERENCES sec_principals(principal_id),
  display_name TEXT NOT NULL,
  passphrase_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS sec_local_owners_workspace_created_at_idx
  ON sec_local_owners (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sec_auth_sessions (
  session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES sec_local_owners(owner_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),

  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,

  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,

  user_agent TEXT NULL,
  created_ip TEXT NULL
);

CREATE INDEX IF NOT EXISTS sec_auth_sessions_access_active_idx
  ON sec_auth_sessions (access_token_hash, access_expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sec_auth_sessions_refresh_active_idx
  ON sec_auth_sessions (refresh_token_hash, refresh_expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sec_auth_sessions_workspace_last_seen_idx
  ON sec_auth_sessions (workspace_id, last_seen_at DESC);
