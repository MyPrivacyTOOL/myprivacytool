-- Migration: Create ab_test_config D1 table for A/B test kill switch
-- MPC-8365 — Scan Reveal A/B Testing
-- Date: 2026-10-23
-- Status: Ready to run

CREATE TABLE IF NOT EXISTS ab_test_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'legacy')),
  test_name TEXT DEFAULT 'scan_reveal_batch1_osint',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- Insert initial row if table was just created
INSERT OR IGNORE INTO ab_test_config (id, mode, test_name, notes)
VALUES (
  1,
  'active',
  'scan_reveal_batch1_osint',
  'Batch 1 OSINT scan-reveal A/B test (MPC-8365). Mode: active = 50/50 split; legacy = 100% to legacy reveal.'
);

-- Verification query:
-- SELECT * FROM ab_test_config WHERE id = 1;

-- To enable kill switch (100% legacy):
-- UPDATE ab_test_config SET mode = 'legacy', updated_at = CURRENT_TIMESTAMP WHERE id = 1;

-- To disable kill switch (resume 50/50):
-- UPDATE ab_test_config SET mode = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = 1;
