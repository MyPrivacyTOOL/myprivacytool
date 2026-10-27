-- CK-8482: truthful per-platform publication state. ADDITIVE ONLY (two new tables; nothing existing is altered).
--   npx wrangler d1 execute mpt-agent-logs --remote --file=workers/mpt-content-consumer/migrations/0004_publication_receipts.sql
-- Rollback (drops only data written by CK-8482 code): DROP TABLE publication_receipts; DROP TABLE receipt_callbacks;
--
-- state: drafted | approved | handed_off | verified_published | failed
--   handed_off = Make accepted the webhook (HTTP 2xx). It is NOT proof of publication.
--   verified_published is set ONLY by an authenticated platform receipt (or an approved reconciliation).
-- outcome_unknown = 1: a timeout / network error after the request may have been delivered. The platform is never
--   re-sent until reconciliation says the hand-off was not received.
CREATE TABLE IF NOT EXISTS publication_receipts (
  id               TEXT PRIMARY KEY,          -- <drafted_content_id>:<platform>, also the per-platform idempotency key
  content_id       TEXT NOT NULL,
  platform         TEXT NOT NULL,
  state            TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  outcome_unknown  INTEGER NOT NULL DEFAULT 0,
  dead_letter      INTEGER NOT NULL DEFAULT 0,
  make_run_id      TEXT,
  post_id          TEXT,
  post_url         TEXT,
  published_at     TEXT,
  provenance       TEXT,                      -- 'callback:<receipt_id>' | 'reconcile:<source>'
  last_error       TEXT,
  handed_off_at    TEXT,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pub_receipts_content ON publication_receipts (content_id);
CREATE INDEX IF NOT EXISTS idx_pub_receipts_state ON publication_receipts (state, next_attempt_at);

-- Replay protection: every receipt_id is accepted at most once.
CREATE TABLE IF NOT EXISTS receipt_callbacks (
  receipt_id   TEXT PRIMARY KEY,
  content_id   TEXT,
  platform     TEXT,
  received_at  TEXT,
  result       TEXT
);
