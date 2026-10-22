#!/usr/bin/env node
// Seed the Workers KV namespace mpt-content-cache with the Notion "Brand Guidelines" page (MPC-8371) under
// brand:guidelines, which the content consumer reads for brand guardrails. Notion stays the source of truth.
//
// Scope note: scripts/sync-content-cache-to-kv.mjs (daily workflow) already writes brand:guidelines together with the
// schedule:<date> keys. This script is the brand-only seed/refresh, so the guidelines can be (re)loaded without
// touching the schedule keys. Both produce the same brand:guidelines value shape.
//
// Idempotent: one deterministic key; the value is identical across runs except synced_at.
// Refuses to write an empty guidelines document.
//
// Required env (names only, never commit values):
//   NOTION_TOKEN            internal integration with the Brand Guidelines page shared to it
//   CLOUDFLARE_API_TOKEN    token with Account > Workers KV Storage > Edit
//   CLOUDFLARE_ACCOUNT_ID   35cb17172c65a20f5cf1baf131485382
// Optional env:
//   KV_NAMESPACE_ID         default: 15f4c0ac614b4c60954dd42e9d8c8ee5 (mpt-content-cache)
//   BRAND_PAGE_ID           default: 38128547-eaa7-81fb-87d2-f4387c836045
//
// Usage: node scripts/sync-mpt-cache-to-kv.mjs [--dry-run]
//
// KV layout:
//   brand:guidelines -> {synced_at, title, sections:[{heading,text}]}

import { pathToFileURL } from 'node:url';
import { fetchBlocks, toSections } from './sync-content-cache-to-kv.mjs';

export function buildBrandPairs({ brandBlocks, brandTitle, now = new Date() }) {
  const sections = toSections(brandBlocks);
  if (!sections.length) throw new Error('Brand Guidelines page is empty; refusing to overwrite KV.');
  return [{ key: 'brand:guidelines', value: JSON.stringify({ synced_at: now.toISOString(), title: brandTitle, sections }) }];
}

async function notionPage(pageId, token) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' } });
  if (!res.ok) throw new Error(`Notion pages/${pageId}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function main(env = process.env, argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const need = (k) => { if (!env[k]) throw new Error(`Missing env ${k}`); return env[k]; };
  const notionToken = need('NOTION_TOKEN');
  const cfToken = dryRun ? env.CLOUDFLARE_API_TOKEN : need('CLOUDFLARE_API_TOKEN');
  const accountId = dryRun ? env.CLOUDFLARE_ACCOUNT_ID : need('CLOUDFLARE_ACCOUNT_ID');
  const nsId = env.KV_NAMESPACE_ID || '15f4c0ac614b4c60954dd42e9d8c8ee5';
  const pageId = env.BRAND_PAGE_ID || '38128547-eaa7-81fb-87d2-f4387c836045';

  const [brandBlocks, page] = await Promise.all([fetchBlocks(pageId, notionToken), notionPage(pageId, notionToken)]);
  const brandTitle = (Object.values(page.properties ?? {}).find((p) => p.type === 'title')?.title ?? []).map((t) => t.plain_text).join('') || 'Brand Guidelines';
  const pairs = buildBrandPairs({ brandBlocks, brandTitle });
  console.log(`${pairs.length} KV key -> ${nsId} (mpt-content-cache)`);
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
