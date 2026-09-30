/**
 * MyPrivacyTOOL — Scheduled purge of expired OSINT scan results (MPC-6957)
 *
 * Runs from the Cron Trigger in wrangler.toml. Deletes `conversations`
 * documents past retention:
 *   1. expiresAt <= now          (records written with an explicit expiry)
 *   2. ts <= now - retention     (legacy records written before expiresAt existed)
 *
 * Retention: SCAN_RETENTION_DAYS (default 730 days / 2 years, per Privacy Policy).
 * Only counts are logged — never document IDs or contents (they contain PII).
 */

import { queryExpiredDocs, deleteDoc, retentionMs } from './firestore-client.js';

const PAGE_SIZE = 300;
const MAX_PAGES = 20; // bound work per run; the next cron run continues

export async function purgeExpiredScanResults(env, now = Date.now()) {
  if (!env.GCP_PROJECT_ID || !env.FIRESTORE_SA_TOKEN) {
    console.warn('Firestore not configured — skipping scan-result purge');
    return { deleted: 0, failed: 0 };
  }

  const passes = [
    ['expiresAt', now],
    ['ts', now - retentionMs(env)],
  ];

  let deleted = 0;
  let failed = 0;

  for (const [field, cutoff] of passes) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let names;
      try {
        names = await queryExpiredDocs(env, field, cutoff, PAGE_SIZE);
      } catch (err) {
        console.error(`Purge query failed (${field}):`, err.message);
        failed++;
        break;
      }
      if (names.length === 0) break;

      const results = await Promise.allSettled(names.map((n) => deleteDoc(env, n)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      deleted += ok;
      failed += names.length - ok;

      // Nothing deletable this page (all failed) — stop to avoid a hot loop.
      if (ok === 0 || names.length < PAGE_SIZE) break;
    }
  }

  console.log(`Scan-result purge complete: deleted=${deleted} failed=${failed}`);
  return { deleted, failed };
}
