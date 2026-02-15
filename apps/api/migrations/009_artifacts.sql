-- Artifact projections (artifact.* events)

CREATE TABLE IF NOT EXISTS proj_artifacts (
  artifact_id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,

  kind TEXT NOT NULL,
  title TEXT NULL,
  mime_type TEXT NULL,
  size_bytes BIGINT NULL,
  sha256 TEXT NULL,

  content_type TEXT NOT NULL CHECK (content_type IN ('none', 'text', 'json', 'uri')),
  content_text TEXT NULL,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_uri TEXT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  correlation_id TEXT NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_artifacts_run_created_at_idx
  ON proj_artifacts (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS proj_artifacts_step_created_at_idx
  ON proj_artifacts (step_id, created_at ASC);

