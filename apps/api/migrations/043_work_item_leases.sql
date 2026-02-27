BEGIN;

CREATE TABLE IF NOT EXISTS public.work_item_leases (
  workspace_id       TEXT        NOT NULL,
  work_item_type     TEXT        NOT NULL,
  work_item_id       TEXT        NOT NULL,
  lease_id           TEXT        NOT NULL,
  agent_id           TEXT        NOT NULL,
  correlation_id     TEXT        NOT NULL,
  claimed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  version            INT         NOT NULL DEFAULT 1,

  PRIMARY KEY (workspace_id, work_item_type, work_item_id),

  CONSTRAINT chk_work_item_type
    CHECK (work_item_type IN (
      'experiment','approval','message','incident','artifact'
    ))
);

CREATE INDEX IF NOT EXISTS idx_leases_workspace_expires
  ON public.work_item_leases (workspace_id, expires_at);

-- Ensure evt_events has required columns for R14.
ALTER TABLE public.evt_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS entity_type     TEXT,
  ADD COLUMN IF NOT EXISTS entity_id       TEXT,
  ADD COLUMN IF NOT EXISTS actor           TEXT;

-- Create UNIQUE idempotency index safely:
-- 1) only if column exists
-- 2) only if index doesn't exist
-- 3) only if there are NO existing duplicates (otherwise skip to avoid breaking migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='evt_events' AND column_name='idempotency_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='evt_events' AND indexname='uidx_evt_events_idempotency_key'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.evt_events
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key
      HAVING COUNT(*) > 1
      LIMIT 1
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX uidx_evt_events_idempotency_key
               ON public.evt_events (idempotency_key)
               WHERE idempotency_key IS NOT NULL';
    ELSE
      RAISE NOTICE 'Skipping uidx_evt_events_idempotency_key: duplicate idempotency_key exists';
    END IF;
  END IF;
END$$;

COMMIT;
