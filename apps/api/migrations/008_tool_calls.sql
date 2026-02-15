-- Tool call projections (tool.* events)

CREATE TABLE IF NOT EXISTS proj_tool_calls (
  tool_call_id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  room_id TEXT NULL,
  thread_id TEXT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,

  tool_name TEXT NOT NULL,
  title TEXT NULL,

  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),

  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NOT NULL DEFAULT '{}'::jsonb,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  correlation_id TEXT NOT NULL,
  last_event_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS proj_tool_calls_run_started_at_idx
  ON proj_tool_calls (run_id, started_at ASC);

CREATE INDEX IF NOT EXISTS proj_tool_calls_step_started_at_idx
  ON proj_tool_calls (step_id, started_at ASC);

