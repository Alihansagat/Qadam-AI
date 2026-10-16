CREATE TABLE qadam_datasets (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sales', 'marketing')),
  fingerprint TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload', 'demo')),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(owner, kind, fingerprint)
);
--> statement-breakpoint
CREATE INDEX qadam_datasets_owner_kind ON qadam_datasets(owner, kind, created_at);
--> statement-breakpoint
CREATE TABLE qadam_dataset_heads (
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sales', 'marketing')),
  dataset_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner, kind)
);
