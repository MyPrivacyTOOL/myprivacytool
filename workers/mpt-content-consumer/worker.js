// mpt-content-consumer: handles { date, action: "generate_daily_posts", topic?, pillar?, format_type?, asset_tags? } messages
// from mpt-content-generation-queue (topic comes from the producer's mpt-brand-topics read).
//   1. read brand/tone guardrails from KV mpt-content-cache (topic falls back to schedule:<date> there if the message has none)
//   2. six CONCURRENT Anthropic calls (X, LinkedIn, Instagram, Facebook, Pinterest, YouTube)
//   3. save the 6 drafts to D1 agent_execution_logs (one row per platform)
//   4. post to Slack #mpt-content-approval with Approve All / Reject / Edit & Resubmit buttons (handled by mpt-content-approval)

export const PLATFORMS = ['x', 'linkedin', 'instagram', 'facebook', 'pinterest', 'youtube'];
const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', pinterest: 'Pinterest', youtube: 'YouTube' };
// Where each draft goes once approved, shown under the draft so the reviewer sees the destination and can open it.
const PLATFORM_DESTINATIONS = {
  x: { note: 'Not connected: copy and post by hand', url: 'https://x.com/compose/post', label: 'Open X' },
  linkedin: { note: 'Posts automatically on Approve All', url: 'https://www.linkedin.com/company/88918654/', label: 'LinkedIn page' },
  instagram: { note: 'Posts automatically on Approve All (image posts)', url: 'https://www.instagram.com/myprivacytool/', label: 'Instagram' },
  facebook: { note: 'Posts automatically on Approve All', url: 'https://www.facebook.com/105634291085696', label: 'Facebook page' },
  pinterest: { note: 'Not connected: copy and post by hand', url: 'https://www.pinterest.com/pin-builder/', label: 'Open Pinterest' },
  youtube: { note: 'Uploads the queued Drive video on days 3, 6, 9 … 30', url: 'https://studio.youtube.com', label: 'YouTube Studio' },
};
const PLATFORM_RULES = {
  x: 'A thread of 3-5 posts. Each post at most 280 characters. Separate posts with a line containing only ---.',
  linkedin: 'Professional thought-leadership post, 2-3 short paragraphs, at most 3000 characters.',
  instagram: 'Caption of at most 2200 characters, 3-5 sentences, light emoji, 5-8 hashtags. Start with a 9-slide carousel outline in "slides" (one short line per slide).',
  facebook: 'Conversational page post, 2-4 short sentences, at most 500 characters, at most 2 hashtags.',
  pinterest: 'Pin with a keyword-rich "title" (max 100 chars) and a description in "copy" (at most 500 characters).',
  youtube: 'Short-form video: a "title" (max 100 chars), a 30-45 second spoken script in "script", and a description in "copy" (at most 5000 characters).',
};
const BRAND_KEYWORDS = /voice|tone|messag|language|social|do'?s|don'?t|never|always|guardrail/i;
const BRAND_CHAR_CAP = 6000;
const CTA = 'Check your exposure';
// Must equal CAMPAIGN in workers/mpt-content-approval/worker.js so a post's text link and its link card report as one GA4 campaign.
const CAMPAIGN = 'mpc-7033-daily';
const TITLED = ['pinterest', 'youtube'];

export const taskIdFor = (date) => `daily-posts-${date}`;
const now = () => new Date().toISOString();

async function log(env, taskId, status, { error = null, draft = null } = {}) {
  await env.AGENT_LOGS.prepare('INSERT INTO agent_execution_logs (id, timestamp, task_id, status, error_message, draft_content) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), now(), taskId, status, error, draft === null ? null : JSON.stringify(draft)).run();
}

async function rows(env, taskId, status) {
  const { results } = await env.AGENT_LOGS.prepare('SELECT draft_content FROM agent_execution_logs WHERE task_id = ? AND status = ? ORDER BY timestamp').bind(taskId, status).all();
  return (results ?? []).map((r) => (r.draft_content ? JSON.parse(r.draft_content) : null)).filter(Boolean);
}

export function guardrails(brand) {
  const sections = brand?.sections ?? [];
  const fmt = (s) => `## ${s.heading}\n${s.text}`;
  const picked = sections.filter((s) => BRAND_KEYWORDS.test(s.heading)).map(fmt).join('\n\n');
  return (picked || sections.map(fmt).join('\n\n')).slice(0, BRAND_CHAR_CAP);
}

/** Topic for one platform from schedule:<date>; platforms without a schedule borrow the X/pillar topic. */
export function topicFor(schedule, platform) {
  const items = schedule?.items ?? {};
  const first = (k) => items[k]?.[0]?.text;
  return first(platform) ?? first('x') ?? first('pillar') ?? first('blog') ?? null;
}

/** The queue message's topic (from mpt-brand-topics) wins; otherwise the per-platform schedule topic. */
export const resolveTopic = (hint, schedule, platform) => (typeof hint?.topic === 'string' && hint.topic.trim() ? hint.topic.trim() : topicFor(schedule, platform));

export function buildPrompt(platform, topic, date, guardrailText, hint = {}) {
  return {
    system: [
      'You are the social copywriter for MyPrivacyTOOL. Follow these brand guardrails exactly. Tone: Empowering Detective: confident, clear, helpful, never alarmist. No fabricated statistics, no personal data.',
      '',
      guardrailText || '(no guardrails cached)',
      '',
      'Reply with a single JSON object and nothing else.',
    ].join('\n'),
    user: [
      `Platform: ${PLATFORM_NAMES[platform]}`,
      `Date (HKT): ${date}`,
      `Today's topic: ${topic}`,
      ...(hint.pillar ? [`Content pillar: ${hint.pillar}`] : []),
      ...(hint.format_type ? [`Format: ${hint.format_type}`] : []),
      `Rules: ${PLATFORM_RULES[platform]}`,
      `End with the CTA "${CTA}" linking to https://myprivacytool.io?utm_source=${platform}&utm_medium=social&utm_campaign=${CAMPAIGN}&utm_content=${date}`,
      'Return JSON: {"copy": string' + (TITLED.includes(platform) ? ', "title": string' : '') + (platform === 'youtube' ? ', "script": string' : '') + (platform === 'instagram' ? ', "slides": string[]' : '') + '}',
    ].join('\n'),
  };
}

export function parseDraft(platform, text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`${platform}: LLM reply contained no JSON object`);
  const d = JSON.parse(text.slice(start, end + 1));
  if (typeof d.copy !== 'string' || !d.copy.trim()) throw new Error(`${platform}: empty copy`);
  if (platform === 'x' && d.copy.split(/\n\s*---\s*\n/).some((t) => t.trim().length > 280)) throw new Error('x: a post exceeds 280 characters');
  if (platform === 'linkedin' && d.copy.length > 3000) throw new Error('linkedin: over 3000 characters');
  if (platform === 'instagram' && d.copy.length > 2200) throw new Error('instagram: over 2200 characters');
  if (platform === 'facebook' && d.copy.length > 500) throw new Error('facebook: over 500 characters');
  if (platform === 'pinterest' && d.copy.length > 500) throw new Error('pinterest: over 500 characters');
  if (platform === 'youtube' && d.copy.length > 5000) throw new Error('youtube: over 5000 characters');
  if (TITLED.includes(platform) && (typeof d.title !== 'string' || !d.title.trim())) throw new Error(`${platform}: missing title`);
  if (TITLED.includes(platform) && d.title.length > 100) throw new Error(`${platform}: title over 100 characters`);
  if (platform === 'youtube' && (typeof d.script !== 'string' || !d.script.trim())) throw new Error('youtube: missing script');
  return { platform, ...d, cta: CTA };
}

async function callLlm(env, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.LLM_MODEL, max_tokens: 2000, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function slackBlocks(taskId, topic, drafts) {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const body = (d) => (d.title ? `*${d.title}*\n${d.copy}` : d.copy);
  const button = (text, action_id, style) => ({ type: 'button', text: { type: 'plain_text', text }, action_id, value: taskId, ...(style ? { style } : {}) });
  return [
    { type: 'header', text: { type: 'plain_text', text: `MPT daily drafts: ${taskId.replace('daily-posts-', '')}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Topic:* ${topic}` } },
    ...drafts.flatMap((d) => [
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*${PLATFORM_NAMES[d.platform]}*\n${clip(body(d), 2600)}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `${PLATFORM_DESTINATIONS[d.platform].note} · <${PLATFORM_DESTINATIONS[d.platform].url}|${PLATFORM_DESTINATIONS[d.platform].label}>` }] },
    ]),
    { type: 'actions', block_id: 'approval', elements: [button('Approve All', 'approve_all', 'primary'), button('Reject', 'reject', 'danger'), button('Edit & Resubmit', 'edit_resubmit')] },
  ];
}

async function postSlack(env, topic, taskId, drafts) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: env.SLACK_CHANNEL, text: `MPT daily drafts ready for approval (${taskId})`, blocks: slackBlocks(taskId, topic, drafts), unfurl_links: false }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`Slack post failed: ${body.error ?? res.status}`);
  return { channel: body.channel, ts: body.ts };
}

export async function generateDailyPosts(env, date, hint = {}) {
  const taskId = taskIdFor(date);
  if ((await rows(env, taskId, 'notified')).length) return 'skipped'; // retry / duplicate delivery

  const [schedule, brand] = await Promise.all([
    env.CONTENT_CACHE.get(`schedule:${date}`, 'json'),
    env.CONTENT_CACHE.get('brand:guidelines', 'json'),
  ]);
  if (!schedule && !hint?.topic) throw new Error(`no topic in the queue message and no schedule:${date} in mpt-content-cache (run the KV sync)`);
  const guard = guardrails(brand);

  const have = new Map((await rows(env, taskId, 'drafted')).map((d) => [d.platform, d]));
  const missing = PLATFORMS.filter((p) => !have.has(p));
  if (missing.length) await log(env, taskId, 'running');

  // 6 concurrent calls; each draft is saved as soon as it succeeds so a retry only redoes the failed platforms.
  const results = await Promise.allSettled(missing.map(async (platform) => {
    const topic = resolveTopic(hint, schedule, platform);
    if (!topic) throw new Error(`${platform}: no topic for ${date}`);
    try {
      const draft = { ...parseDraft(platform, await callLlm(env, buildPrompt(platform, topic, date, guard, hint))), topic, ...(Array.isArray(hint?.asset_tags) && hint.asset_tags.length ? { asset_tags: hint.asset_tags } : {}) };
      await log(env, taskId, 'drafted', { draft });
      have.set(platform, draft);
    } catch (e) {
      throw new Error(`${platform}: ${e.message.replace(new RegExp(`^${platform}: `), '')}`);
    }
  }));
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  if (failed.length) throw new Error(failed.join('; '));

  const drafts = PLATFORMS.map((p) => have.get(p));
  const slack = await postSlack(env, resolveTopic(hint, schedule, 'x') ?? drafts[0].topic, taskId, drafts);
  await log(env, taskId, 'notified', { draft: slack });
  return 'notified';
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const { date, action, topic, pillar, format_type, asset_tags } = msg.body ?? {};
      if (action !== 'generate_daily_posts' || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.error('bad message', JSON.stringify(msg.body)); msg.ack(); continue; }
      try {
        await generateDailyPosts(env, date, { topic, pillar, format_type, asset_tags });
        msg.ack();
      } catch (e) {
        await log(env, taskIdFor(date), 'failed', { error: `attempt ${msg.attempts}: ${e?.message}` }).catch(() => {});
        msg.retry({ delaySeconds: 60 * msg.attempts });
      }
    }
  },
  async fetch() {
    return Response.json({ ok: true, worker: 'mpt-content-consumer' });
  },
};
