-- Action registry (reversible + zone classification)
--
-- This is a catalog only. Enforcement is done in later tasks (Policy Gate v2).

CREATE TABLE IF NOT EXISTS sec_action_registry (
  action_type TEXT PRIMARY KEY,
  reversible BOOLEAN NOT NULL,
  zone_required TEXT NOT NULL CHECK (zone_required IN ('sandbox', 'supervised', 'high_stakes')),

  requires_pre_approval BOOLEAN NOT NULL DEFAULT FALSE,
  post_review_required BOOLEAN NOT NULL DEFAULT FALSE,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed minimal actions (idempotent).
INSERT INTO sec_action_registry (action_type, reversible, zone_required, requires_pre_approval, post_review_required, metadata)
VALUES
  ('artifact.create', TRUE,  'supervised', FALSE, TRUE,  '{}'::jsonb),
  ('artifact.update', TRUE,  'supervised', FALSE, TRUE,  '{}'::jsonb),

  -- Default external writes to high-stakes until egress gateway/policies exist.
  ('external.write',  FALSE, 'high_stakes', TRUE, FALSE, '{}'::jsonb),

  ('email.send',      FALSE, 'high_stakes', TRUE, FALSE, '{}'::jsonb),
  ('payment.execute', FALSE, 'high_stakes', TRUE, FALSE, '{}'::jsonb),

  ('api.call.idempotent', TRUE,  'supervised', FALSE, TRUE, '{}'::jsonb),
  ('api.call.mutating',   FALSE, 'high_stakes', TRUE, FALSE, '{}'::jsonb)
ON CONFLICT (action_type) DO NOTHING;

