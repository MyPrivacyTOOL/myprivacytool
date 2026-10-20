// mpt-content-producer: cron -> Queue only. All slow work (KV read, LLM call, Slack) happens in mpt-content-consumer.
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function hktDate(now = new Date()) {
  return new Date(now.getTime() + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildMessage(now = new Date()) {
  return { date: hktDate(now), action: 'generate_daily_posts' };
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
  const msg = buildMessage(now);
  const taskId = `daily-posts-${msg.date}`;
  try {
    await env.CONTENT_QUEUE.send(msg, { contentType: 'json' });
  } catch (e) {
    await log(env, taskId, 'failed', `enqueue failed: ${e?.message}`);
    throw e;
  }
  await log(env, taskId, 'queued');
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
