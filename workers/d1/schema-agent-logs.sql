-- DEPRECATED (MPC-8371): not valid SQLite (inline INDEX clauses) and never applied. The live schema is
-- workers/mpt-content-consumer/migrations/0001_init.sql + 0002_spec_columns.sql. Kept only for history.
-- mpt-agent-logs D1 database schema
-- Tracks all agent execution events and social metrics across the MPT fleet

CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
  agent_id TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  INDEX idx_task_id (task_id),
  INDEX idx_status (status),
  INDEX idx_timestamp (timestamp)
);

CREATE TABLE IF NOT EXISTS social_metrics (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  platform TEXT NOT NULL,
  post_count INTEGER,
  impressions INTEGER,
  engagements INTEGER,
  clicks INTEGER,
  conversions INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, platform),
  INDEX idx_date (date),
  INDEX idx_platform (platform)
);

CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  topic TEXT NOT NULL,
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  tone TEXT,
  asset_tags TEXT, -- JSON array
  status TEXT CHECK(status IN ('draft', 'approved', 'scheduled', 'published', 'rejected')),
  notion_page_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  published_at TEXT,
  INDEX idx_date (date),
  INDEX idx_status (status),
  INDEX idx_platform (platform)
);
