// node workers/mpt-content-consumer/worker.test.mjs  (producer + consumer + approval; stubbed KV / D1 / fetch, no network)
import assert from 'node:assert/strict';
import consumer, { parseDraft, buildPrompt, guardrails, topicFor, slackBlocks } from './worker.js';
import producer, { hktDate, buildMessage } from '../mpt-content-producer/worker.js';
import approval, { handoffPayload, scheduledTime, verifySlack } from '../mpt-content-approval/worker.js';
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

// ---- consumer end to end ----
const goodFor = (platform) => (platform === 'pinterest' ? { copy: 'body', title: 'T' } : platform === 'youtube' ? { copy: 'desc', title: 'T', script: 'spoken' } : platform === 'instagram' ? { copy: 'cap', slides: ['s1'] } : { copy: `${platform} copy` });
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

// ---- approval worker ----
const taskId = 'daily-posts-2026-10-20';
const makeCalls = [];
const aenv = { AGENT_LOGS: env.AGENT_LOGS, MAKE_WEBHOOK_URL: 'https://hook.example/x', APPROVAL_API_TOKEN: 'tok', SLACK_SIGNING_SECRET: 'sign', SLACK_BOT_TOKEN: 'xoxb', SLACK_APPROVER: 'chris', DEFAULT_ASSET_URL: '' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://hook.example')) { makeCalls.push(JSON.parse(init.body)); return new Response('Accepted'); }
  return realFetch(url, init);
};
const post = (body, headers = {}) => new Request('https://a.example/approve', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ctx = { waitUntil: (p) => p };
check((await approval.fetch(new Request('https://a.example/approve'), aenv, ctx)).status === 405, 'GET /approve rejected');
check((await approval.fetch(post({ action: 'approve_all', drafted_content_id: taskId }), aenv, ctx)).status === 401, 'JSON without token rejected');
slackPosts.length = 0;
const res = await approval.fetch(post({ action: 'approve_all', drafted_content_id: taskId, timestamp: '2026-10-20T22:15:00Z' }, { authorization: 'Bearer tok' }), aenv, ctx);
check(res.status === 200 && makeCalls.length === 6, 'approve_all posts 6 payloads to Make');
const li = makeCalls.find((c) => c.platform === 'linkedin');
check(li.linkedin_text === 'linkedin copy' && li.title && li.excerpt && li.url && li.campaign && li.approved_by === 'chris' && li.approval_timestamp === '2026-10-20T22:15:00.000Z' && Array.isArray(li.asset_tags) && li.cta, 'linkedin payload has OpenClaw + live-Make fields');
check(!('linkedin_text' in makeCalls.find((c) => c.platform === 'x')), 'only linkedin carries linkedin_text');
check(env.AGENT_LOGS.metrics.length === 6 && env.AGENT_LOGS.logs.some((r) => r.status === 'published'), 'social_metrics + published logged');
check(slackPosts.length === 1 && slackPosts[0].thread_ts === '1.1' && /LinkedIn/.test(slackPosts[0].text) && /HKT/.test(slackPosts[0].text), 'thread reply names platforms and HKT time');
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
check(scheduledTime('2026-10-21', 'linkedin', new Date('2026-10-20T22:00:00Z')) === '2026-10-21T00:30:00.000Z', 'linkedin 08:30 HKT = 00:30Z');

console.log(`mpt-content pipeline: ${passed} checks passed`);
