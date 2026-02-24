-- Evidence manifest projection (run terminal state -> one verifiable bundle)

CREATE TABLE IF NOT EXISTS proj_evidence_manifests (
  evidence_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE REFERENCES proj_runs(run_id) ON DELETE CASCADE,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  correlation_id TEXT NOT NULL,
  run_status TEXT NOT NULL CHECK (run_status IN ('succeeded', 'failed')),
  manifest JSONB NOT NULL,
  manifest_hash TEXT NOT NULL,
  event_hash_root TEXT NOT NULL,
  stream_type TEXT NOT NULL CHECK (stream_type IN ('room', 'workspace')),
  stream_id TEXT NOT NULL,
  from_seq BIGINT NOT NULL CHECK (from_seq > 0),
  to_seq BIGINT NOT NULL CHECK (to_seq >= from_seq),
  event_count INTEGER NOT NULL CHECK (event_count >= 1),
  finalized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS proj_evidence_manifests_workspace_finalized_idx
  ON proj_evidence_manifests (workspace_id, finalized_at DESC);

CREATE INDEX IF NOT EXISTS proj_evidence_manifests_run_status_idx
  ON proj_evidence_manifests (run_status, finalized_at DESC);
