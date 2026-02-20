-- Capability delegation edges (explicit parent->child chain materialization).

CREATE TABLE IF NOT EXISTS sec_capability_delegation_edges (
  edge_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  parent_token_id TEXT NOT NULL REFERENCES sec_capability_tokens(token_id),
  child_token_id TEXT NOT NULL UNIQUE REFERENCES sec_capability_tokens(token_id),

  granted_by_principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),
  issued_to_principal_id TEXT NOT NULL REFERENCES sec_principals(principal_id),

  depth INTEGER NOT NULL CHECK (depth >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, parent_token_id, child_token_id)
);

CREATE INDEX IF NOT EXISTS sec_capability_delegation_edges_workspace_parent_idx
  ON sec_capability_delegation_edges (workspace_id, parent_token_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_capability_delegation_edges_workspace_issued_to_idx
  ON sec_capability_delegation_edges (workspace_id, issued_to_principal_id, created_at DESC);
