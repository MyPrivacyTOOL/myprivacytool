// MPC-7383: Monday digest Worker. Cron fires Monday 01:00 UTC = 09:00 Hong Kong.
// Reads the latest two rows of the MPT weekly tracker (written by MPC-7382) and posts <=5 lines to Slack.
// Secrets (EXPECTED_SECRETS.txt): NOTION_TOKEN, SLACK_BOT_TOKEN. Var: SLACK_CHANNEL_ID, TRACKER_DATA_SOURCE_ID.
import { buildDigest } from './digest.js';

const NOTION_VERSION = '2025-09-03';

const numProp = (p) => {
  if (!p) return null;
  if (p.type === 'number') return p.number;
  if (p.type === 'formula') return p.formula?.type === 'number' ? p.formula.number : null;
  return null;
};
const textProp = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('').trim();

/** Map a Notion page to the digest row shape. Blank stays null; nothing is estimated. */
export function rowFromPage(page) {
  const pr = page.properties || {};
  const insights = textProp(pr['Agent Insights']);
  const grab = (label) => {
    const m = insights.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  return {
    weekOf: pr['Week Of']?.date?.start || null,
    cumulativeScans: numProp(pr['Cumulative Scans']),
    targetScans: numProp(pr['Target Cumulative Scans']),
    paceGapPct: numProp(pr['Pace Gap %']),
    paceStatus: pr['Pace Status']?.select?.name || null,
    ga4ActiveUsers: numProp(pr['GA4 Active Users']),
    currentMrr: numProp(pr['Current MRR']),
    conversionRate: numProp(pr['Conversion Rate %']),
    blogPosts: numProp(pr['Blog Posts Published']),
    xThreads: numProp(pr['X Threads Posted']),
    agentPlan: grab('Plan'),
    decisions: grab('Decision'),
    failedSources: (grab('Failed sources') || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

async function notionQuery(env, fetchImpl) {
  const res = await fetchImpl(`https://api.notion.com/v1/data_sources/${env.TRACKER_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 2, sorts: [{ property: 'Week Of', direction: 'descending' }] }),
  });
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`);
  return (await res.json()).results || [];
}

async function slackPost(env, text, fetchImpl) {
  const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, text }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack post failed: ${body.error || res.status}`);
  return body; // { ts, channel } -> permalink recorded by the caller
}

export async function runDigest(env, fetchImpl = fetch) {
  let text;
  try {
    const [cur, prev] = (await notionQuery(env, fetchImpl)).map(rowFromPage);
    const week = cur?.weekOf || 'unknown';
    ({ text } = buildDigest({ weekOf: week, current: cur || null, previous: prev || null, failedSources: cur?.failedSources || [] }));
  } catch (err) {
    // Never show an estimate: if the tracker cannot be read, say so.
    text = `MPT weekly digest could not be built: ${err.message}. No figures shown.`;
  }
  return slackPost(env, text, fetchImpl);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDigest(env));
  },
};
