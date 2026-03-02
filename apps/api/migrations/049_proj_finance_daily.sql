BEGIN;

-- PR-12B: finance usage projection table
-- Reserved migration numbers:
--   050 -> PR-13
--   051 -> PR-14

CREATE TABLE IF NOT EXISTS public.proj_finance_daily (
  workspace_id TEXT NOT NULL,
  day_utc DATE NOT NULL,
  cost_usd_micros BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  event_count INT NOT NULL DEFAULT 0,
  last_event_id TEXT NOT NULL,
  last_event_occurred_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, day_utc)
);

ALTER TABLE public.proj_finance_daily
  ADD COLUMN IF NOT EXISTS cost_usd_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_event_id TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
