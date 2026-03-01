BEGIN;

-- PR-11: system health drilldown pagination indexes.
-- Reserved next migration number:
--   049 -> PR-12 (finance/cost projections)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dead_letter_messages'
      AND column_name = 'workspace_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dead_letter_messages'
      AND column_name = 'last_failed_at'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dead_letter_messages'
      AND column_name = 'message_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_dead_letter_messages_ws_last_failed_message
      ON public.dead_letter_messages (workspace_id, last_failed_at DESC, message_id DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_incidents'
      AND column_name = 'workspace_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_incidents'
      AND column_name = 'updated_at'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proj_incidents'
      AND column_name = 'incident_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_proj_incidents_ws_updated_incident
      ON public.proj_incidents (workspace_id, updated_at DESC, incident_id DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rate_limit_streaks'
      AND column_name = 'workspace_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rate_limit_streaks'
      AND column_name = 'last_429_at'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rate_limit_streaks'
      AND column_name = 'agent_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_rate_limit_streaks_ws_last429_agent
      ON public.rate_limit_streaks (workspace_id, last_429_at DESC, agent_id DESC)
    ';
  END IF;
END $$;

COMMIT;
