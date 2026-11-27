// node workers/mpt-content-consumer/worker.test.mjs  (producer + consumer + approval; stubbed KV / D1 / fetch, no network)
import assert from 'node:assert/strict';
import consumer, { parseDraft, buildPrompt, guardrails, topicFor, slackBlocks, claimViolations, scanLink, CLAIMS_RULES, cardFields } from './worker.js';
import { buildTopicPairs } from '../../scripts/sync-workstream-3-to-kv.mjs';
import producer, { hktDate, buildMessage } from '../mpt-content-producer/worker.js';
import approval, { scheduledTime } from '../mpt-content-approval/worker.js';
import { parseSchedule, toSections } from '../../scripts/sync-content-cache-to-kv.mjs';

let passed = 0;
const check = (cond, msg) => { assert.ok(cond, msg); passed++; };

const makeDb = () => {
  const logs = []; const metrics = [];
  return {
    logs, metrics,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            async run() {
              if (sql.includes('INTO agent_execution_logs')) {
                const cols = sql.match(/\(([^)]*)\) VALUES/)[1].split(',').map((s) => s.trim());
                logs.push(Object.fromEntries(cols.map((c, i) => [c, a[i] ?? null])));
              } else if (sql.includes('INTO social_metrics')) metrics.push({ platform: a[2], topic: a[3] });
            },
            async all() { return { results: logs.filter((r) => r.task_id === a[0] && r.status === a[1]) }; },
          };
        },
      };
    },
  };
};

// ---- producer ----
check(hktDate(new Date('2026-10-19T22:00:00Z')) === '2026-10-20', '22:00 UTC is 06:00 HKT next day');
check(JSON.stringify(buildMessage(new Date('2026-10-19T22:00:00Z'))) === '{"date":"2026-10-20","action":"generate_daily_posts"}', 'producer payload');
const sent = []; const pdb = makeDb();
const pending0 = [];
await producer.scheduled({ scheduledTime: Date.parse('2026-10-19T22:00:00Z') }, { AGENT_LOGS: pdb, BRAND_TOPICS: { get: async (k) => (k === 'topic:2026-10-20' ? { topic: 'Exposure score', pillar: 'awareness' } : null) }, CONTENT_QUEUE: { send: async (m) => sent.push(m) } }, { waitUntil: (p) => pending0.push(p) });
await Promise.all(pending0);
check(sent.length === 1 && sent[0].date === '2026-10-20' && sent[0].topic === 'Exposure score' && sent[0].pillar === 'awareness' && pdb.logs[0].status === 'queued' && pdb.logs[0].id.length > 20, 'producer enqueues + logs');

// ---- KV sync parsing ----
const days = parseSchedule([
  { type: 'heading_2', text: 'PILLAR POST PUBLICATION CALENDAR' },
  { type: 'paragraph', text: '- Oct 9 (Wed): Publish Pillar Post #1: "Hidden Cost"' },
  { type: 'heading_2', text: 'SOCIAL MEDIA: Twitter/X THREADS (1 per day)' },
  { type: 'bulleted_list_item', text: 'Oct 20: Thread: "Your exposure score just changed" (urgency)' },
  { type: 'heading_2', text: 'REDDIT CONTRIBUTIONS (2 per week)' },
  { type: 'bulleted_list_item', text: 'Oct 19 (r/NoStupidQuestions): "Is my Gmail really private?" — explainer' },
  { type: 'heading_2', text: 'CONVERSION FUNNELING' },
  { type: 'bulleted_list_item', text: 'Oct 21: ignored' },
]);
check(days['2026-10-09'].items.pillar[0].qualifier === null, 'weekday paren is not a qualifier');
check(days['2026-10-20'].items.x[0].text.startsWith('Thread:'), 'x item parsed');
check(days['2026-10-19'].items.reddit[0].qualifier === 'r/NoStupidQuestions', 'subreddit qualifier kept');
check(!days['2026-10-21'], 'unknown section ignored');
check(toSections([{ type: 'heading_2', text: 'Voice' }, { type: 'paragraph', text: 'Plain.' }])[0].text === 'Plain.', 'brand sections');

// ---- drafts / prompts ----
const brand = { sections: [{ heading: 'Voice & tone', text: 'calm' }, { heading: 'Logo', text: 'big' }] };
check(guardrails(brand) === '## Voice & tone\ncalm', 'guardrails pick voice sections');
const schedule = { date: '2026-10-20', items: { x: [{ text: 'Thread: exposure', qualifier: null }] } };
check(topicFor(schedule, 'instagram') === 'Thread: exposure' && topicFor(schedule, 'x') === 'Thread: exposure', 'instagram falls back to x topic');
const pr = buildPrompt('pinterest', 'T', '2026-10-20', 'GUARD');
check(pr.system.includes('GUARD') && pr.user.includes('Platform: Pinterest') && pr.user.includes("Today's topic: T"), 'system has guardrails, user has platform + topic');
assert.throws(() => parseDraft('x', JSON.stringify({ copy: 'a'.repeat(300) })), /280/); passed++;
assert.throws(() => parseDraft('pinterest', JSON.stringify({ copy: 'b' })), /title/); passed++;
check(parseDraft('linkedin', `ok\n${JSON.stringify({ copy: 'hello' })}`).cta === 'Check your exposure', 'parseDraft tolerates prose, adds CTA');

// ---- phase 1: scan link + claims ----
check(pr.user.includes(scanLink('pinterest', '2026-10-20')) && scanLink('x', 'd').startsWith('https://myprivacytool.io/scan?utm_source=x&'), 'prompt links to /scan');
check(pr.system.indexOf(CLAIMS_RULES) >= 0 && pr.system.indexOf(CLAIMS_RULES) < pr.system.indexOf('GUARD'), 'claims list comes before the brand text');
check(buildPrompt('x', 'T', 'd', 'g'.repeat(9000)).system.includes('BLOCKED'), 'claims list survives a long brand page');
const ok = 'Opt out of Spokeo with our free guide at myprivacytool.io/opt-out-guides. We never sell your data. Check your exposure: https://myprivacytool.io/scan?utm_source=x';
check(claimViolations({ copy: ok }).length === 0, 'approved copy passes');
for (const [bad, why] of [
  ['We remove your data from 600+ brokers.', 'removal + count'],
  ['Results are not stored.', 'storage'],
  ['Dark web scan included.', 'dark web'],
  ['Pro is $14.99 a month.', 'price'],
  ['78% of people are exposed.', 'statistic'],
  ['100% private.', '100%'],
  ['Our founder has 20+ years of experience in security.', 'credentials'],
  ['Fastest privacy tool, no sign-up.', 'blocked phrase'],
]) check(claimViolations({ copy: `${bad} ${ok}` }).length > 0, `blocked: ${why}`);
check(claimViolations({ copy: 'Check your exposure: https://myprivacytool.io?utm_source=x' }).some((r) => /scan/.test(r)), 'homepage-only link fails');
check(claimViolations({ copy: ok, slides: ['We delete your data'] }).length > 0, 'slides are checked too');

// ---- phase 2: per-post cards ----
const CARD = { template: 'fix', label: 'ONE FIX', headline: 'Remove yourself from Spokeo', alice: 'pointing', urls: { instagram: 'https://s.example/ig.jpg', linkedin: 'https://s.example/li.jpg', x: 'https://s.example/x.jpg', pinterest: 'https://s.example/pin.jpg' } };
const imgDays = parseSchedule([
  { type: 'heading_2', text: 'SOCIAL MEDIA: Twitter/X THREADS (Nov 27 – Dec 10)' },
  { type: 'bulleted_list_item', text: 'Nov 27 (Fri): Thread: "Opt out of Spokeo" (Fix)' },
  { type: 'heading_2', text: 'IMAGE HEADLINES (Nov 27 – Dec 10)' },
  { type: 'bulleted_list_item', text: 'Nov 27: One fix: Remove yourself from Spokeo' },
]);
check(imgDays['2026-11-27'].items.image[0].text === 'One fix: Remove yourself from Spokeo' && imgDays['2026-11-27'].items.x[0].text.startsWith('Thread:'), 'IMAGE HEADLINES section parsed next to the X topic');
const tp = buildTopicPairs({ scheduleBlocks: [{ type: 'heading_2', text: 'X THREADS' }, { type: 'bulleted_list_item', text: 'Nov 27: Thread: a' }, { type: 'bulleted_list_item', text: 'Nov 28: Thread: b' }], cards: { '2026-11-27': CARD, '2026-12-31': CARD } });
check(JSON.parse(tp.find((p) => p.key === 'topic:2026-11-27').value).card.urls.instagram === CARD.urls.instagram && !JSON.parse(tp.find((p) => p.key === 'topic:2026-11-28').value).card && !tp.some((p) => p.key === 'topic:2026-12-31'), 'cards merge into their own day only');
check(buildMessage(new Date('2026-11-26T22:00:00Z'), { topic: 'T', card: CARD }).card === CARD, 'producer passes the card through');
check(cardFields(CARD, 'facebook').asset_url === CARD.urls.instagram && cardFields(CARD, 'linkedin').asset_url === CARD.urls.linkedin && cardFields(CARD, 'x').asset_url === CARD.urls.x, 'each platform gets its card size');
check(Object.keys(cardFields(CARD, 'youtube')).length === 0 && Object.keys(cardFields(null, 'instagram')).length === 0 && Object.keys(cardFields({ urls: { instagram: 'http://insecure' } }, 'instagram')).length === 0, 'youtube, missing or bad card: no override');
const cb = slackBlocks('daily-posts-2026-11-27', 'T', [], CARD);
check(cb.some((b) => b.type === 'image' && b.image_url === CARD.urls.instagram) && cb.some((b) => b.type === 'context' && /linkedin/.test(b.elements[0].text)), 'Slack shows the card and links every size');
check(slackBlocks('t', 'T', [], null).some((b) => b.type === 'context' && /No per-post card/.test(b.elements[0].text)), 'Slack says so when there is no card');

// ---- consumer end to end ----
const L = ' Check your exposure: https://myprivacytool.io/scan?utm_source=p';
const goodFor = (platform) => (platform === 'pinterest' ? { copy: `body${L}`, title: 'T' } : platform === 'youtube' ? { copy: `desc${L}`, title: 'T', script: 'spoken' } : platform === 'instagram' ? { copy: `cap${L}`, slides: ['s1'] } : { copy: `${platform} copy${L}` });
const env = {
  AGENT_LOGS: makeDb(),
  CONTENT_CACHE: { get: async (k) => (k === 'schedule:2026-10-20' ? schedule : brand) },
  ANTHROPIC_API_KEY: 'k', SLACK_BOT_TOKEN: 'xoxb', SLACK_CHANNEL: '#mpt-content-approval', LLM_MODEL: 'm',
};
let inflight = 0; let maxInflight = 0; let failPinterest = true; const slackPosts = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('anthropic')) {
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 15));
    inflight--;
    const platform = /Platform: (\w+)/.exec(JSON.parse(init.body).messages[0].content)[1].toLowerCase();
    if (platform === 'pinterest' && failPinterest) return new Response('overloaded', { status: 529 });
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(goodFor(platform)) }] });
  }
  if (String(url).includes('chat.postMessage')) { slackPosts.push(JSON.parse(init.body)); return Response.json({ ok: true, channel: 'C99', ts: '1.1' }); }
  throw new Error(`unexpected fetch ${url}`);
};
const acks = [];
const msg = { body: { date: '2026-10-20', action: 'generate_daily_posts' }, attempts: 1, ack: () => acks.push('ack'), retry: () => acks.push('retry') };
await consumer.queue({ messages: [msg] }, env);
check(maxInflight === 6, 'six LLM calls ran concurrently');
check(acks[0] === 'retry' && env.AGENT_LOGS.logs.filter((r) => r.status === 'drafted').length === 5 && env.AGENT_LOGS.logs.some((r) => r.status === 'failed' && /pinterest/.test(r.error_message)), 'one failed platform: others saved, failure logged, retried');
failPinterest = false; maxInflight = 0;
await consumer.queue({ messages: [{ ...msg, attempts: 2 }] }, env);
check(maxInflight === 1, 'retry regenerates only the missing platform');
check(env.AGENT_LOGS.logs.filter((r) => r.status === 'drafted').length === 6 && acks[1] === 'ack', '4 drafts saved, acked');
const blocks = slackPosts[0].blocks;
check(slackPosts.length === 1 && slackPosts[0].channel === '#mpt-content-approval', 'one Slack post to the approval channel');
check(blocks.at(-1).elements.map((e) => e.action_id).join() === 'approve_all,reject,edit_resubmit' && blocks.at(-1).elements.every((e) => e.value === 'daily-posts-2026-10-20'), '3 buttons');
check(blocks.filter((b) => b.type === 'section' && /\*(X|LinkedIn|Instagram|Facebook|Pinterest|YouTube)\*/.test(b.text.text)).length === 6, 'all 6 drafts in the message');
check(JSON.parse(env.AGENT_LOGS.logs.find((r) => r.status === 'notified').draft_content).ts === '1.1', 'slack ts stored');
await consumer.queue({ messages: [{ ...msg, attempts: 3 }] }, env);
check(slackPosts.length === 1, 'duplicate delivery is a no-op');

// card flows from the queue message into the saved drafts, then into the Make envelope
const envC = { ...env, AGENT_LOGS: makeDb() };
await consumer.queue({ messages: [{ body: { date: '2026-11-27', action: 'generate_daily_posts', topic: 'Opt out of Spokeo', card: CARD }, attempts: 1, ack: () => {}, retry: () => {} }] }, envC);
const cDrafts = envC.AGENT_LOGS.logs.filter((r) => r.status === 'drafted').map((r) => JSON.parse(r.draft_content));
check(cDrafts.find((d) => d.platform === 'instagram').asset_url === CARD.urls.instagram && cDrafts.find((d) => d.platform === 'linkedin').asset_url === CARD.urls.linkedin && !cDrafts.find((d) => d.platform === 'youtube').asset_url, 'queued card lands on each draft');
check(slackPosts.at(-1).blocks.some((b) => b.type === 'image'), 'that day\'s Slack message shows the card');

// ---- approval worker ----
const taskId = 'daily-posts-2026-10-20';
const makeCalls = [];
const aenv = { AGENT_LOGS: env.AGENT_LOGS, MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/x', APPROVAL_API_TOKEN: 'tok', SLACK_SIGNING_SECRET: 'sign', SLACK_BOT_TOKEN: 'xoxb', SLACK_APPROVER: 'chris', DEFAULT_ASSET_URL: 'https://cdn.example.com/default.png' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://hook.eu1.make.com')) { makeCalls.push(JSON.parse(init.body)); return new Response('Accepted'); }
  return realFetch(url, init);
};
const post = (body, headers = {}) => new Request('https://a.example/approve', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ctx = { waitUntil: (p) => p };
check((await approval.fetch(new Request('https://a.example/approve'), aenv, ctx)).status === 405, 'GET /approve rejected');
check((await approval.fetch(post({ action: 'approve_all', drafted_content_id: taskId }), aenv, ctx)).status === 401, 'JSON without token rejected');
slackPosts.length = 0;
const res = await approval.fetch(post({ action: 'approve_all', drafted_content_id: taskId, timestamp: '2026-10-20T22:15:00Z' }, { authorization: 'Bearer tok' }), aenv, ctx);
check(res.status === 200 && makeCalls.length === 1 && makeCalls[0].posts.length === 6, 'approve_all posts one envelope with 6 posts to Make');
const li = makeCalls[0].posts.find((c) => c.platform === 'linkedin');
const igC = (await import('../mpt-content-approval/worker.js')).buildMakePayload(cDrafts, { taskId: 'daily-posts-2026-11-27', approvedBy: 'chris', approvalTimestamp: '2026-11-26T22:15:00Z', defaultAssetUrl: 'https://cdn.example.com/default.png' });
check(igC.posts.find((p) => p.platform === 'instagram').asset_url === CARD.urls.instagram && igC.posts.find((p) => p.platform === 'youtube').asset_url === 'https://cdn.example.com/default.png', 'Make gets the card for Instagram, the default where there is none');
check(li.body === `linkedin copy${L}` && li.link_url.startsWith('https://myprivacytool.io/scan?utm_source=linkedin') && li.title && li.link_url && li.asset_url && li.cta && li.publish_timestamp.endsWith('+08:00') && makeCalls[0].approved_by === 'chris' && makeCalls[0].approval_timestamp === '2026-10-21T06:15:00+08:00', 'envelope carries approver, HKT timestamps and per-post fields');
check(makeCalls[0].posts.find((c) => c.platform === 'youtube').script === 'spoken', 'youtube script passes through');
check(env.AGENT_LOGS.metrics.length === 0 && env.AGENT_LOGS.logs.some((r) => r.status === 'handed_off') && !env.AGENT_LOGS.logs.some((r) => r.status === 'published'), 'CK-8482: a Make 200 logs handed_off, never published, and seeds no metrics');
check(slackPosts.length === 1 && slackPosts[0].thread_ts === '1.1' && /^✅ \*HANDED OFF\*: approved by chris at \d\d:\d\d HKT\. Make\.com accepted the hand-off \(HTTP 200\) for 6 posts: X, LinkedIn, IG, FB, Pinterest, YouTube\./.test(slackPosts[0].text), 'thread reply says HANDED OFF and names platforms');
makeCalls.length = 0;
await approval.fetch(post({ action: 'approve_all', drafted_content_id: taskId }, { authorization: 'Bearer tok' }), aenv, ctx);
check(makeCalls.length === 0, 'second approval is a no-op');

// reject on a fresh task + Slack signature path
const env3 = { ...aenv, AGENT_LOGS: makeDb() };
env3.AGENT_LOGS.logs.push({ task_id: 'daily-posts-2026-10-21', status: 'drafted', draft_content: JSON.stringify({ platform: 'x', copy: 'c' }) }, { task_id: 'daily-posts-2026-10-21', status: 'notified', draft_content: JSON.stringify({ channel: 'C99', ts: '2.2' }) });
slackPosts.length = 0;
const payload = JSON.stringify({ actions: [{ action_id: 'reject', value: 'daily-posts-2026-10-21' }], user: { username: 'ck' }, channel: { id: 'C99' }, message: { ts: '2.2' } });
const form = `payload=${encodeURIComponent(payload)}`;
const ts = String(Math.floor(Date.now() / 1000));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('sign'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = 'v0=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${form}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const slackReq = (s) => new Request('https://a.example/approve', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': ts, 'x-slack-signature': s }, body: form });
check((await approval.fetch(slackReq('v0=bad'), env3, ctx)).status === 401, 'bad Slack signature rejected');
const pending = [];
check((await approval.fetch(slackReq(sig), env3, { waitUntil: (p) => pending.push(p) })).status === 200, 'Slack click acked immediately');
await Promise.all(pending);
check(env3.AGENT_LOGS.logs.some((r) => r.status === 'rejected') && slackPosts[0]?.text === 'Rejected. Awaiting next cycle.' && slackPosts[0].thread_ts === '2.2', 'reject logged + thread reply');
check(scheduledTime('2026-10-21', 'linkedin', new Date('2026-10-20T22:00:00Z')) === '2026-10-21T08:30:00+08:00', 'linkedin 08:30 HKT');

console.log(`mpt-content pipeline: ${passed} checks passed`);
