// node tools/social-cards/cards.test.mjs  (after npm ci in tools/social-cards; no network)
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cardSpec, renderCards, SIZES, TEMPLATES } from './render.mjs';
import { plan, cardKey, hktDay } from './run.mjs';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const fix = cardSpec('2026-11-27', { imageLine: 'One fix: Remove yourself from Spokeo' });
ok(fix.template === 'fix' && fix.label === 'ONE FIX' && fix.headline === 'Remove yourself from Spokeo' && TEMPLATES.fix.alice.includes(fix.alice) && !fix.fallback, 'image line sets template and headline');
ok(cardSpec('d', { imageLine: 'Myth vs fact: Nothing to hide?' }).template === 'myth' && cardSpec('d', { imageLine: 'Did you know: Your browser talks first' }).template === 'know', 'myth and did-you-know prefixes');
const fb = cardSpec('2026-11-20', { topic: 'Thread: "The 20-minute family privacy tune-up" (action list)' });
ok(fb.fallback && fb.template === 'know' && fb.headline === 'The 20-minute family privacy tune-up', 'falls back to the cleaned topic');
ok(cardSpec('d', { topic: 'Thread: "Incognito is not invisible" (Myth)' }).template === 'myth', 'pillar tag picks the template');
ok(cardSpec('2026-11-27', { imageLine: 'One fix: x' }).alice !== cardSpec('2026-11-28', { imageLine: 'One fix: x' }).alice || TEMPLATES.fix.alice.length === 1, 'Alice pose varies by day');

const now = new Date('2026-11-26T21:00:00Z'); // 05:00 HKT on 27 Nov
ok(hktDay(now) === '2026-11-27' && hktDay(now, 6) === '2026-12-03', 'HKT day window');
const days = {
  '2026-11-27': { items: { x: [{ text: 'Thread: "Opt out of Spokeo" (Fix)' }], image: [{ text: 'One fix: Remove yourself from Spokeo' }] } },
  '2026-11-28': { items: { x: [{ text: 'Thread: "We remove you from 600 brokers" (Fix)' }] } },
};
const p = plan(days, now, 3);
ok(p.specs.length === 1 && p.specs[0].date === '2026-11-27', 'one usable day');
ok(p.skipped.some((s) => s.date === '2026-11-28' && /broker count|removes data/.test(s.reason)) && p.skipped.some((s) => s.date === '2026-11-29' && s.reason === 'no topic'), 'blocked headline and empty day are skipped with reasons');
ok(cardKey(fix, 'instagram').startsWith('social/cards/2026-11-27/instagram-') && cardKey(fix, 'x') !== cardKey(fix, 'instagram') && cardKey({ ...fix, headline: 'Other' }, 'x') !== cardKey(fix, 'x'), 'keys are per size and change with the card');

const jpgs = await renderCards(fix);
for (const [size, [w, h]] of Object.entries(SIZES)) {
  const m = await sharp(jpgs[size]).metadata();
  ok(m.format === 'jpeg' && m.width === w && m.height === h && jpgs[size].length < 1_000_000, `${size} is a ${w}x${h} JPEG under 1 MB`);
}
console.log(`social cards: ${n} checks passed`);
