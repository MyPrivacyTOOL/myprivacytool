// mpt-content-approval: POST /approve
//   Slack interactivity (form field `payload`, verified with SLACK_SIGNING_SECRET) or JSON
//   { "action": "approve_all" | "reject" | "edit_resubmit", "drafted_content_id": "daily-posts-YYYY-MM-DD", "timestamp": "..." }
//   (JSON requires `Authorization: Bearer <APPROVAL_API_TOKEN>`).
//   reject      -> log to D1, reply in the Slack thread
//   approve_all -> validate each draft against Make.com schema, POST each to the Make.com webhook, log to D1 (agent_execution_logs 'published' + social_metrics), reply in thread

const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', reddit: 'Reddit' };
// HKT publish windows from MPC-8332 acceptance criteria / daily platform specs.
const PUBLISH_HKT = { x: '12:00', linkedin: '08:30', instagram: '18:30', reddit: '19:00' };
const CAMPAIGN = 'mpc-7033-daily';
const SITE = 'https://myprivacytool.io';
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

export function scheduledTime(date, platform, now = new Date()) {
  const t = new Date(`${date}T${PUBLISH_HKT[platform]}:00+08:00`);
  return iso(t > now ? t : now);
}

/**
 * Validate draft content against Make.com schema.
 * Required fields: platform, copy, cta
 * Platform-specific: title for LinkedIn, subreddit for Reddit
 * Returns { valid: boolean, errors: string[] }
 */
export function validateMakeSchema(draft) {
  const errors = [];
  if (!draft.platform || !['x', 'linkedin', 'instagram', 'reddit'].includes(draft.platform)) {
    errors.push('platform must be one of: x, linkedin, instagram, reddit');
  }
  if (!draft.copy || typeof draft.copy !== 'string' || draft.copy.trim().length === 0) {
    errors.push('copy is required and must be a non-empty string');
  }
  if (!draft.cta || typeof draft.cta !== 'string' || draft.cta.trim().length === 0) {
    errors.push('cta (call-to-action) is required and must be a non-empty string');
  }
  if (draft.platform === 'linkedin' && (!draft.title || typeof draft.title !== 'string' || draft.title.trim().length === 0)) {
    errors.push('LinkedIn posts require a title field');
  }
  if (draft.platform === 'reddit' && (!draft.subreddit || typeof draft.subreddit !== 'string' || !draft.subreddit.startsWith('r/'))) {
    errors.push('Reddit posts require a subreddit field (format: r/privacy)');
  }
  if (draft.asset_url && typeof draft.asset_url !== 'string') {
    errors.push('asset_url must be a string if provided');
  }
  if (draft.asset_tags && !Array.isArray(draft.asset_tags)) {
    errors.push('asset_tags must be an array if provided');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Make.com handoff. Contains the OpenClaw fields AND the fields the live Make scenario (MPC-6952, hook 3856260) reads
 * (title, excerpt, url, campaign, linkedin_text). `linkedin_text` is only set for LinkedIn: that scenario's only action is
 * "LinkedIn page share, when linkedin_text exists", so the other platforms are accepted but not published until Make is extended.
 */
export function handoffPayload(draft, { date, approvedBy, approvalTimestamp, defaultAssetUrl = '' }) {
  const copy = draft.copy;
  const cta = draft.cta || 'Check your exposure';
  return {
    platform: draft.platform,
    copy,
    asset_url: draft.asset_url || defaultAssetUrl || null,
    asset_tags: draft.asset_tags ?? [],
    cta,
    scheduled_time: scheduledTime(date, draft.platform, new Date(approvalTimestamp)),
    approved_by: approvedBy,
    approval_timestamp: approvalTimestamp,
    // fields below exist for the live Make scenario / Reddit
    title: draft.title || draft.topic || 'MyPrivacyTOOL',
    excerpt: copy.slice(0, 200),
    url: SITE,
    campaign: CAMPAIGN,
    ...(draft.platform === 'linkedin' ? { linkedin_text: copy } : {}),
    ...(draft.platform === 'reddit' ? { subreddit: draft.subreddit || 'r/privacy' } : {}),
    ...(draft.slides ? { slides: draft.slides } : {}),
  };
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

export async function process(env, { action, taskId, timestamp, approver, target }) {
  const drafts = await rows(env, taskId, 'drafted');
  if (!drafts.length) return { status: 404, message: `no drafts for ${taskId}` };
  target ??= (await rows(env, taskId, 'notified'))[0];

  const done = (await rows(env, taskId, 'approved')).length + (await rows(env, taskId, 'rejected')).length;
  if (done) { await reply(env, target, 'Already decided for this cycle; ignoring.'); return { status: 200, message: 'already decided' }; }

  if (action === 'reject') {
    await log(env, taskId, 'rejected', { draft: { by: approver } });
    await reply(env, target, 'Rejected. Awaiting next cycle.');
    return { status: 200, message: 'rejected' };
  }
  if (action === 'edit_resubmit') {
    await log(env, taskId, 'edit_requested', { draft: { by: approver } });
    await reply(env, target, 'Edit & Resubmit is not automated yet. Edit the drafts (agent_execution_logs.draft_content) and re-send approve_all, or reject and wait for the next cycle.');
    return { status: 200, message: 'edit requested' };
  }
  if (action !== 'approve_all') return { status: 400, message: `unknown action ${action}` };

  // Validate all drafts against Make.com schema before proceeding
  const validationResults = drafts.map((d) => ({ draft: d, validation: validateMakeSchema(d) }));
  const invalid = validationResults.filter((r) => !r.validation.valid);
  if (invalid.length) {
    const errorSummary = invalid.map((r) => `${r.draft.platform}: ${r.validation.errors.join(', ')}`).join('\n');
    await log(env, taskId, 'validation_failed', { error: errorSummary });
    await reply(env, target, `❌ Schema validation failed:\n${errorSummary}\n\nFix the drafts and resubmit.`);
    return { status: 400, message: `validation failed: ${errorSummary}` };
  }

  const date = taskId.replace('daily-posts-', '');
  const approvedAt = timestamp && !Number.isNaN(Date.parse(timestamp)) ? iso(new Date(timestamp)) : iso();
  await log(env, taskId, 'approved', { draft: { by: approver } });

  const results = await Promise.allSettled(drafts.map(async (d) => {
    const res = await fetch(env.MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(handoffPayload(d, { date, approvedBy: approver, approvalTimestamp: approvedAt, defaultAssetUrl: env.DEFAULT_ASSET_URL })),
    });
    if (!res.ok) throw new Error(`${d.platform}: Make webhook ${res.status}`);
    return d;
  }));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);

  for (const d of ok) {
    await env.AGENT_LOGS.prepare('INSERT INTO social_metrics (id, timestamp, platform, topic, impressions, engagement, url) VALUES (?, ?, ?, ?, 0, 0, NULL)')
      .bind(crypto.randomUUID(), iso(), d.platform, d.topic ?? null).run();
  }
  if (ok.length) await log(env, taskId, 'published', { draft: { platforms: ok.map((d) => d.platform), approved_by: approver } });
  if (failed.length) await log(env, taskId, 'failed', { error: failed.join('; ') });

  const names = ok.map((d) => PLATFORM_NAMES[d.platform]).join(', ') || 'none';
  const live = ok.some((d) => d.platform === 'linkedin') ? ' Live publishing today: LinkedIn only (the Make scenario has no X/IG/Reddit modules yet).' : '';
  await reply(env, target, `✅ Handed to Make.com: ${names} at ${hktClock(new Date())} HKT.${live}${failed.length ? ` ⚠️ Failed: ${failed.join('; ')}` : ''}`);
  return { status: failed.length ? 502 : 200, message: failed.length ? failed.join('; ') : 'approved' };
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
      job = { action: a.action_id, taskId: a.value, timestamp: iso(), approver: p.user?.username || env.SLACK_APPROVER || 'chris', target: { channel: p.channel?.id, ts: p.message?.ts } };
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
