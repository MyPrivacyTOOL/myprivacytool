#!/usr/bin/env node
// Sync the Notion "WORKSTREAM 3: Content Distribution Schedule" page into the Workers KV namespace mpt-brand-topics
// (MPC-8371) so the autonomous content pipeline reads each day's topics from KV instead of hitting Notion.
// Notion stays the source of truth; KV is a read-only cache. WORKSTREAM 3 is a Notion page (not a database), so it is
// parsed with the same parser as sync-content-cache-to-kv.mjs.
//
// Idempotent: keys are deterministic (topic:<date>) and per-day values carry no timestamp, so re-running against an
// unchanged page rewrites identical values. Only topic:index records synced_at. Refuses to write if nothing parses.
//
// Required env (names only, never commit values):
//   NOTION_TOKEN            internal integration with the WORKSTREAM 3 page shared to it
//   CLOUDFLARE_API_TOKEN    token with Account > Workers KV Storage > Edit
//   CLOUDFLARE_ACCOUNT_ID   35cb17172c65a20f5cf1baf131485382
// Optional env:
//   KV_NAMESPACE_ID         default: 187c9af3fc3a44bea3b1eb80298ab0ce (mpt-brand-topics)
//   SCHEDULE_PAGE_ID        default: 3f128547-eaa7-81ed-8e81-e74b87da1efc
//   CONTENT_YEAR            default: 2026 (the schedule lists "Oct 9", no year)
//
// Usage: node scripts/sync-workstream-3-to-kv.mjs [--dry-run]
//
// KV layout:
//   topic:<YYYY-MM-DD> -> {date, items:{pillar|blog|x|reddit|linkedin:[{text,qualifier}]}}
//   topic:index        -> {synced_at, count, dates:[...]}

import { pathToFileURL } from 'node:url';
import { fetchBlocks, parseSchedule } from './sync-content-cache-to-kv.mjs';

export function buildTopicPairs({ scheduleBlocks, year, now = new Date() }) {
  const days = parseSchedule(scheduleBlocks, year);
  const dates = Object.keys(days).sort();
  if (!dates.length) throw new Error('No dated items parsed from the WORKSTREAM 3 page; refusing to overwrite KV.');
  return [
    ...dates.map((d) => ({ key: `topic:${d}`, value: JSON.stringify(days[d]) })),
    { key: 'topic:index', value: JSON.stringify({ synced_at: now.toISOString(), count: dates.length, dates }) },
  ];
}

export async function main(env = process.env, argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const need = (k) => { if (!env[k]) throw new Error(`Missing env ${k}`); return env[k]; };
  const notionToken = need('NOTION_TOKEN');
  const cfToken = dryRun ? env.CLOUDFLARE_API_TOKEN : need('CLOUDFLARE_API_TOKEN');
  const accountId = dryRun ? env.CLOUDFLARE_ACCOUNT_ID : need('CLOUDFLARE_ACCOUNT_ID');
  const nsId = env.KV_NAMESPACE_ID || '187c9af3fc3a44bea3b1eb80298ab0ce';

  const scheduleBlocks = await fetchBlocks(env.SCHEDULE_PAGE_ID || '3f128547-eaa7-81ed-8e81-e74b87da1efc', notionToken);
  const pairs = buildTopicPairs({ scheduleBlocks, year: Number(env.CONTENT_YEAR) || 2026 });
  console.log(`${pairs.length} KV keys -> ${nsId} (mpt-brand-topics)`);
  if (dryRun) { console.log('dry run: nothing written'); return pairs; }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${nsId}/bulk`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pairs),
  });
  const out = await res.json();
  if (!res.ok || !out.success) throw new Error(`KV bulk write failed ${JSON.stringify(out.errors)}`);
  console.log('KV sync complete');
  return pairs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
