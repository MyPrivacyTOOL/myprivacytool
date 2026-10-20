// mpt-content-producer: cron -> reads today's topic from KV mpt-brand-topics (key = HKT date, written by scripts/sync-workstream-3-to-kv.mjs)
// -> Queue. All slow work (LLM calls, Slack) happens in mpt-content-consumer.
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function hktDate(now = new Date()) {
  return new Date(now.getTime() + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildMessage(now = new Date(), topic = null) {
  const msg = { date: hktDate(now), action: 'generate_daily_posts' };
  if (topic?.topic) {
    msg.topic = topic.topic;
    for (const k of ['pillar', 'format_type', 'asset_tags']) if (topic[k] !== undefined) msg[k] = topic[k];
  }
  return msg;
}

/** Today's topic record, or null when the sync has not written one (the consumer then falls back to schedule:<date>). */
async function readTopic(env, date) {
  try {
    return await env.BRAND_TOPICS.get(date, 'json');
  } catch (e) {
    console.error('topic read failed', e?.message);
    return null;
  }
}

async function log(env, taskId, status, error) {
  try {
    await env.AGENT_LOGS.prepare('INSERT INTO agent_execution_logs (id, timestamp, task_id, status, error_message) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), new Date().toISOString(), taskId, status, error ?? null).run();
  } catch (e) {
    console.error('log failed', e?.message);
  }
}

export async function enqueue(env, now = new Date()) {
  const taskId = `daily-posts-${hktDate(now)}`;
  const msg = buildMessage(now, await readTopic(env, hktDate(now)));
  try {
    await env.CONTENT_QUEUE.send(msg, { contentType: 'json' });
  } catch (e) {
    await log(env, taskId, 'failed', `enqueue failed: ${e?.message}`);
    throw e;
  }
  await log(env, taskId, 'queued', msg.topic ? undefined : 'no topic in mpt-brand-topics; consumer will use the schedule fallback');
  return msg;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(enqueue(env, new Date(event.scheduledTime)));
  },
  // Health only; no manual trigger so nothing public can burn queue/LLM quota.
  async fetch() {
    return Response.json({ ok: true, worker: 'mpt-content-producer' });
  },
};
