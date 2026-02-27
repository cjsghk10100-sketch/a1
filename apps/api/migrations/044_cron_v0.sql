BEGIN;

-- 1) Distributed lock with fencing token
CREATE TABLE IF NOT EXISTS public.cron_locks(
  lock_name    TEXT PRIMARY KEY,
  holder_id    TEXT NOT NULL,
  lock_token   TEXT NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_locks_expires
  ON public.cron_locks(expires_at);

-- 2) Watchdog health table
CREATE TABLE IF NOT EXISTS public.cron_health(
  check_name           TEXT PRIMARY KEY,
  last_success_at      TIMESTAMPTZ,
  last_failure_at      TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error           TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 3) Optional performance indexes for cron candidate scans (safe guards)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_approvals'
      AND column_name = 'workspace_id'
  ) THEN
    EXECUTE
      'CREATE INDEX IF NOT EXISTS idx_proj_approvals_cron_pending_timeout
         ON public.proj_approvals (workspace_id, updated_at ASC)
         WHERE status IN (''pending'', ''held'')';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_runs'
      AND column_name = 'workspace_id'
  ) THEN
    EXECUTE
      'CREATE INDEX IF NOT EXISTS idx_proj_runs_cron_stuck
         ON public.proj_runs (workspace_id, updated_at ASC)
         WHERE status IN (''queued'', ''running'')';
    EXECUTE
      'CREATE INDEX IF NOT EXISTS idx_proj_runs_cron_demoted_stale
         ON public.proj_runs (workspace_id, updated_at ASC)
         WHERE status = ''failed''';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_incidents'
      AND column_name = 'workspace_id'
  ) THEN
    EXECUTE
      'CREATE INDEX IF NOT EXISTS idx_proj_incidents_cron_open_lookup
         ON public.proj_incidents (workspace_id, status, run_id, correlation_id, updated_at DESC)
         WHERE status = ''open''';
  END IF;
END $$;

COMMIT;
