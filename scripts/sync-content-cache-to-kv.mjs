#!/usr/bin/env node
// Sync the Notion "WORKSTREAM 3: Content Distribution Schedule" and "Brand Guidelines" pages into the Workers KV
// namespace mpt-content-cache so the content consumer Worker gets sub-5ms reads instead of hitting Notion.
// Notion stays the source of truth; KV is a read-only cache. Run daily (.github/workflows/sync-content-cache.yml,
// or point a Make.com scheduled scenario at that workflow's workflow_dispatch).
//
// Required env (names only, never commit values):
//   NOTION_TOKEN            internal integration with both pages shared to it
//   CLOUDFLARE_API_TOKEN    token with Account > Workers KV Storage > Edit
//   CLOUDFLARE_ACCOUNT_ID   35cb17172c65a20f5cf1baf131485382
// Optional env:
//   KV_NAMESPACE_ID         default: 15f4c0ac614b4c60954dd42e9d8c8ee5 (mpt-content-cache)
//   SCHEDULE_PAGE_ID        default: 3f128547-eaa7-81ed-8e81-e74b87da1efc
//   BRAND_PAGE_ID           default: 38128547-eaa7-81fb-87d2-f4387c836045
//   CONTENT_YEAR            default: 2026 (the schedule lists "Oct 9", no year)
//
// Usage: node scripts/sync-content-cache-to-kv.mjs [--dry-run]
//
// KV layout:
//   schedule:<YYYY-MM-DD> -> {date, items:{pillar|blog|x|reddit|linkedin:[{text,qualifier}]}}
//   schedule:index        -> {synced_at, count, dates:[...]}
//   brand:guidelines      -> {synced_at, title, sections:[{heading,text}]}

import { pathToFileURL } from 'node:url';

const NOTION_VERSION = '2022-06-28';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ITEM_RE = /^[-•*\s]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*\(([^)]*)\))?\s*:\s*(.+)$/i;

const SECTIONS = [
  [/PILLAR POST/i, 'pillar'],
  [/SUPPORTING CONTENT/i, 'blog'],
  [/TWITTER|X THREADS/i, 'x'],
  [/REDDIT/i, 'reddit'],
  [/LINKEDIN/i, 'linkedin'],
];

/**
 * Pages pasted in as plain text carry their markdown literally: a paragraph block whose text reads "## PILLAR POST ..."
 * (often several lines in one block) instead of a real heading block. Split such blocks per line and turn "#"/"##"/"###"
 * lines into heading blocks, so real and pasted headings parse the same. Idempotent; real heading blocks pass through.
 */
export function normalizeBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (/^heading_[123]$/.test(b.type) || typeof b.text !== 'string' || !b.text.includes('\n') && !/^\s*#{1,3}\s/.test(b.text)) { out.push(b); continue; }
    for (const line of b.text.split('\n')) {
      const h = /^\s*(#{1,3})\s+(.*)$/.exec(line);
      if (h) out.push({ type: `heading_${h[1].length}`, text: h[2].replace(/\*\*/g, '').trim() });
      else out.push({ ...b, text: line });
    }
  }
  return out;
}

/** blocks: [{type, text, level?}] flattened in page order. Returns {'YYYY-MM-DD': {date, items}}. */
export function parseSchedule(blocks, year = 2026) {
  const out = {};
  let section = null;
  for (const b of normalizeBlocks(blocks)) {
    if (b.type === 'heading_1' || b.type === 'heading_2') {
      section = SECTIONS.find(([re]) => re.test(b.text))?.[1] ?? null;
      continue;
    }
    if (!section || b.type === 'heading_3') continue;
    const m = ITEM_RE.exec(b.text.trim());
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase()];
    const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    const qualifier = /^(mon|tue|wed|thu|fri|sat|sun)/i.test(m[3] ?? '') ? null : (m[3] || null); // weekday vs subreddit
    const day = (out[date] ??= { date, items: {} });
    (day.items[section] ??= []).push({ text: m[4].replace(/\*\*/g, '').trim(), qualifier });
  }
  return out;
}

/** Splits flattened blocks into [{heading, text}] on h1/h2/h3 so consumers can pick sections by heading. */
export function toSections(blocks) {
  const sections = [{ heading: 'Overview', text: '' }];
  for (const b of normalizeBlocks(blocks)) {
    if (/^heading_[123]$/.test(b.type)) sections.push({ heading: b.text, text: '' });
    else if (b.text) { const s = sections.at(-1); s.text += (s.text ? '\n' : '') + b.text; }
  }
  return sections.filter((s) => s.text || s.heading !== 'Overview');
}

export function buildPairs({ scheduleBlocks, brandBlocks, brandTitle, year, now = new Date() }) {
  const days = parseSchedule(scheduleBlocks, year);
  const dates = Object.keys(days).sort();
  if (!dates.length) throw new Error('No dated items parsed from the schedule page; refusing to overwrite KV.');
  const synced_at = now.toISOString();
  return [
    ...dates.map((d) => ({ key: `schedule:${d}`, value: JSON.stringify(days[d]) })),
    { key: 'schedule:index', value: JSON.stringify({ synced_at, count: dates.length, dates }) },
    { key: 'brand:guidelines', value: JSON.stringify({ synced_at, title: brandTitle, sections: toSections(brandBlocks) }) },
  ];
}

// ---- Notion + Cloudflare I/O ----
const richText = (arr) => (arr ?? []).map((t) => t.plain_text).join('');

async function notion(path, token) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION } });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Notion ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

/** Depth-first flatten of a page's blocks (children of toggles, columns, lists included). */
export async function fetchBlocks(pageId, token, depth = 0) {
  const flat = [];
  let cursor;
  do {
    const body = await notion(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, token);
    for (const b of body.results) {
      const data = b[b.type] ?? {};
      flat.push({ type: b.type, text: richText(data.rich_text) || (b.type === 'child_page' ? data.title : '') });
      if (b.has_children && depth < 4 && b.type !== 'child_page' && b.type !== 'child_database') flat.push(...await fetchBlocks(b.id, token, depth + 1));
    }
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return flat;
}

export async function main(env = process.env, argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const need = (k) => { if (!env[k]) throw new Error(`Missing env ${k}`); return env[k]; };
  const notionToken = need('NOTION_TOKEN');
  const cfToken = dryRun ? env.CLOUDFLARE_API_TOKEN : need('CLOUDFLARE_API_TOKEN');
  const accountId = dryRun ? env.CLOUDFLARE_ACCOUNT_ID : need('CLOUDFLARE_ACCOUNT_ID');
  const nsId = env.KV_NAMESPACE_ID || '15f4c0ac614b4c60954dd42e9d8c8ee5';

  const [scheduleBlocks, brandBlocks, brandPage] = await Promise.all([
    fetchBlocks(env.SCHEDULE_PAGE_ID || '3f128547-eaa7-81ed-8e81-e74b87da1efc', notionToken),
    fetchBlocks(env.BRAND_PAGE_ID || '38128547-eaa7-81fb-87d2-f4387c836045', notionToken),
    notion(`pages/${env.BRAND_PAGE_ID || '38128547-eaa7-81fb-87d2-f4387c836045'}`, notionToken),
  ]);
  const brandTitle = richText(Object.values(brandPage.properties ?? {}).find((p) => p.type === 'title')?.title) || 'Brand Guidelines';
  const pairs = buildPairs({ scheduleBlocks, brandBlocks, brandTitle, year: Number(env.CONTENT_YEAR) || 2026 });
  console.log(`${pairs.length} KV keys -> ${nsId}`);
  if (dryRun) { console.log('dry run: nothing written'); return; }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${nsId}/bulk`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pairs),
  });
  const out = await res.json();
  if (!res.ok || !out.success) throw new Error(`KV bulk write failed ${JSON.stringify(out.errors)}`);
  console.log('KV sync complete');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
