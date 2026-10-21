// Tests for sync-workstream-3-to-kv.mjs and sync-mpt-cache-to-kv.mjs with Notion and Cloudflare mocked.
// Run: node --test scripts/sync-workstream-kv.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicPairs, main as syncTopics } from './sync-workstream-3-to-kv.mjs';
import { buildBrandPairs, main as syncBrand } from './sync-mpt-cache-to-kv.mjs';

const para = (type, text) => ({ object: 'block', id: `${type}-${text}`, type, has_children: false, [type]: { rich_text: [{ plain_text: text }] } });
const PAGES = {
  schedule: [
    para('heading_2', 'PILLAR POST PUBLICATION CALENDAR'),
    para('paragraph', 'Oct 9 (Wed): Publish Pillar Post #1'),
    para('heading_2', 'SOCIAL MEDIA: Twitter/X THREADS'),
    para('bulleted_list_item', 'Oct 9: Thread: "3 data brokers you don\'t know have your phone number" (urgency)'),
    para('heading_2', 'REDDIT CONTRIBUTIONS'),
    para('bulleted_list_item', 'Oct 10 (r/privacy): "ELI5: Why are data brokers legal?" — explainer'),
  ],
  brand: [para('heading_1', 'Voice'), para('paragraph', 'Plain, calm, no fear-mongering.')],
};

/** Mock Notion + Cloudflare. Returns the recorded KV bulk bodies. */
function mockFetch(schedule = PAGES.schedule) {
  const bulk = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/blocks/3f128547')) return json({ results: schedule, has_more: false });
    if (u.includes('/blocks/38128547')) return json({ results: PAGES.brand, has_more: false });
    if (u.includes('/pages/38128547')) return json({ properties: { Name: { type: 'title', title: [{ plain_text: 'Brand Guidelines' }] } } });
    if (u.includes('/storage/kv/namespaces/')) { bulk.push({ url: u, body: JSON.parse(init.body) }); return json({ success: true }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  return bulk;
}

const ENV = { NOTION_TOKEN: 't', CLOUDFLARE_API_TOKEN: 'c', CLOUDFLARE_ACCOUNT_ID: 'a' };
const strip = (pairs) => pairs.filter((p) => !p.key.endsWith(':index'));

test('topics: builds topic:<date> keys plus an index', () => {
  const pairs = buildTopicPairs({ scheduleBlocks: [para('heading_2', 'REDDIT'), para('bulleted_list_item', 'Oct 10 (r/privacy): "x"')].map((b) => ({ type: b.type, text: b[b.type].rich_text[0].plain_text })), year: 2026 });
  assert.deepEqual(pairs.map((p) => p.key), ['topic:2026-10-10', 'topic:index']);
});

test('topics: refuses to write when nothing parses', () => {
  assert.throws(() => buildTopicPairs({ scheduleBlocks: [], year: 2026 }), /refusing to overwrite/);
});

test('topics: writes to mpt-brand-topics and is idempotent across runs', async () => {
  const bulk = mockFetch();
  await syncTopics(ENV, ['node', 'x']);
  await syncTopics(ENV, ['node', 'x']);
  assert.equal(bulk.length, 2);
  assert.match(bulk[0].url, /187c9af3fc3a44bea3b1eb80298ab0ce\/bulk$/);
  assert.deepEqual(strip(bulk[0].body), strip(bulk[1].body));
  const day = JSON.parse(bulk[0].body.find((p) => p.key === 'topic:2026-10-09').value);
  assert.equal(day.items.x[0].text.startsWith('Thread:'), true);
});

test('topics: dry run writes nothing', async () => {
  const bulk = mockFetch();
  await syncTopics({ NOTION_TOKEN: 't' }, ['node', 'x', '--dry-run']);
  assert.equal(bulk.length, 0);
});

test('brand: refuses an empty page', () => {
  assert.throws(() => buildBrandPairs({ brandBlocks: [], brandTitle: 'x' }), /refusing to overwrite/);
});

test('brand: seeds brand:guidelines in mpt-content-cache and is idempotent', async () => {
  const bulk = mockFetch();
  await syncBrand(ENV, ['node', 'x']);
  await syncBrand(ENV, ['node', 'x']);
  assert.match(bulk[0].url, /15f4c0ac614b4c60954dd42e9d8c8ee5\/bulk$/);
  assert.deepEqual(bulk[0].body.map((p) => p.key), ['brand:guidelines']);
  const v = JSON.parse(bulk[0].body[0].value), w = JSON.parse(bulk[1].body[0].value);
  delete v.synced_at; delete w.synced_at;
  assert.deepEqual(v, w);
  assert.equal(v.title, 'Brand Guidelines');
  assert.equal(v.sections[0].heading, 'Voice');
});

test('missing credentials fail fast', async () => {
  mockFetch();
  await assert.rejects(syncTopics({ NOTION_TOKEN: 't' }, ['node', 'x']), /Missing env CLOUDFLARE_API_TOKEN/);
});
