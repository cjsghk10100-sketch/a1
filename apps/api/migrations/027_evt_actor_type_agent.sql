-- Expand evt_events.actor_type to include agent principals.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evt_events_actor_type_check'
      AND conrelid = 'evt_events'::regclass
  ) THEN
    ALTER TABLE evt_events
      DROP CONSTRAINT evt_events_actor_type_check;
  END IF;
END $$;

ALTER TABLE evt_events
  ADD CONSTRAINT evt_events_actor_type_check
  CHECK (actor_type IN ('service', 'user', 'agent'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proj_approvals_requested_by_type_check'
      AND conrelid = 'proj_approvals'::regclass
  ) THEN
    ALTER TABLE proj_approvals
      DROP CONSTRAINT proj_approvals_requested_by_type_check;
  END IF;
END $$;

ALTER TABLE proj_approvals
  ADD CONSTRAINT proj_approvals_requested_by_type_check
  CHECK (requested_by_type IN ('service', 'user', 'agent'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proj_approvals_decided_by_type_check'
      AND conrelid = 'proj_approvals'::regclass
  ) THEN
    ALTER TABLE proj_approvals
      DROP CONSTRAINT proj_approvals_decided_by_type_check;
  END IF;
END $$;

ALTER TABLE proj_approvals
  ADD CONSTRAINT proj_approvals_decided_by_type_check
  CHECK (decided_by_type IN ('service', 'user', 'agent'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sec_principals_legacy_actor_type_check'
      AND conrelid = 'sec_principals'::regclass
  ) THEN
    ALTER TABLE sec_principals
      DROP CONSTRAINT sec_principals_legacy_actor_type_check;
  END IF;
END $$;

ALTER TABLE sec_principals
  ADD CONSTRAINT sec_principals_legacy_actor_type_check
  CHECK (legacy_actor_type IS NULL OR legacy_actor_type IN ('service', 'user', 'agent'));
