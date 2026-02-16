-- Resource labels for Data Access Control (DAC)

CREATE TABLE IF NOT EXISTS sec_resource_labels (
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('public', 'internal', 'restricted', 'confidential', 'sensitive_pii')),
  room_id TEXT NULL,
  purpose_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS sec_resource_labels_workspace_label_updated_idx
  ON sec_resource_labels (workspace_id, label, updated_at DESC);

CREATE INDEX IF NOT EXISTS sec_resource_labels_workspace_room_updated_idx
  ON sec_resource_labels (workspace_id, room_id, updated_at DESC)
  WHERE room_id IS NOT NULL;
