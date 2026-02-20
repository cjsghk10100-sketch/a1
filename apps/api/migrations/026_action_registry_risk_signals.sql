-- Action registry metadata hardening:
-- - cost_impact: low|medium|high
-- - recovery_difficulty: easy|moderate|hard

WITH seeded(action_type, cost_impact, recovery_difficulty) AS (
  VALUES
    ('artifact.create', 'low', 'easy'),
    ('artifact.update', 'low', 'easy'),
    ('external.write', 'high', 'hard'),
    ('email.send', 'medium', 'hard'),
    ('payment.execute', 'high', 'hard'),
    ('api.call.idempotent', 'low', 'easy'),
    ('api.call.mutating', 'high', 'hard')
)
UPDATE sec_action_registry AS ar
SET metadata = jsonb_set(
                 jsonb_set(
                   COALESCE(ar.metadata, '{}'::jsonb),
                   '{cost_impact}',
                   to_jsonb(COALESCE(ar.metadata->>'cost_impact', seeded.cost_impact)),
                   TRUE
                 ),
                 '{recovery_difficulty}',
                 to_jsonb(COALESCE(ar.metadata->>'recovery_difficulty', seeded.recovery_difficulty)),
                 TRUE
               ),
    updated_at = now()
FROM seeded
WHERE ar.action_type = seeded.action_type;

-- Ensure any custom rows also get safe defaults when metadata keys are missing.
UPDATE sec_action_registry
SET metadata = jsonb_set(
                 jsonb_set(
                   COALESCE(metadata, '{}'::jsonb),
                   '{cost_impact}',
                   to_jsonb(COALESCE(metadata->>'cost_impact', 'low')),
                   TRUE
                 ),
                 '{recovery_difficulty}',
                 to_jsonb(COALESCE(metadata->>'recovery_difficulty', 'easy')),
                 TRUE
               ),
    updated_at = now()
WHERE metadata->>'cost_impact' IS NULL
   OR metadata->>'recovery_difficulty' IS NULL;
