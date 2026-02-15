-- Audit hash chain (tamper-evidence, append-only safe)
--
-- Note: We do NOT backfill old rows because evt_events is append-only.

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS prev_event_hash TEXT;

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

CREATE INDEX IF NOT EXISTS evt_events_event_hash_idx
  ON evt_events (event_hash)
  WHERE event_hash IS NOT NULL;

