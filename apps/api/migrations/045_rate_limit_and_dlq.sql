BEGIN;

-- 1) Rate limit buckets (unbounded growth mitigation needs cleanup, see below)
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_sec   INT NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start, window_sec)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated_at
  ON public.rate_limit_buckets(updated_at);

-- 2) Rate limit streaks (3 consecutive 429 => incident, plus mute)
CREATE TABLE IF NOT EXISTS public.rate_limit_streaks (
  workspace_id TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  scope        TEXT NOT NULL,  -- e.g. 'messages_write'
  consecutive_429 INT NOT NULL DEFAULT 0,
  last_429_at     TIMESTAMPTZ,
  last_incident_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id, scope)
);

-- 3) Message failure counters (poison detection)
CREATE TABLE IF NOT EXISTS public.message_failure_counters (
  workspace_id TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ,
  last_failed_at  TIMESTAMPTZ,
  last_error      TEXT,
  dlq_at          TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id)
);

-- 4) DLQ table
CREATE TABLE IF NOT EXISTS public.dead_letter_messages (
  workspace_id TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at  TIMESTAMPTZ NOT NULL,
  failure_count   INT NOT NULL,
  last_error      TEXT,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  PRIMARY KEY (workspace_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_messages_created_at
  ON public.dead_letter_messages(created_at);

COMMIT;
