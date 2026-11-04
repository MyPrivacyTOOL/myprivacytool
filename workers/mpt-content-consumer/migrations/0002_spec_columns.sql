-- MPC-8371: add the autonomous-pipeline columns to mpt-agent-logs (id b9dc1a03-74be-45a0-85db-fb61d80825ac).
-- ADDITIVE ONLY: 0001's columns (draft_content, timestamp, topic, engagement, url) stay because the deployed
-- content-consumer / content-approval Workers write them. Applied 2026-10-20 (both tables were empty).
-- Re-apply on a fresh database only, after 0001 (SQLite has no ADD COLUMN IF NOT EXISTS):
--   npx wrangler d1 execute mpt-agent-logs --remote --file=migrations/0002_spec_columns.sql
--
-- Resulting shape matches the MPC-8371 spec:
--   agent_execution_logs: id PK, agent_id, timestamp, task_id, action, result, status, error_message
--   social_metrics:       id PK, platform, post_id, date, impressions, engagement_rate, clicks, conversion_rate, ctr

ALTER TABLE agent_execution_logs ADD COLUMN agent_id TEXT;
ALTER TABLE agent_execution_logs ADD COLUMN action TEXT;
ALTER TABLE agent_execution_logs ADD COLUMN result TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_execution_logs (agent_id, timestamp);

ALTER TABLE social_metrics ADD COLUMN post_id TEXT;
ALTER TABLE social_metrics ADD COLUMN date TEXT;
ALTER TABLE social_metrics ADD COLUMN engagement_rate REAL;
ALTER TABLE social_metrics ADD COLUMN clicks INTEGER;
ALTER TABLE social_metrics ADD COLUMN conversion_rate REAL;
ALTER TABLE social_metrics ADD COLUMN ctr REAL;
CREATE INDEX IF NOT EXISTS idx_social_metrics_post ON social_metrics (platform, post_id, date);
