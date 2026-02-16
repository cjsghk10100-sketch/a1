-- Egress gateway request log (single outbound request substrate)

CREATE TABLE IF NOT EXISTS sec_egress_requests (
  egress_request_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  run_id TEXT NULL,
  step_id TEXT NULL,

  requested_by_type TEXT NOT NULL CHECK (requested_by_type IN ('user', 'agent', 'service')),
  requested_by_id TEXT NOT NULL,
  requested_by_principal_id TEXT NULL REFERENCES sec_principals(principal_id),
  zone TEXT NULL CHECK (zone IN ('sandbox', 'supervised', 'high_stakes')),

  action TEXT NOT NULL,
  method TEXT NULL,
  target_url TEXT NOT NULL,
  target_domain TEXT NOT NULL,

  policy_decision TEXT NOT NULL CHECK (policy_decision IN ('allow', 'deny', 'require_approval')),
  policy_reason_code TEXT NOT NULL,
  policy_reason TEXT NULL,
  enforcement_mode TEXT NOT NULL CHECK (enforcement_mode IN ('shadow', 'enforce')),
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id TEXT NULL,

  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sec_egress_requests_workspace_created_at_idx
  ON sec_egress_requests (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sec_egress_requests_room_created_at_idx
  ON sec_egress_requests (workspace_id, room_id, created_at DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sec_egress_requests_decision_created_at_idx
  ON sec_egress_requests (workspace_id, policy_decision, created_at DESC);

