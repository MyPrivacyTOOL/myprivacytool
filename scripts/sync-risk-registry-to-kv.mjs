#!/usr/bin/env node
// Sync the Notion "Hexagon Risk Registry" (130 agent risks, 5 pillars) into the Workers KV
// namespace MPT_AGENT_RISK_REGISTRY so edge readers get sub-5ms lookups instead of hitting Notion/Supabase.
//
// Notion stays the source of truth; KV is a read-only cache. Re-run after any registry edit.
//
// Required env (names only, never commit values):
//   NOTION_TOKEN            internal integration with the Hexagon Risk Registry database shared to it
//   CLOUDFLARE_API_TOKEN    token with Account > Workers KV Storage > Edit
//   CLOUDFLARE_ACCOUNT_ID   35cb17172c65a20f5cf1baf131485382
// Optional env:
//   KV_NAMESPACE_ID         default: dea24686a03f47b899436b717301c729 (MPT_AGENT_RISK_REGISTRY)
//   REGISTRY_DATA_SOURCE_ID default: 65fd2b3f-be60-4099-b541-542200a6e991 (Hexagon Risk Registry)
//
// Usage: node scripts/sync-risk-registry-to-kv.mjs [--dry-run]
//
// KV layout:
//   risk:<Risk ID>  -> {id,name,description,category,pillar,likelihood,impact,exploitability,detection_method,review_status}
//   index           -> {synced_at,count,reviewed_count,risks:[{id,name,pillar,category,review_status}]}
// Scores are the raw Notion L/I/E values. The Notion "Weight" formula is not readable through the API,
// so consumers must compute weights themselves. Rows with review_status "Draft" carry default,
// not-yet-reviewed scores.

const NOTION_VERSION = '2025-09-03';
const dryRun = process.argv.includes('--dry-run');
const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
};

const notionToken = need('NOTION_TOKEN');
const cfToken = dryRun ? process.env.CLOUDFLARE_API_TOKEN : need('CLOUDFLARE_API_TOKEN');
const accountId = dryRun ? process.env.CLOUDFLARE_ACCOUNT_ID : need('CLOUDFLARE_ACCOUNT_ID');
const nsId = process.env.KV_NAMESPACE_ID || 'dea24686a03f47b899436b717301c729';
const dataSourceId = process.env.REGISTRY_DATA_SOURCE_ID || '65fd2b3f-be60-4099-b541-542200a6e991';

const text = (p) => (p?.rich_text ?? p?.title ?? []).map((t) => t.plain_text).join('');
const sel = (p) => p?.select?.name ?? null;
const num = (p) => (typeof p?.number === 'number' ? p.number : null);

async function fetchAllRows() {
  const rows = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!res.ok) throw new Error(`Notion query failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    rows.push(...body.results);
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return rows;
}

function toRisk(page) {
  const p = page.properties;
  return {
    id: num(p['Risk ID']),
    name: text(p.Name),
    description: text(p.Description),
    category: sel(p.Category),
    pillar: sel(p.Pillar),
    likelihood: num(p.Likelihood),
    impact: num(p.Impact),
    exploitability: num(p.Exploitability),
    detection_method: text(p['Detection method']),
    review_status: sel(p['Review status']),
  };
}

const rows = await fetchAllRows();
const risks = rows.map(toRisk).filter((r) => r.id !== null).sort((a, b) => a.id - b.id);
if (risks.length === 0) { console.error('No risks returned; refusing to overwrite KV.'); process.exit(1); }
const ids = new Set(risks.map((r) => r.id));
if (ids.size !== risks.length) { console.error('Duplicate Risk IDs in Notion; fix the registry first.'); process.exit(1); }

const index = {
  synced_at: new Date().toISOString(),
  count: risks.length,
  reviewed_count: risks.filter((r) => r.review_status === 'Reviewed').length,
  risks: risks.map(({ id, name, pillar, category, review_status }) => ({ id, name, pillar, category, review_status })),
};
const pairs = [
  ...risks.map((r) => ({ key: `risk:${r.id}`, value: JSON.stringify(r) })),
  { key: 'index', value: JSON.stringify(index) },
];

console.log(`${risks.length} risks (${index.reviewed_count} reviewed) -> ${pairs.length} KV keys in ${nsId}`);
if (dryRun) { console.log('dry run: nothing written'); process.exit(0); }

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${nsId}/bulk`,
  {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pairs),
  },
);
const out = await res.json();
if (!res.ok || !out.success) { console.error('KV bulk write failed', JSON.stringify(out.errors)); process.exit(1); }
console.log('KV sync complete');
