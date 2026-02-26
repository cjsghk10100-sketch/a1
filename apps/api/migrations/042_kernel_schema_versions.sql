BEGIN;

-- NOTE: idempotent table creation
CREATE TABLE IF NOT EXISTS public.kernel_schema_versions (
  id          SERIAL PRIMARY KEY,
  version     TEXT        NOT NULL,
  is_current  BOOLEAN     NOT NULL DEFAULT false,
  change_type TEXT        NOT NULL
              CHECK (change_type IN ('MAJOR','MINOR','PATCH')),
  description TEXT,
  applied_at  TIMESTAMPTZ DEFAULT now()
);

-- NOTE: unique constraint — only one row may be current at a time
CREATE UNIQUE INDEX IF NOT EXISTS uidx_current_kernel_version
  ON public.kernel_schema_versions (is_current)
  WHERE is_current = true;

-- NOTE: also prevent duplicate version strings (required for ON CONFLICT below)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_kernel_version_str
  ON public.kernel_schema_versions (version);

-- NOTE: seed two rows so contract test can assert previous + current exist.
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).
INSERT INTO public.kernel_schema_versions
  (version, is_current, change_type, description)
VALUES
  ('2.0', false, 'MINOR', 'previous supported contract'),
  ('2.1', true,  'MINOR', 'current contract baseline')
ON CONFLICT (version) DO NOTHING;

COMMIT;
