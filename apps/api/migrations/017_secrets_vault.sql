-- Secrets vault + redaction finding log (opt-in runtime key for decrypt/encrypt operations)

CREATE TABLE IF NOT EXISTS sec_secrets (
  secret_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  description TEXT NULL,

  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  nonce_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  auth_tag_b64 TEXT NOT NULL,

  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user', 'agent', 'service')),
  created_by_id TEXT NOT NULL,
  created_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),

  last_accessed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, secret_name)
);

CREATE INDEX IF NOT EXISTS sec_secrets_workspace_updated_at_idx
  ON sec_secrets (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS sec_secrets_workspace_last_accessed_at_idx
  ON sec_secrets (workspace_id, last_accessed_at DESC)
  WHERE last_accessed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS sec_redaction_log (
  redaction_log_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NULL REFERENCES evt_events(event_id) ON DELETE SET NULL,

  event_type TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,

  rule_id TEXT NOT NULL,
  match_preview TEXT NOT NULL,
  detector_version TEXT NOT NULL DEFAULT 'dlp_v1',
  action TEXT NOT NULL CHECK (action IN ('shadow_flagged', 'event_emitted')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_redaction_log_workspace_created_at_idx
  ON sec_redaction_log (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_redaction_log_event_idx
  ON sec_redaction_log (event_id)
  WHERE event_id IS NOT NULL;
