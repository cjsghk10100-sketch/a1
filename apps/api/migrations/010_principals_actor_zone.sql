-- Principals + actor_principal_id + zone (additive envelope hardening)

CREATE TABLE IF NOT EXISTS sec_principals (
  principal_id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'agent', 'service')),

  -- Optional mapping for legacy event actors (current event store uses actor_type/actor_id).
  legacy_actor_type TEXT NULL CHECK (legacy_actor_type IN ('service', 'user')),
  legacy_actor_id TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,

  -- Either both legacy fields are set, or neither is set.
  CHECK (
    (legacy_actor_type IS NULL AND legacy_actor_id IS NULL) OR
    (legacy_actor_type IS NOT NULL AND legacy_actor_id IS NOT NULL)
  ),

  UNIQUE (legacy_actor_type, legacy_actor_id)
);

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS actor_principal_id TEXT;

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS zone TEXT NOT NULL DEFAULT 'supervised'
    CHECK (zone IN ('sandbox', 'supervised', 'high_stakes'));

CREATE INDEX IF NOT EXISTS evt_events_actor_principal_recorded_at_idx
  ON evt_events (actor_principal_id, recorded_at DESC)
  WHERE actor_principal_id IS NOT NULL;

