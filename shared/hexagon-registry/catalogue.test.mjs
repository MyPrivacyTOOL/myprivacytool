// MPC-8689: the 368-hexagon catalogue (the 366 approved discovery items plus the 2 records-about-a-person items, owner decision 2026-10-29) matches the approved discovery and the code, and changes no existing count.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEXAGON_CATALOGUE, CATALOGUE_CHANNELS } from './catalogue.js';
import { HEXAGONS, EMAIL_HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { TELEGRAM_HEXAGONS, X_HEXAGONS, TELEGRAM_EXTRA_HEXAGONS, EXTRA_HEXAGON_IDS, RECORDS_EXTRA_IDS, CHANNELS, channelOfHexagon } from './channels.js';

const count = (f, k) => HEXAGON_CATALOGUE.filter(f).reduce((m, i) => ((m[i[k]] = (m[i[k]] || 0) + 1), m), {});
assert.equal(HEXAGON_CATALOGUE.length, 368);
assert.equal(CATALOGUE_CHANNELS.length, 27);
assert.deepEqual(count(() => true, 'risk'), { high: 92, medium: 208, low: 68 });
assert.deepEqual(count(() => true, 'arrival'), { A: 201, B: 94, C: 64, D: 9 });
assert.deepEqual(count(() => true, 'group'), { Core: 190, 'Global social': 75, Asian: 74, Offline: 29 });
assert.deepEqual(count(() => true, 'status'), { defined: 101, new: 267 });
assert.equal(new Set(HEXAGON_CATALOGUE.map((i) => i.id)).size, 368, 'ids are unique');
assert.equal(new Set(HEXAGON_CATALOGUE.map((i) => i.slug)).size, 368, 'slugs are unique');
assert.ok(HEXAGON_CATALOGUE.every((i) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug)), 'slugs are url-safe');
for (const c of CATALOGUE_CHANNELS) assert.ok(CHANNELS[c.key], `channel ${c.key} is in CHANNELS`);
const perChannel = count((i) => i.channel, 'channel');
assert.equal(perChannel.web, 83); assert.equal(perChannel.telegram, 47); assert.equal(perChannel.email, 21);

// 101 defined = 91 whose ids are exactly what the code defines (54 web + 7 email + 30 Telegram, nothing renamed) + 10 X candidates that main's CK-8502 X hexagons
// build under different ids. Each of those 10 carries code_ids, and every code_id must be a real X hexagon; nothing is renamed or guessed.
const code = new Set([...HEXAGONS.map((h) => h.id), ...EMAIL_HEXAGONS.map((h) => h.id), ...TELEGRAM_HEXAGONS.map((h) => h.id), ...X_HEXAGONS.map((h) => h.id)]);
const defRows = HEXAGON_CATALOGUE.filter((i) => i.status === 'defined');
const direct = defRows.filter((i) => !i.code_ids);
const mapped = defRows.filter((i) => i.code_ids);
assert.equal(direct.length, 91);
assert.equal(mapped.length, 10);
assert.ok(mapped.every((i) => i.channel === 'x' && i.code_ids.length > 0 && i.code_ids.every((id) => X_HEXAGONS.some((x) => x.id === id))), 'every mapped X row points at real X hexagons');
assert.deepEqual(direct.map((i) => i.id).filter((id) => !code.has(id)), [], 'every directly defined id is in the code');
const covered = new Set([...direct.map((i) => i.id), ...mapped.flatMap((i) => i.code_ids)]);
// The only code ids with no catalogue row are four X hexagons the discovery does not list: post text, post language, and the two switched-off lookups.
assert.deepEqual([...code].filter((id) => !covered.has(id)).sort(), ['x.lookup_profile', 'x.post_language', 'x.post_text', 'x.timeline']);
// Unmapped X candidates stay unbuilt (attachment, follows and likes, typing and read receipts, account age, recent posts, confirmed email).
assert.deepEqual(HEXAGON_CATALOGUE.filter((i) => i.channel === 'x' && i.status === 'new').map((i) => i.id).sort(), ['x.account_age', 'x.activity', 'x.dm_media', 'x.email', 'x.recent_posts', 'x.typing_read']);
// Built extras (pilot) are catalogue items still marked "new": they are not among the 101 defined and not in the 30, so no approved count moves.
assert.equal(TELEGRAM_EXTRA_HEXAGONS.length, 6);
assert.equal(EXTRA_HEXAGON_IDS.length, 88); // 6 Telegram + 4 email + 9 web + 11 Discord + 4 SMS + 13 Viber + 5 LINE + 6 GitHub + 6 YouTube + 6 KakaoTalk + 7 WeChat + 7 Zalo + 2 QQ + 2 records
for (const id of EXTRA_HEXAGON_IDS) {
  const item = HEXAGON_CATALOGUE.find((i) => i.id === id);
  assert.ok(item && item.status === 'new' && ['telegram', 'email', 'web', 'discord', 'sms', 'viber', 'line', 'github', 'youtube', 'kakaotalk', 'wechat', 'zalo', 'qq', 'brokers'].includes(item.channel), `extra ${id} is a new built-extra catalogue item`);
  assert.ok(!code.has(id), `extra ${id} is not in the 54 + 7 + 30`);
}
assert.equal(HEXAGON_COUNT, 54, 'web scan total stays 54');
// Records about a person (owner decisions 2026-10-29): channel "Data brokers and news archives", code DB, class B, access Verify, risk high, status new.
const brokers = HEXAGON_CATALOGUE.filter((i) => i.channel === 'brokers');
assert.deepEqual(brokers.map((i) => i.id), ['brokers.people_search_listing', 'brokers.news_archive_mention']);
assert.ok(brokers.every((i) => i.arrival === 'B' && i.access === 'Verify' && i.risk === 'high' && i.status === 'new'));
assert.deepEqual(CATALOGUE_CHANNELS.find((c) => c.key === 'brokers'), { key: 'brokers', code: 'DB', label: 'Data brokers and news archives', group: 'Core' });
assert.deepEqual([...RECORDS_EXTRA_IDS].sort(), brokers.map((i) => i.id).sort());
// Drops and holds (2026-10-29) stay in the file with their reason; nothing is deleted. The inbound sender and mail app items are approved, built later.
const raw = JSON.parse(readFileSync(new URL('./hexagons-366.json', import.meta.url), 'utf8')).items;
const decided = Object.fromEntries(raw.filter((i) => i.decision).map((i) => [i.id, i.decision]));
assert.deepEqual(decided, { 'web.reverse_dns': 'dropped', 'email.wkd': 'dropped', 'tg.reactions_polls': 'dropped', 'email.inbound_signature': 'dropped', 'email.subdomains': 'held', 'tg.join_request_bio': 'held' });
assert.ok(raw.filter((i) => i.decision).every((i) => i.decision_reason && i.decided === '2026-10-29' && i.status === 'new'));
assert.equal(channelOfHexagon('tg.username'), 'TG');
console.log('catalogue.test.mjs ok');

// Owner decisions batch 1 (2026-10-29): 162 unbuilt hexagons carry a plan (160 not planned, 2 approved for later) with a decision number and reason. Six earlier drops and holds keep their own
// `decision` fields untouched, and the 11 still open are exactly these.
const planned = HEXAGON_CATALOGUE.filter((i) => i.plan);
assert.equal(planned.length, 162);
assert.equal(planned.filter((i) => i.plan === 'not_planned').length, 160);
assert.deepEqual(planned.filter((i) => i.plan === 'later').map((i) => i.id).sort(), ['email.inbound_client', 'email.inbound_sender']);
assert.ok(planned.every((i) => i.status === 'new' && !EXTRA_HEXAGON_IDS.includes(i.id) && i.plan_decision >= 1 && i.plan_decision <= 11 && i.plan_reason), 'planned rows are unbuilt, have a decision and a reason');
assert.ok(planned.every((i) => !raw.find((r) => r.id === i.id).decision), 'an earlier recorded drop or hold is never overwritten');
assert.deepEqual(HEXAGON_CATALOGUE.filter((i) => i.status === 'new' && !EXTRA_HEXAGON_IDS.includes(i.id) && !i.plan && !raw.find((r) => r.id === i.id).decision).map((i) => i.id).sort(),
  ['kk.linked_at', 'line.language', 'line.name_photo', 'line.status', 'tg.blocked_bot', 'tg.edits', 'tg.miniapp_biometric', 'tg.miniapp_device', 'tg.miniapp_location', 'tg.miniapp_photo', 'tg.passport']);
assert.ok(HEXAGON_CATALOGUE.filter((i) => i.status === 'defined').every((i) => !i.plan), 'defined rows are never marked');
console.log('catalogue.test.mjs decisions ok');
