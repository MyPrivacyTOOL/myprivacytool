// Monday Slack digest (MPC-7383): reads the latest two weekly tracker rows from Notion, names any source whose latest
// pull failed, and posts at most five lines to Chris. Blank stays blank; nothing is estimated. Counts and summaries only.
import { buildDigest, summariseAgentTasks } from '../lib/digest.js';
import { notion, NOTION_VERSION, DEFAULT_WEEKLY_DS } from './notion.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { recipientCtx } from '../lib/recipient-ctx.js';

export { NOTION_VERSION };
// 01:00 UTC Monday = 09:00 Hong Kong (UTC+8, no DST). Cloudflare numbers the day of week 1-7 with 1 = SUNDAY
// (not 0-6 with 1 = Monday), so Monday is 2. '0 1 * * 1' fired on Sunday 09:00 HKT, a day early (seen 2026-11-01).
// wrangler.toml must carry this exact string: the worker matches event.cron against it.
export const DIGEST_CRON = '0 1 * * 2';
export const digestConfigured = (env) => Boolean(env.NOTION_TOKEN && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SLACK_BOT_TOKEN && env.MPTSLACK_CHANNEL_ID);

const numProp = (p) => {
  if (!p) return null;
  if (p.type === 'number' || 'number' in p) return typeof p.number === 'number' ? p.number : null;
  if (p.type === 'formula' || p.formula) return typeof p.formula?.number === 'number' ? p.formula.number : null;
  return null;
};
const textProp = (p) => (p?.rich_text || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();

/** Map a Notion tracker page to the digest row shape. Blank -> null. Conversion Rate % is stored as a fraction. */
export function rowFromPage(page) {
  const pr = page.properties || {};
  const insights = textProp(pr['Agent Insights']);
  const grab = (label) => { const m = insights.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi')); return m ? m[1].trim() : null; };
  const conv = numProp(pr['Conversion Rate %']);
  return {
    weekOf: pr['Week Of']?.date?.start || null,
    cumulativeScans: numProp(pr['Cumulative Scans']),
    targetScans: numProp(pr['Target Cumulative Scans']),
    paceGapPct: numProp(pr['Pace Gap %']),
    paceStatus: pr['Pace Status']?.select?.name || null,
    ga4ActiveUsers: numProp(pr['GA4 Active Users']),
    currentMrr: numProp(pr['Current MRR']),
    conversionRate: conv === null ? null : conv * 100,
    blogPosts: numProp(pr['Blog Posts Published']),
    xThreads: numProp(pr['X Threads Posted']),
    agentPlan: grab('Plan'),
    decisions: grab('Decision'),
  };
}

const DEFAULT_TASKS_DS = '2dd28547-eaa7-8154-8a16-000ba5543325'; // Tasks Fleet Master - Database
const AGENT_NAME = 'MyPrivacyToolClaw';

/** MPC-7654: counts for the MPT agent's tasks (Assigned Actor = MyPrivacyToolClaw, not archived). Counts only. */
export async function agentStats(env) {
  const ds = env.NOTION_TASKS_DATA_SOURCE_ID || DEFAULT_TASKS_DS;
  const rows = [];
  let cursor;
  do {
    const res = await notion(env, 'POST', `/data_sources/${ds}/query`, {
      filter: { property: 'Assigned Actor', multi_select: { contains: AGENT_NAME } },
      page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const pg of res.results) {
      const pr = pg.properties || {};
      if (pr.Archived?.checkbox) continue;
      rows.push({
        status: pr.Status?.status?.name || pr.Status?.select?.name || null,
        amended: textProp(pr.Amendments) !== '',
        blocked: textProp(pr.Blocker_Reason) !== '',
        approval: pr.Approval_Status?.select?.name || pr.Approval_Status?.status?.name || null,
        minutesSaved: numProp(pr.Minutes_Saved_Chris), errorsCaught: numProp(pr.Errors_Caught), revenueGbp: numProp(pr.Revenue_Impact_GBP),
        override: pr.Override_Outcome?.select?.name || null,
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return summariseAgentTasks(rows);
}

/** Sources whose latest pull in the last 48h has status=error (latest per source+report). */
export async function failedSources(env, now = new Date()) {
  const since = new Date(now.getTime() - 48 * 3600000).toISOString();
  const res = await callRecipient('supabase', { url: `${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?captured_at=gte.${since}&order=captured_at.desc&select=source,report,status`, init: {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }, sent: [] }, recipientCtx(env));
  if (!res.ok) throw new Error(`supabase read mpt_raw_metrics failed: HTTP ${res.status}`);
  const latest = new Map();
  for (const r of await res.json()) { const k = `${r.source}/${r.report}`; if (!latest.has(k)) latest.set(k, r); }
  return [...new Set([...latest.values()].filter((r) => r.status === 'error').map((r) => r.source))].sort();
}

export async function slack(env, method, params) {
  const res = await callRecipient('slack', { url: `https://slack.com/api/${method}`, init: {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params),
  }, sent: [] }, recipientCtx(env));
  const body = await res.json();
  if (!body.ok) throw new Error(`slack ${method} failed: ${body.error || res.status}`);
  return body;
}

/** Build the digest text. On any read failure the text says so and shows no figures. */
export async function buildDigestText(env, now = new Date()) {
  try {
    const ds = env.NOTION_WEEKLY_DATA_SOURCE_ID || DEFAULT_WEEKLY_DS;
    const rows = (await notion(env, 'POST', `/data_sources/${ds}/query`, {
      filter: { property: 'Week Of', date: { is_not_empty: true } },
      sorts: [{ property: 'Week Of', direction: 'descending' }],
      page_size: 2,
    })).results.map(rowFromPage);
    const [cur, prev] = rows;
    let failed;
    try { failed = await failedSources(env, now); } catch { failed = ['source-status (could not be read)']; }
    let stats;
    try { stats = await agentStats(env); } catch { stats = null; }
    return buildDigest({ weekOf: cur?.weekOf || 'unknown', current: cur || null, previous: prev || null, failedSources: failed, agentStats: stats }).text;
  } catch (e) {
    return `MPT weekly digest could not be built: ${String(e?.message ?? e).split(env.NOTION_TOKEN).join('[redacted]').slice(0, 200)}. No figures shown.`;
  }
}

/** Post the digest to Slack; returns { ts, channel, permalink }. */
export async function postDigest(env, now = new Date()) {
  const text = await buildDigestText(env, now);
  const posted = await slack(env, 'chat.postMessage', { channel: env.MPTSLACK_CHANNEL_ID, text });
  let permalink = null;
  try { permalink = (await slack(env, 'chat.getPermalink', { channel: posted.channel, message_ts: posted.ts })).permalink; } catch { /* permalink is best effort */ }
  return { ts: posted.ts, channel: posted.channel, permalink };
}
