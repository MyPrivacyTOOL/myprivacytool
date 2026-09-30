/**
 * MyPrivacyTOOL — Scheduled purge of expired OSINT scan results (MPC-6957)
 *
 * Runs from the Cron Trigger in wrangler.toml. Queries the Notion data source
 * "MPT OSINT Scan Results" for rows where `Expires At` < now (24h TTL) and
 * archives them (Notion's API has no hard delete; archived pages go to Trash
 * and are permanently removed by Notion after 30 days).
 *
 * Only counts are logged — never page IDs or contents (they may contain PII).
 * Any failure sends a Telegram alert (PURGE_ALERT_CHAT_ID + TELEGRAM_BOT_KEY).
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';
const DEFAULT_DATA_SOURCE_ID = 'dfd81319-00ce-45c9-ae1a-af5bc7eec516';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;        // bound work per run; the next cron run continues
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notionFetch(env, path, init = {}) {
  return fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
}

// Notion allows ~3 req/s; honour 429 Retry-After and retry transient 5xx.
async function notionRequest(env, path, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await notionFetch(env, path, init);
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`Notion ${res.status} on ${init?.method || 'GET'} ${path.split('/')[1]}`);
    }
    const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt;
    await sleep(wait * 1000);
  }
}

async function queryExpiredPageIds(env, dataSourceId, nowIso) {
  const data = await notionRequest(env, `/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { property: 'Expires At', date: { before: nowIso } },
      page_size: PAGE_SIZE,
    }),
  });
  return data.results.map((p) => p.id);
}

function archivePage(env, id) {
  return notionRequest(env, `/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

export async function alertPurgeFailure(env, summary) {
  console.error(`Scan-result purge FAILED: ${summary}`);
  if (!env.TELEGRAM_BOT_KEY || !env.PURGE_ALERT_CHAT_ID) {
    console.warn('Alert channel not configured (TELEGRAM_BOT_KEY / PURGE_ALERT_CHAT_ID)');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_KEY}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.PURGE_ALERT_CHAT_ID,
        text: `⚠️ MPC-6957 OSINT scan-result purge failed: ${summary}`,
      }),
    });
  } catch (err) {
    console.error('Failed to send purge alert:', err.message);
  }
}

export async function purgeExpiredScanResults(env, now = Date.now()) {
  if (!env.NOTION_TOKEN) {
    await alertPurgeFailure(env, 'NOTION_TOKEN secret is not configured');
    return { archived: 0, failed: 0, error: 'not_configured' };
  }

  const dataSourceId = env.NOTION_SCAN_RESULTS_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  const nowIso = new Date(now).toISOString();
  let archived = 0;
  let failed = 0;
  let error = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const ids = await queryExpiredPageIds(env, dataSourceId, nowIso);
      if (ids.length === 0) break;

      let ok = 0;
      for (const id of ids) {
        try {
          await archivePage(env, id);
          ok++;
        } catch (err) {
          failed++;
          error = error || err.message;
        }
      }
      archived += ok;

      // Nothing archivable this page — stop to avoid a hot loop.
      if (ok === 0 || ids.length < PAGE_SIZE) break;
    }
  } catch (err) {
    error = err.message;
    failed++;
  }

  console.log(`Scan-result purge complete: archived=${archived} failed=${failed}`);
  if (error) await alertPurgeFailure(env, `archived=${archived} failed=${failed} (${error})`);
  return { archived, failed, error };
}
