BEGIN;

-- PR-10: projector watermark storage for system health summary lag computation.
-- Reserved migration numbers:
--   048 -> PR-11 (health drilldown)
--   049 -> PR-12 (finance/cost projections)

CREATE TABLE IF NOT EXISTS public.projector_watermarks (
  workspace_id TEXT PRIMARY KEY,
  last_applied_event_occurred_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projector_watermarks
  ADD COLUMN IF NOT EXISTS last_applied_event_occurred_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
