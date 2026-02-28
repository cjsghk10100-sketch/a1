BEGIN;

-- Runtime hardening: rate-limit storage tuning + no updated_at index hotspot.
ALTER TABLE IF EXISTS public.rate_limit_buckets
  SET (
    fillfactor = 70,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
  );

DROP INDEX IF EXISTS idx_rate_limit_buckets_updated_at;

-- DLQ hardening: keep redacted/truncated raw payload snapshot for triage.
ALTER TABLE IF EXISTS public.dead_letter_messages
  ADD COLUMN IF NOT EXISTS raw_payload TEXT;

-- Projector hardening: occurred_at watermark per projection row.
ALTER TABLE IF EXISTS public.proj_experiments
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.proj_runs
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.proj_approvals
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.proj_incidents
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.proj_evidence_manifests
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.proj_scorecards
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

UPDATE public.proj_experiments
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

UPDATE public.proj_runs
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

UPDATE public.proj_approvals
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

UPDATE public.proj_incidents
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

UPDATE public.proj_evidence_manifests
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

UPDATE public.proj_scorecards
SET last_event_occurred_at = updated_at
WHERE last_event_occurred_at IS NULL;

COMMIT;
