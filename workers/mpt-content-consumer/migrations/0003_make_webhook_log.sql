-- MPC-8374: one row per POST to the Make.com webhook (success and failure) from mpt-content-approval.
-- webhook_url is masked (origin + last 4 chars of the path): the full URL is a secret. request_body / response_body are truncated.
--   npx wrangler d1 execute mpt-agent-logs --remote --file=workers/mpt-content-consumer/migrations/0003_make_webhook_log.sql
CREATE TABLE IF NOT EXISTS make_webhook_log (
  id            TEXT PRIMARY KEY,
  timestamp     TEXT,
  task_id       TEXT,
  webhook_url   TEXT,
  status_code   INTEGER,
  request_body  TEXT,
  response_body TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_make_webhook_log_task ON make_webhook_log (task_id, timestamp);
