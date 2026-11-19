#!/usr/bin/env node
// Renders and uploads the per-post social cards for the next days (Content System v1, phase 2). Runs in the 05:00 HKT
// sync workflow before the topic sync, which then adds each day's card to its topic:<date> record in KV.
//
//   1. read WORKSTREAM 3 from Notion (same parser as the KV sync): each day's X topic and optional IMAGE HEADLINES line
//   2. card spec per day (template, label, headline, Alice plate); a headline that breaks the blocked-claims list is skipped
//   3. render 4 JPEGs (instagram 1080x1350, linkedin 1200x630, x 1600x900, pinterest 1000x1500)
//   4. upload to the public Supabase Storage bucket mpt-brand-assets (docs/brand-assets-storage.md), key
//      social/cards/<date>/<size>-<hash>.jpg. The hash changes when the card changes, so no stale cached image is ever served.
//   5. write the manifest (CARDS_MANIFEST, default cards-manifest.json) listing only the days that uploaded
//
// Env: NOTION_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: SCHEDULE_PAGE_ID, CONTENT_YEAR, CARD_DAYS (default 7),
// CARDS_MANIFEST, CARDS_BUCKET (default mpt-brand-assets).
// Usage: node tools/social-cards/run.mjs [--dry-run] [--out DIR]   (dry run renders to DIR, uploads nothing)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchBlocks, parseSchedule } from '../../scripts/sync-content-cache-to-kv.mjs';
import { blockedReasons } from '../../shared/content/claims.mjs';
import { cardSpec, renderCards, SIZES } from './render.mjs';

const HKT_MS = 8 * 3600e3;
export const hktDay = (now, plus = 0) => new Date(now.getTime() + HKT_MS + plus * 86400e3).toISOString().slice(0, 10);
// Bump when the card design changes so every key (and so every URL) changes with it.
export const DESIGN_VERSION = 'v1';

/** The day's topic, in the order the producer uses (X thread, pillar post, blog). */
export const dayTopic = (day) => ['x', 'pillar', 'blog'].map((k) => day?.items?.[k]?.[0]?.text).find((t) => t?.trim()) ?? '';

/** Card specs for the next `n` HKT days that have a topic or an image headline. Skips (with a reason) what can't be used. */
export function plan(days, now, n = 7) {
  const specs = []; const skipped = [];
  for (let i = 0; i < n; i++) {
    const date = hktDay(now, i);
    const day = days[date];
    const imageLine = day?.items?.image?.[0]?.text ?? null;
    const topic = dayTopic(day);
    if (!imageLine && !topic) { skipped.push({ date, reason: 'no topic' }); continue; }
    let spec;
    try { spec = cardSpec(date, { imageLine, topic }); } catch (e) { skipped.push({ date, reason: e.message }); continue; }
    const why = blockedReasons(spec.headline);
    if (why.length) { skipped.push({ date, reason: `headline ${why.join('; ')}` }); continue; }
    specs.push(spec);
  }
  return { specs, skipped };
}

export const cardHash = (spec) => createHash('sha256').update(JSON.stringify([DESIGN_VERSION, spec.template, spec.headline, spec.alice])).digest('hex').slice(0, 10);
export const cardKey = (spec, size) => `social/cards/${spec.date}/${size}-${cardHash(spec)}.jpg`;

async function upload(env, bucket, key, body) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000', 'x-upsert': 'true' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function main(env = process.env, argv = process.argv, now = new Date()) {
  const dryRun = argv.includes('--dry-run');
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const need = (k) => { if (!env[k]) throw new Error(`Missing env ${k}`); return env[k]; };
  need('NOTION_TOKEN');
  if (!dryRun) { need('SUPABASE_URL'); need('SUPABASE_SERVICE_ROLE_KEY'); }
  const bucket = env.CARDS_BUCKET || 'mpt-brand-assets';
  const publicBase = `${env.SUPABASE_URL || 'https://xmdmkumwxpgahmlweuug.supabase.co'}/storage/v1/object/public/${bucket}`;

  const blocks = await fetchBlocks(env.SCHEDULE_PAGE_ID || '3f128547-eaa7-81ed-8e81-e74b87da1efc', env.NOTION_TOKEN);
  const { specs, skipped } = plan(parseSchedule(blocks, Number(env.CONTENT_YEAR) || 2026), now, Number(env.CARD_DAYS) || 7);
  for (const s of skipped) console.log(`${s.date}: no card (${s.reason})`);

  const cards = {}; const failed = [];
  for (const spec of specs) {
    try {
      const jpgs = await renderCards(spec);
      const urls = {};
      for (const size of Object.keys(SIZES)) {
        const key = cardKey(spec, size);
        if (outDir) { mkdirSync(join(outDir, spec.date), { recursive: true }); writeFileSync(join(outDir, spec.date, `${size}.jpg`), jpgs[size]); }
        if (!dryRun) await upload(env, bucket, key, jpgs[size]);
        urls[size] = `${publicBase}/${key}`;
      }
      cards[spec.date] = { template: spec.template, label: spec.label, headline: spec.headline, alice: spec.alice, from_topic: spec.fallback, urls };
      console.log(`${spec.date}: ${spec.label} "${spec.headline}" (Alice ${spec.alice}${spec.fallback ? ', from the topic: add an IMAGE HEADLINES line for a sharper card' : ''})`);
    } catch (e) {
      failed.push(spec.date);
      console.error(`${spec.date}: card failed: ${e.message}`);
    }
  }
  const manifestPath = env.CARDS_MANIFEST || 'cards-manifest.json';
  if (!dryRun) writeFileSync(manifestPath, JSON.stringify({ generated_at: now.toISOString(), design: DESIGN_VERSION, cards }, null, 2));
  console.log(`${Object.keys(cards).length} cards ${dryRun ? 'rendered (dry run, nothing uploaded)' : `uploaded; manifest ${manifestPath}`}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
  if (failed.length && !Object.keys(cards).length) process.exitCode = 1;
  return { cards, skipped, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
