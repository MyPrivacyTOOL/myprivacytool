// mpt-content-consumer: handles { date, action: "generate_daily_posts" } messages from mpt-content-generation-queue.
//   1. read today's topic + brand guardrails from KV mpt-content-cache
//   2. four CONCURRENT Anthropic calls (X, LinkedIn, Instagram, Reddit)
//   3. save the 4 drafts to D1 agent_execution_logs (one row per platform)
//   4. post to Slack #mpt-content-approval with Approve All / Reject / Edit & Resubmit buttons (handled by mpt-content-approval)

export const PLATFORMS = ['x', 'linkedin', 'instagram', 'reddit'];
const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', reddit: 'Reddit' };
const PLATFORM_RULES = {
  x: 'A thread of 3-5 posts. Each post at most 280 characters. Separate posts with a line containing only ---.',
  linkedin: 'Professional thought-leadership post, 2-3 short paragraphs, at most 3000 characters.',
  instagram: 'Caption of at most 2200 characters, 3-5 sentences, light emoji, 5-8 hashtags. Start with a 9-slide carousel outline in "slides" (one short line per slide).',
  reddit: 'Value-first post for r/privacy or r/cybersecurity. Genuinely useful, no sales pitch; mention MyPrivacyTOOL only if directly relevant. Needs a "title" (max 300 chars) and a body.',
};
const BRAND_KEYWORDS = /voice|tone|messag|language|social|do'?s|don'?t|never|always|guardrail/i;
const BRAND_CHAR_CAP = 6000;
const CTA = 'Check your exposure';

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

/** Topic for one platform from schedule:<date>; Instagram has no schedule so it borrows the X/pillar topic. */
export function topicFor(schedule, platform) {
  const items = schedule?.items ?? {};
  const first = (k) => items[k]?.[0]?.text;
  return first(platform) ?? first('x') ?? first('pillar') ?? first('blog') ?? null;
}

export function buildPrompt(platform, topic, date, guardrailText) {
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
      `Rules: ${PLATFORM_RULES[platform]}`,
      `End with the CTA "${CTA}" linking to https://myprivacytool.io?utm_source=${platform}&utm_medium=social&utm_campaign=oct-sprint`,
      'Return JSON: {"copy": string' + (platform === 'reddit' ? ', "title": string, "subreddit": string' : '') + (platform === 'instagram' ? ', "slides": string[]' : '') + '}',
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
  if (platform === 'reddit' && (typeof d.title !== 'string' || !d.title.trim())) throw new Error('reddit: missing title');
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
  const body = (d) => (d.platform === 'reddit' ? `*${d.title}*\n${d.copy}` : d.copy);
  const button = (text, action_id, style) => ({ type: 'button', text: { type: 'plain_text', text }, action_id, value: taskId, ...(style ? { style } : {}) });
  return [
    { type: 'header', text: { type: 'plain_text', text: `MPT daily drafts: ${taskId.replace('daily-posts-', '')}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Topic:* ${topic}` } },
    ...drafts.flatMap((d) => [
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*${PLATFORM_NAMES[d.platform]}*\n${clip(body(d), 2600)}` } },
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

export async function generateDailyPosts(env, date) {
  const taskId = taskIdFor(date);
  if ((await rows(env, taskId, 'notified')).length) return 'skipped'; // retry / duplicate delivery

  const [schedule, brand] = await Promise.all([
    env.CONTENT_CACHE.get(`schedule:${date}`, 'json'),
    env.CONTENT_CACHE.get('brand:guidelines', 'json'),
  ]);
  if (!schedule) throw new Error(`no schedule:${date} in mpt-content-cache (run the KV sync)`);
  const guard = guardrails(brand);

  const have = new Map((await rows(env, taskId, 'drafted')).map((d) => [d.platform, d]));
  const missing = PLATFORMS.filter((p) => !have.has(p));
  if (missing.length) await log(env, taskId, 'running');

  // 4 concurrent calls; each draft is saved as soon as it succeeds so a retry only redoes the failed platforms.
  const results = await Promise.allSettled(missing.map(async (platform) => {
    const topic = topicFor(schedule, platform);
    if (!topic) throw new Error(`${platform}: no topic for ${date}`);
    try {
      const draft = { ...parseDraft(platform, await callLlm(env, buildPrompt(platform, topic, date, guard))), topic };
      await log(env, taskId, 'drafted', { draft });
      have.set(platform, draft);
    } catch (e) {
      throw new Error(`${platform}: ${e.message.replace(new RegExp(`^${platform}: `), '')}`);
    }
  }));
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  if (failed.length) throw new Error(failed.join('; '));

  const drafts = PLATFORMS.map((p) => have.get(p));
  const slack = await postSlack(env, topicFor(schedule, 'x') ?? drafts[0].topic, taskId, drafts);
  await log(env, taskId, 'notified', { draft: slack });
  return 'notified';
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const { date, action } = msg.body ?? {};
      if (action !== 'generate_daily_posts' || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.error('bad message', JSON.stringify(msg.body)); msg.ack(); continue; }
      try {
        await generateDailyPosts(env, date);
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
