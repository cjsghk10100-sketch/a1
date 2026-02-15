-- Event query indexes for inspector/timeline.

CREATE INDEX IF NOT EXISTS evt_events_run_recorded_at_idx
  ON evt_events (workspace_id, run_id, recorded_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evt_events_step_recorded_at_idx
  ON evt_events (workspace_id, step_id, recorded_at DESC)
  WHERE step_id IS NOT NULL;

