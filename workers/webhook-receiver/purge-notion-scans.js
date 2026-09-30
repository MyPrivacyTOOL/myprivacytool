/**
 * MyPrivacyTOOL — Scheduled purge of expired OSINT scan results (MPC-6957)
 *
 * Archives rows in the Notion "MPT OSINT Scan Results" database whose
 * `Expires At` is in the past. The Notion API has no hard delete, so rows are
 * archived (moved to Notion trash, which Notion permanently deletes after 30 days).
 *
 * Secrets: NOTION_TOKEN, TELEGRAM_BOT_KEY, TELEGRAM_ALERT_CHAT_ID
 * Optional var: NOTION_SCAN_DB_ID (defaults to the MPT OSINT Scan Results DB)
 *
 * Logs and alerts contain counts only — never row titles, handles or IDs (PII).
 */

const DEFAULT_DB_ID = 'db459759-5604-4021-9be0-80dc7d39f3ac';
const NOTION_VERSION = '2022-06-28';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;   // bound work per run; the next hourly run continues
const CONCURRENCY = 3;  // Notion allows ~3 req/s

async function notion(env, path, method, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path.split('/')[1]} -> ${res.status}`);
  return res.json();
}

async function sendAlert(env, text) {
  if (!env.TELEGRAM_BOT_KEY || !env.TELEGRAM_ALERT_CHAT_ID) {
    console.warn('Telegram alerting not configured');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_KEY}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_ALERT_CHAT_ID, text }),
    });
  } catch (err) {
    console.error('Alert send failed:', err.message);
  }
}

export async function purgeExpiredScanResults(env, now = Date.now()) {
  if (!env.NOTION_TOKEN) {
    console.warn('NOTION_TOKEN not set — skipping scan-result purge');
    return { archived: 0, failed: 0, skipped: true };
  }

  const dbId = env.NOTION_SCAN_DB_ID || DEFAULT_DB_ID;
  const nowIso = new Date(now).toISOString();
  let archived = 0;
  let failed = 0;
  let error = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // Always re-query from the start: archived rows drop out of the result set.
      const { results } = await notion(env, `/databases/${dbId}/query`, 'POST', {
        filter: { property: 'Expires At', date: { before: nowIso } },
        page_size: PAGE_SIZE,
      });
      if (results.length === 0) break;

      let ok = 0;
      for (let i = 0; i < results.length; i += CONCURRENCY) {
        const batch = results.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((r) => notion(env, `/pages/${r.id}`, 'PATCH', { archived: true }))
        );
        ok += settled.filter((s) => s.status === 'fulfilled').length;
      }
      archived += ok;
      failed += results.length - ok;

      // Nothing archived this page (all failed) — stop to avoid a hot loop.
      if (ok === 0 || results.length < PAGE_SIZE) break;
    }
  } catch (err) {
    error = err.message;
    console.error('Scan-result purge error:', error);
  }

  console.log(`Scan-result purge complete: archived=${archived} failed=${failed}${error ? ' error' : ''}`);

  if (error || failed > 0) {
    await sendAlert(
      env,
      `⚠️ MPT OSINT scan purge problem: archived=${archived} failed=${failed}` +
        (error ? ` error="${error}"` : '')
    );
  }
  return { archived, failed, error };
}
