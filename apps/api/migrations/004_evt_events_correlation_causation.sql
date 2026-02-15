-- Add correlation/causation ids to the event store for traceability/audit.
--
-- Note: evt_events is protected by an append-only trigger. For backfilling existing
-- rows we temporarily drop the trigger inside this migration transaction and
-- re-create it afterwards.

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS causation_id TEXT;

-- Backfill correlation_id for historical rows (use event_id as a stable fallback).
DROP TRIGGER IF EXISTS trg_evt_events_append_only ON evt_events;

UPDATE evt_events
SET correlation_id = event_id
WHERE correlation_id IS NULL;

ALTER TABLE evt_events
  ALTER COLUMN correlation_id SET NOT NULL;

-- Re-enable append-only guard.
CREATE TRIGGER trg_evt_events_append_only
BEFORE UPDATE OR DELETE ON evt_events
FOR EACH ROW EXECUTE FUNCTION evt_events_append_only_guard();

-- Inspector-style lookups
CREATE INDEX IF NOT EXISTS evt_events_correlation_recorded_at_idx
  ON evt_events (correlation_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS evt_events_causation_recorded_at_idx
  ON evt_events (causation_id, recorded_at DESC)
  WHERE causation_id IS NOT NULL;

