-- Agent quarantine state (manual)

ALTER TABLE sec_agents
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ NULL;

ALTER TABLE sec_agents
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS sec_agents_quarantined_at_idx
  ON sec_agents (quarantined_at DESC)
  WHERE quarantined_at IS NOT NULL;
