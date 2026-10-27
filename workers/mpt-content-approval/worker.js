// mpt-content-approval: POST /approve
//   Slack interactivity (form field `payload`, verified with SLACK_SIGNING_SECRET) or JSON
//   { "action": "approve_all" | "reject" | "edit_resubmit", "drafted_content_id": "daily-posts-YYYY-MM-DD", "timestamp": "..." }
//   (JSON requires `Authorization: Bearer <APPROVAL_API_TOKEN>`).
//   reject      -> log to D1, reply in the Slack thread
//   approve_all -> build the 6-platform payload, validate it (schema.js), POST it once to the Make.com webhook,
//                  log every attempt to D1 (make_webhook_log + agent_execution_logs 'published'/'failed' + social_metrics), reply in thread

import { SCHEMA_VERSION, PLATFORMS, LEGACY_PLATFORMS, validateMakePayload } from './schema.js';

const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', instagram: 'IG', facebook: 'FB', pinterest: 'Pinterest', youtube: 'YouTube', reddit: 'Reddit' };
// HKT publish windows from MPC-8332 acceptance criteria / daily platform specs.
const PUBLISH_HKT = { x: '12:00', linkedin: '08:30', instagram: '18:30', facebook: '13:00', pinterest: '20:00', youtube: '17:00', reddit: '19:00' };
const CAMPAIGN = 'mpc-7033-daily';
const SITE = 'https://myprivacytool.io';
const MAKE_TIMEOUT_MS = 10_000;
const REQUEST_LOG_CHARS = 2000;
const RESPONSE_LOG_CHARS = 500;
const encoder = new TextEncoder();
const iso = (d = new Date()) => d.toISOString();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifySlack(env, request, rawBody, nowMs = Date.now()) {
  const ts = request.headers.get('x-slack-request-timestamp');
  const sig = request.headers.get('x-slack-signature');
  if (!ts || !sig || !env.SLACK_SIGNING_SECRET || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  return safeEqual(`v0=${await hmacHex(env.SLACK_SIGNING_SECRET, `v0:${ts}:${rawBody}`)}`, sig);
}

async function log(env, taskId, status, { error = null, draft = null } = {}) {
  await env.AGENT_LOGS.prepare('INSERT INTO agent_execution_logs (id, timestamp, task_id, status, error_message, draft_content) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), iso(), taskId, status, error, draft === null ? null : JSON.stringify(draft)).run();
}
async function rows(env, taskId, status) {
  const { results } = await env.AGENT_LOGS.prepare('SELECT draft_content FROM agent_execution_logs WHERE task_id = ? AND status = ? ORDER BY timestamp').bind(taskId, status).all();
  return (results ?? []).map((r) => (r.draft_content ? JSON.parse(r.draft_content) : null)).filter(Boolean);
}

const HKT_OFFSET_MS = 8 * 3600e3;
/** Date -> "YYYY-MM-DDTHH:MM:SS+08:00". */
export const toHktIso = (d) => `${new Date(d.getTime() + HKT_OFFSET_MS).toISOString().slice(0, 19)}+08:00`;

/** Publish time for a platform on `date` (YYYY-MM-DD, HKT); a window already in the past becomes "now". */
export function scheduledTime(date, platform, now = new Date()) {
  const t = new Date(`${date}T${PUBLISH_HKT[platform]}:00+08:00`);
  return toHktIso(t > now ? t : now);
}

const contentTypeOf = (url) => (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url ?? '') ? 'video' : 'image');

/**
 * The Make.com hand-off: one envelope carrying a post per platform (X, LinkedIn, IG, FB, Pinterest, YouTube; Reddit while
 * the consumer still drafts it). Must pass validateMakePayload() before it is sent.
 */
export function buildMakePayload(drafts, { taskId, approvedBy, approvalTimestamp, defaultAssetUrl = '', defaultImageKey = '' }) {
  const date = taskId.replace('daily-posts-', '');
  const order = [...PLATFORMS, ...LEGACY_PLATFORMS];
  const posts = [...drafts]
    .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))
    .map((d) => {
      const assetUrl = d.asset_url || defaultAssetUrl || null;
      const imageKey = d.platform === 'linkedin' ? d.image_key || defaultImageKey : '';
      return {
        platform: d.platform,
        title: d.title || d.topic || 'MyPrivacyTOOL',
        body: d.copy,
        hashtags: d.hashtags ?? '',
        cta: d.cta || 'Check your exposure',
        content_type: d.content_type || contentTypeOf(assetUrl),
        asset_url: assetUrl,
        link_url: `${SITE}?utm_source=${d.platform}&utm_medium=social&utm_campaign=${CAMPAIGN}&utm_content=${date}`,
        publish_timestamp: scheduledTime(date, d.platform, new Date(approvalTimestamp)),
        ...(d.platform === 'reddit' ? { subreddit: d.subreddit || 'r/privacy' } : {}),
        ...(imageKey ? { image_key: imageKey } : {}),
        ...(d.slides ? { slides: d.slides } : {}),
        ...(d.script ? { script: d.script } : {}),
        ...(Array.isArray(d.asset_tags) && d.asset_tags.length ? { asset_tags: d.asset_tags } : {}),
      };
    });
  return {
    schema_version: SCHEMA_VERSION,
    campaign: CAMPAIGN,
    drafted_content_id: taskId,
    approved_by: approvedBy,
    approval_timestamp: toHktIso(new Date(approvalTimestamp)),
    posts,
  };
}

/** The webhook URL carries its secret token in the path, so only its origin and last 4 characters are logged. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/…${u.pathname.slice(-4)}`;
  } catch {
    return 'invalid-url';
  }
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…[truncated ${s.length - n}]` : s);

async function logMake(env, taskId, { statusCode = null, request = '', response = '', error = null }) {
  try {
    await env.AGENT_LOGS.prepare('INSERT INTO make_webhook_log (id, timestamp, task_id, webhook_url, status_code, request_body, response_body, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), iso(), taskId, maskUrl(env.MAKE_WEBHOOK_URL), statusCode, clip(request, REQUEST_LOG_CHARS), clip(response, RESPONSE_LOG_CHARS), error).run();
  } catch (e) {
    console.error('make_webhook_log insert failed', e?.message); // never let logging mask the real outcome
  }
}

/** POST the validated payload once. Resolves { ok, statusCode, error } and always writes a make_webhook_log row. */
export async function postToMake(env, taskId, payload) {
  const body = JSON.stringify(payload);
  if (!env.MAKE_WEBHOOK_URL) {
    const error = 'MAKE_WEBHOOK_URL is not configured';
    await logMake(env, taskId, { request: body, error });
    return { ok: false, statusCode: null, error };
  }
  const headers = { 'content-type': 'application/json' };
  if (env.MAKE_API_KEY) headers['x-make-apikey'] = env.MAKE_API_KEY; // only when the Make hook has an API-key check
  try {
    const res = await fetch(env.MAKE_WEBHOOK_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(MAKE_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    const error = res.ok ? null : `Make webhook ${res.status}`;
    await logMake(env, taskId, { statusCode: res.status, request: body, response: text, error });
    return { ok: res.ok, statusCode: res.status, error };
  } catch (e) {
    const error = `Make webhook request failed: ${e?.message ?? e}`;
    await logMake(env, taskId, { request: body, error });
    return { ok: false, statusCode: null, error };
  }
}

async function reply(env, target, text) {
  if (!target?.channel || !target?.ts || !env.SLACK_BOT_TOKEN) return;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: target.channel, thread_ts: target.ts, text }),
  }).catch((e) => console.error('slack reply failed', e?.message));
}

const hktClock = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(11, 16);

/** Replace the button row on the original message with a status banner, so a decided message can't be clicked again. */
export async function markDecided(env, target, text) {
  if (!target?.channel || !target?.ts || !env.SLACK_BOT_TOKEN || !Array.isArray(target.blocks)) return;
  const blocks = [...target.blocks.filter((b) => b.type !== 'actions'), { type: 'section', text: { type: 'mrkdwn', text } }];
  await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: target.channel, ts: target.ts, text, blocks }),
  }).catch((e) => console.error('slack update failed', e?.message));
}

export async function process(env, { action, taskId, timestamp, approver, target }) {
  const drafts = await rows(env, taskId, 'drafted');
  if (!drafts.length) return { status: 404, message: `no drafts for ${taskId}` };
  target ??= (await rows(env, taskId, 'notified'))[0];

  // Only a published or rejected cycle is final: a failed hand-off stays re-approvable ("Logged for retry").
  const done = (await rows(env, taskId, 'published')).length + (await rows(env, taskId, 'rejected')).length;
  if (done) { await reply(env, target, 'Already decided for this cycle; ignoring.'); return { status: 200, message: 'already decided' }; }

  if (action === 'reject') {
    await log(env, taskId, 'rejected', { draft: { by: approver } });
    await reply(env, target, 'Rejected. Awaiting next cycle.');
    await markDecided(env, target, `❌ *REJECTED* by ${approver}. Nothing was sent. Awaiting next cycle.`);
    return { status: 200, message: 'rejected' };
  }
  if (action === 'edit_resubmit') {
    await log(env, taskId, 'edit_requested', { draft: { by: approver } });
    await reply(env, target, 'Edit & Resubmit is not automated yet. Edit the drafts (agent_execution_logs.draft_content) and re-send approve_all, or reject and wait for the next cycle.');
    return { status: 200, message: 'edit requested' };
  }
  if (action !== 'approve_all') return { status: 400, message: `unknown action ${action}` };

  const approvedAt = timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp) : new Date();
  // The fixed primary key makes the second of two near-simultaneous clicks fail here instead of posting to Make twice.
  const claimId = `${taskId}:claim`;
  try {
    await env.AGENT_LOGS.prepare('INSERT INTO agent_execution_logs (id, timestamp, task_id, status) VALUES (?, ?, ?, ?)').bind(claimId, iso(), taskId, 'processing').run();
  } catch {
    await reply(env, target, 'Already being processed; ignoring.');
    return { status: 200, message: 'in progress' };
  }
  let succeeded = false;
  try {
    return await approve();
  } finally {
    // Keep the claim after success; release it after any failure so the cycle stays re-approvable ("Logged for retry").
    if (!succeeded) await env.AGENT_LOGS.prepare('DELETE FROM agent_execution_logs WHERE id = ?').bind(claimId).run().catch(() => {});
  }

  async function approve() {
  await log(env, taskId, 'approved', { draft: { by: approver } });

  const payload = buildMakePayload(drafts, { taskId, approvedBy: approver, approvalTimestamp: approvedAt.toISOString(), defaultAssetUrl: env.DEFAULT_ASSET_URL, defaultImageKey: env.DEFAULT_IMAGE_KEY });
  const check = validateMakePayload(payload);
  if (!check.ok) {
    const error = `schema validation failed: ${check.errors.join('; ')}`;
    await log(env, taskId, 'failed', { error: clip(error, 1000) });
    await reply(env, target, `Failed to post drafts. Schema validation failed, nothing was sent to Make.com: ${clip(check.errors.slice(0, 5).join('; '), 600)}`);
    return { status: 422, message: error };
  }

  const sent = await postToMake(env, taskId, payload);
  if (!sent.ok) {
    await log(env, taskId, 'failed', { error: sent.error });
    await reply(env, target, 'Failed to post drafts. Logged for retry.');
    return { status: 502, message: sent.error };
  }

  for (const p of payload.posts) {
    await env.AGENT_LOGS.prepare('INSERT INTO social_metrics (id, timestamp, platform, topic, impressions, engagement, url) VALUES (?, ?, ?, ?, 0, 0, NULL)')
      .bind(crypto.randomUUID(), iso(), p.platform, drafts.find((d) => d.platform === p.platform)?.topic ?? null).run();
  }
  await log(env, taskId, 'published', { draft: { platforms: payload.posts.map((p) => p.platform), approved_by: approver } });
  const names = payload.posts.map((p) => PLATFORM_NAMES[p.platform]).join(', ');
  const done = `✅ *COMPLETED*: approved by ${approver} at ${hktClock(approvedAt)} HKT. Make.com accepted the hand-off (HTTP ${sent.statusCode}) for ${payload.posts.length} posts: ${names}. Publishing is done by the Make.com scenario.`;
  await reply(env, target, done);
  await markDecided(env, target, done);
  succeeded = true;
  return { status: 200, message: 'approved' };
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/approve') return Response.json({ ok: true, worker: 'mpt-content-approval' });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });

    const raw = await request.text();
    let job;
    if ((request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
      if (!(await verifySlack(env, request, raw))) return new Response('Invalid Slack signature', { status: 401 });
      const p = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}');
      const a = p.actions?.[0];
      if (!a) return new Response('', { status: 200 });
      job = { action: a.action_id, taskId: a.value, timestamp: iso(), approver: p.user?.username || env.SLACK_APPROVER || 'chris', target: { channel: p.channel?.id, ts: p.message?.ts, blocks: p.message?.blocks } };
    } else {
      const auth = request.headers.get('authorization') ?? '';
      if (!env.APPROVAL_API_TOKEN || !safeEqual(auth, `Bearer ${env.APPROVAL_API_TOKEN}`)) return new Response('Unauthorized', { status: 401 });
      let body;
      try { body = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }
      job = { action: body.action, taskId: body.drafted_content_id, timestamp: body.timestamp, approver: env.SLACK_APPROVER || 'chris' };
    }
    if (!/^daily-posts-\d{4}-\d{2}-\d{2}$/.test(job.taskId ?? '')) return new Response('Bad drafted_content_id', { status: 400 });

    if (job.target) { // Slack needs a 200 within 3 s; do the work after replying
      ctx.waitUntil(process(env, job).catch((e) => console.error('approve failed', e?.message)));
      return new Response('', { status: 200 });
    }
    const out = await process(env, job);
    return Response.json({ ok: out.status < 400, message: out.message }, { status: out.status });
  },
};
