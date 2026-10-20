-- mpt-agent-logs (D1, Cloudflare account 35cb17172c65a20f5cf1baf131485382, id b9dc1a03-74be-45a0-85db-fb61d80825ac)
-- Applied 2026-10-20 (schema exactly as specified by OpenClaw). Re-apply elsewhere with:
--   npx wrangler d1 execute mpt-agent-logs --remote --file=migrations/0001_init.sql
-- agent_execution_logs: one row per state change / per draft. status values used by the Workers:
--   queued, running, drafted (one row per platform, draft_content = JSON), notified (draft_content = Slack channel+ts),
--   approved, rejected, published, failed.

CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id            TEXT PRIMARY KEY,
  timestamp     TEXT,
  task_id       TEXT,
  status        TEXT,
  error_message TEXT,
  draft_content TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_execution_logs (task_id, timestamp);

CREATE TABLE IF NOT EXISTS social_metrics (
  id          TEXT PRIMARY KEY,
  timestamp   TEXT,
  platform    TEXT,
  topic       TEXT,
  impressions INTEGER,
  engagement  INTEGER,
  url         TEXT
);
CREATE INDEX IF NOT EXISTS idx_social_metrics_platform ON social_metrics (platform, timestamp);
