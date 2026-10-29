// mpt-content-approval: POST /approve
//   Slack interactivity (form field `payload`, verified with SLACK_SIGNING_SECRET) or JSON
//   { "action": "approve_all" | "reject" | "edit_resubmit", "drafted_content_id": "daily-posts-YYYY-MM-DD", "timestamp": "..." }
//   (JSON requires `Authorization: Bearer <APPROVAL_API_TOKEN>`).
//   reject      -> log to D1, reply in the Slack thread
//   approve_all -> build the 6-platform payload, validate it (schema.js), POST it once to the Make.com webhook,
//                  log every attempt to D1 (make_webhook_log + agent_execution_logs 'handed_off'/'failed' + publication_receipts), reply in thread.
//                  A Make 2xx is HANDED OFF only. POST /receipt (HMAC-signed) is the only path to verified_published. GET /status reports stages.

import { SCHEMA_VERSION, PLATFORMS, LEGACY_PLATFORMS, validateMakePayload } from './schema.js';
import { expectedCycleIds, watchdogReport, recordNotRouted, recordDrafted, recordApproved, recordHandedOff, recordHandoffFailure, applyReconciliation, handleReceipt, logRejectedReceipt, classifyCycle, sendable, rowsFor, parseRetryAfter, safeEqual as safeEqualReceipt } from './receipts.js';

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
export async function postToMake(env, taskId, payload, meta = {}) {
  const body = JSON.stringify(payload);
  if (!env.MAKE_WEBHOOK_URL) {
    const error = 'MAKE_WEBHOOK_URL is not configured';
    meta.notSent = true; // definitely not delivered, so not an ambiguous outcome
    await logMake(env, taskId, { request: body, error });
    return { ok: false, statusCode: null, error };
  }
  const headers = { 'content-type': 'application/json' };
  if (env.MAKE_API_KEY) headers['x-make-apikey'] = env.MAKE_API_KEY; // only when the Make hook has an API-key check
  try {
    const res = await fetch(env.MAKE_WEBHOOK_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(MAKE_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    const error = res.ok ? null : `Make webhook ${res.status}`;
    meta.retryAfterS = parseRetryAfter(res.headers?.get?.('retry-after'));
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
  const res = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: target.channel, ts: target.ts, text, blocks }),
  }).catch((e) => console.error('slack update failed', e?.message));
  // Slack answers 200 with { ok: false, error } when it refuses an edit; surface that instead of failing silently.
  const out = await res?.json?.().catch(() => null);
  if (out && out.ok === false) console.error('slack update refused', out.error);
}

export async function process(env, { action, taskId, timestamp, approver, target }) {
  const drafts = await rows(env, taskId, 'drafted');
  if (!drafts.length) return { status: 404, message: `no drafts for ${taskId}` };
  target ??= (await rows(env, taskId, 'notified'))[0];

  // Only a published or rejected cycle is final: a failed hand-off stays re-approvable ("Logged for retry").
  // CK-8482: 'handed_off' is the truthful status for a Make 2xx; 'published' rows are legacy cycles written before it.
  const handedOff = (await rows(env, taskId, 'handed_off')).length + (await rows(env, taskId, 'published')).length;
  const done = handedOff + (await rows(env, taskId, 'rejected')).length;
  if (done) {
    await reply(env, target, 'Already decided for this cycle; ignoring.');
    // Turn the still-clickable buttons into a banner so nobody keeps pressing a dead button.
    const approved = handedOff > 0;
    await markDecided(env, target, approved ? '✅ *HANDED OFF*: already approved and handed to Make.com. Further clicks are ignored.' : '❌ *REJECTED*: already rejected. Further clicks are ignored.');
    return { status: 200, message: 'already decided' };
  }

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

  // CK-8482: per-platform state. Tracking must never mask the real outcome, so a D1 failure here degrades to the legacy flow.
  const allPlatforms = payload.posts.map((p) => p.platform);
  // ROUTED_PLATFORMS: the platforms the Make scenario can actually publish. Unset = legacy behaviour (everything is sent).
  // YouTube is routed only on every third day of the month (Hong Kong date), matching the Make route's own day filter.
  const youtubeDay = new Date(approvedAt.getTime() + 8 * 3600e3).getUTCDate() % 3 === 0;
  const routedList = (env.ROUTED_PLATFORMS ?? '').split(',').map((s) => s.trim()).filter((s) => s && (s !== 'youtube' || youtubeDay));
  const platforms = routedList.length ? allPlatforms.filter((p) => routedList.includes(p)) : allPlatforms;
  const unrouted = allPlatforms.filter((p) => !platforms.includes(p));
  if (!platforms.length) {
    const error = `none of the drafted platforms are routed (ROUTED_PLATFORMS=${routedList.join(',')})`;
    await log(env, taskId, 'failed', { error });
    await reply(env, target, `Failed to post drafts. ${error}; nothing was sent to Make.com.`);
    return { status: 422, message: error };
  }
  let toSend = platforms;
  try {
    await recordDrafted(env.AGENT_LOGS, taskId, allPlatforms, approvedAt);
    if (unrouted.length) await recordNotRouted(env.AGENT_LOGS, taskId, unrouted, approvedAt);
    await recordApproved(env.AGENT_LOGS, taskId, platforms, approvedAt);
    toSend = sendable(await rowsFor(env.AGENT_LOGS, taskId), platforms, approvedAt);
  } catch (e) {
    console.error('publication_receipts tracking unavailable', e?.message);
  }
  if (!toSend.length) {
    // Everything already handed off (or awaiting reconciliation of an ambiguous timeout): never re-send.
    await reply(env, target, 'Nothing to send: every platform is already handed off, verified, or awaiting reconciliation of an unknown outcome.');
    succeeded = true;
    return { status: 200, message: 'nothing to send' };
  }
  const outbound = toSend.length === allPlatforms.length ? payload : { ...payload, posts: payload.posts.filter((p) => toSend.includes(p.platform)) };

  const meta = {};
  const sent = await postToMake(env, taskId, outbound, meta);
  if (!sent.ok) {
    const ambiguous = sent.statusCode === null && !meta.notSent; // timeout / network error: Make may have received it
    let outcome = null;
    try { outcome = await recordHandoffFailure(env.AGENT_LOGS, taskId, toSend, { error: sent.error, ambiguous, retryAfterS: meta.retryAfterS, now: new Date() }); } catch (e) { console.error('publication_receipts tracking unavailable', e?.message); }
    await log(env, taskId, 'failed', { error: sent.error });
    if (ambiguous) {
      await reply(env, target, 'Make.com did not confirm the hand-off (timeout/network error). Outcome UNKNOWN: nothing will be re-sent until it has been reconciled.');
      succeeded = true; // keep the claim: a second click must not re-send an unreconciled hand-off
      return { status: 502, message: sent.error };
    }
    await reply(env, target, outcome?.deadLettered?.length ? `Failed to post drafts. Retries exhausted for ${outcome.deadLettered.join(', ')}; needs a human.` : 'Failed to post drafts. Logged for retry.');
    return { status: 502, message: sent.error };
  }

  try { await recordHandedOff(env.AGENT_LOGS, taskId, toSend, { now: new Date() }); } catch (e) { console.error('publication_receipts tracking unavailable', e?.message); }
  await log(env, taskId, 'handed_off', { draft: { platforms: toSend, approved_by: approver } });
  const names = outbound.posts.map((p) => PLATFORM_NAMES[p.platform]).join(', ');
  const done = `✅ *HANDED OFF*: approved by ${approver} at ${hktClock(approvedAt)} HKT. Make.com accepted the hand-off (HTTP ${sent.statusCode}) for ${outbound.posts.length} posts: ${names}. Not yet verified as published: platform receipts will confirm each post.${unrouted.length ? ` Not sent (no Make route yet): ${unrouted.map((p) => PLATFORM_NAMES[p]).join(', ')}.` : ''}`;
  await reply(env, target, done);
  await markDecided(env, target, done);
  succeeded = true;
  return { status: 200, message: 'approved' };
  }
}

/**
 * CK-8482 bounded recovery. Re-sends ONLY platforms that definitely failed and are due (backoff elapsed, not dead-lettered,
 * approval intact); ambiguous timeouts are reconciled first and never re-sent on `unknown`.
 * reconcile(contentId, platform) -> 'received' | 'not_received' | 'unknown'  (optional; without it unknown stays pending)
 * Not scheduled by default: wiring a cron needs account-level authority (see the CK-8482 runbook).
 */
export async function recover(env, { now = new Date(), reconcile = null, contentIds = null } = {}) {
  const report = { resent: [], reconciled: [], deadLettered: [], skipped: [] };
  const { results } = await env.AGENT_LOGS.prepare("SELECT DISTINCT content_id FROM publication_receipts WHERE (state = 'failed' AND dead_letter = 0) OR outcome_unknown = 1").bind().all();
  for (const { content_id: id } of results ?? []) {
    if (contentIds && !contentIds.includes(id)) continue;
    // Publication approval stays intact: no approval row, or a rejection, means nothing is re-sent.
    if (!(await rows(env, id, 'approved')).length || (await rows(env, id, 'rejected')).length) { report.skipped.push({ id, reason: 'not_approved' }); continue; }
    const target = (await rows(env, id, 'notified'))[0];
    let current = await rowsFor(env.AGENT_LOGS, id);
    for (const r of current.filter((x) => x.outcome_unknown)) {
      const verdict = reconcile ? await reconcile(id, r.platform).catch(() => 'unknown') : 'unknown';
      await applyReconciliation(env.AGENT_LOGS, id, r.platform, verdict, { source: 'recover', now });
      report.reconciled.push({ id, platform: r.platform, verdict });
    }
    current = await rowsFor(env.AGENT_LOGS, id);
    const due = sendable(current, current.filter((x) => x.state === 'failed').map((x) => x.platform), now);
    if (!due.length) continue;
    const drafts = (await rows(env, id, 'drafted')).filter((d) => due.includes(d.platform));
    const payload = buildMakePayload(drafts, { taskId: id, approvedBy: env.SLACK_APPROVER || 'chris', approvalTimestamp: now.toISOString(), defaultAssetUrl: env.DEFAULT_ASSET_URL });
    const check = validateMakePayload(payload);
    if (!check.ok) { report.skipped.push({ id, reason: 'schema_invalid' }); continue; }
    const meta = {};
    const sent = await postToMake(env, id, payload, meta);
    if (sent.ok) {
      await recordHandedOff(env.AGENT_LOGS, id, due, { now });
      await log(env, id, 'handed_off', { draft: { platforms: due, recovery: true } });
      report.resent.push({ id, platforms: due });
      continue;
    }
    const out = await recordHandoffFailure(env.AGENT_LOGS, id, due, { error: sent.error, ambiguous: sent.statusCode === null && !meta.notSent, retryAfterS: meta.retryAfterS, now });
    if (out.deadLettered.length) {
      report.deadLettered.push({ id, platforms: out.deadLettered });
      await reply(env, target, `ALERT: retries exhausted for ${out.deadLettered.join(', ')} (${id}). Last error: ${sent.error}. Needs a human; nothing further will be sent automatically.`);
    }
  }
  return report;
}

export default {
  // Only runs when a cron trigger is configured for this Worker; none is (CK-8482 does not activate schedules).
  async scheduled(_event, env, ctx) { ctx.waitUntil(recover(env).catch((e) => console.error('recover failed', e?.message))); },
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/receipt') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      const rawBody = await request.text();
      const out = await handleReceipt(env, rawBody, request.headers);
      await logRejectedReceipt(env, out, rawBody, Date.now(), request.headers);
      return Response.json({ ok: out.status < 400, message: out.message, state: out.state }, { status: out.status });
    }
    if (pathname === '/watchdog' || pathname === '/recover') {
      const auth = request.headers.get('authorization') ?? '';
      if (!env.APPROVAL_API_TOKEN || !safeEqualReceipt(auth, `Bearer ${env.APPROVAL_API_TOKEN}`)) return new Response('Unauthorized', { status: 401 });
      if (pathname === '/recover') {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
        return Response.json({ ok: true, ...(await recover(env)) });
      }
      const days = Math.min(14, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 3));
      const ids = expectedCycleIds(new Date(), days);
      const { results: logs } = await env.AGENT_LOGS.prepare("SELECT task_id, status FROM agent_execution_logs WHERE task_id LIKE 'daily-posts-%' AND status IN ('drafted','approved','rejected','failed','handed_off','published')").bind().all();
      const { results: receipts } = await env.AGENT_LOGS.prepare('SELECT * FROM publication_receipts WHERE content_id >= ?').bind(ids[ids.length - 1]).all();
      return Response.json(watchdogReport({ ids, logs: logs ?? [], receipts: receipts ?? [] }));
    }
    if (pathname === '/status') {
      const auth = request.headers.get('authorization') ?? '';
      if (!env.APPROVAL_API_TOKEN || !safeEqualReceipt(auth, `Bearer ${env.APPROVAL_API_TOKEN}`)) return new Response('Unauthorized', { status: 401 });
      const id = new URL(request.url).searchParams.get('drafted_content_id') ?? '';
      if (!/^daily-posts-\d{4}-\d{2}-\d{2}$/.test(id)) return new Response('Bad drafted_content_id', { status: 400 });
      const found = await rowsFor(env.AGENT_LOGS, id);
      return Response.json({ drafted_content_id: id, platforms: found.map(({ platform, state, attempts, post_id, post_url, make_run_id, provenance, outcome_unknown, dead_letter }) => ({ platform, state, attempts, post_id, post_url, make_run_id, provenance, outcome_unknown, dead_letter })), ...classifyCycle(found) });
    }
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
