// @vitest-environment node
// MPC-8370: unit + integration tests for mpt-content-producer (KV / D1 / Queue stubbed; no network).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import producer, { hktDate, buildMessage, enqueue, topicRecord } from './worker.js';

const CRON = Date.parse('2026-10-19T22:00:00Z'); // 06:00 HKT on 2026-10-20

const makeEnv = ({ topic = { topic: 'Your exposure score', pillar: 'awareness', format_type: 'thread', asset_tags: ['score'] }, topicError, sendError, logError } = {}) => {
  const logs = [];
  const sent = [];
  const gets = [];
  return {
    logs, sent, gets,
    BRAND_TOPICS: { get: async (k, type) => { gets.push([k, type]); if (topicError) throw new Error(topicError); return topic; } },
    CONTENT_QUEUE: { send: async (m, o) => { if (sendError) throw new Error(sendError); sent.push([m, o]); } },
    AGENT_LOGS: {
      prepare: () => ({
        bind: (...a) => ({
          run: async () => { if (logError) throw new Error(logError); logs.push({ id: a[0], timestamp: a[1], task_id: a[2], status: a[3], error_message: a[4] }); },
        }),
      }),
    },
  };
};

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('hktDate', () => {
  it('22:00 UTC is the next calendar day in HKT', () => expect(hktDate(new Date(CRON))).toBe('2026-10-20'));
  it('defaults to now', () => expect(hktDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});

describe('buildMessage', () => {
  it('has only date + action without a topic', () => expect(buildMessage(new Date(CRON))).toEqual({ date: '2026-10-20', action: 'generate_daily_posts' }));
  it('defaults now and ignores a record with no topic text', () => expect(buildMessage(undefined, { pillar: 'x' })).not.toHaveProperty('topic'));
  it('carries topic, pillar, format and tags', () => {
    expect(buildMessage(new Date(CRON), { topic: 'T', pillar: 'p', format_type: 'f', asset_tags: ['a'], notionPageId: 'ignored' }))
      .toEqual({ date: '2026-10-20', action: 'generate_daily_posts', topic: 'T', pillar: 'p', format_type: 'f', asset_tags: ['a'] });
  });
  it('omits optional fields that are absent', () => expect(buildMessage(new Date(CRON), { topic: 'T' })).toEqual({ date: '2026-10-20', action: 'generate_daily_posts', topic: 'T' }));
});

describe('topicRecord', () => {
  it('derives the topic from the sync shape: x, then pillar, then blog', () => {
    expect(topicRecord({ date: 'd', items: { x: [{ text: 'X topic' }], pillar: [{ text: 'P' }] } }).topic).toBe('X topic');
    expect(topicRecord({ items: { pillar: [{ text: ' P ' }], blog: [{ text: 'B' }] } }).topic).toBe('P');
    expect(topicRecord({ items: { blog: [{ text: 'B' }] } }).topic).toBe('B');
  });
  it('keeps a record that already has a topic', () => expect(topicRecord({ topic: 'T', pillar: 'p' })).toEqual({ topic: 'T', pillar: 'p' }));
  it('returns null for nothing usable', () => {
    for (const r of [null, undefined, 'str', {}, { items: {} }, { items: { reddit: [{ text: 'R' }] } }]) expect(topicRecord(r)).toBeNull();
  });
});

describe('enqueue', () => {
  it('reads the topic:<HKT date> key as JSON from mpt-brand-topics and enqueues the payload as JSON', async () => {
    const env = makeEnv();
    const msg = await enqueue(env, new Date(CRON));
    expect(env.gets).toEqual([['topic:2026-10-20', 'json']]);
    expect(env.sent).toEqual([[msg, { contentType: 'json' }]]);
    expect(msg).toMatchObject({ date: '2026-10-20', action: 'generate_daily_posts', topic: 'Your exposure score', pillar: 'awareness', asset_tags: ['score'] });
    expect(env.logs).toHaveLength(1);
    expect(env.logs[0]).toMatchObject({ task_id: 'daily-posts-2026-10-20', status: 'queued', error_message: null });
    expect(env.logs[0].id).toHaveLength(36);
  });

  it('enqueues a topic derived from a record written by sync-workstream-3-to-kv', async () => {
    const env = makeEnv({ topic: { date: '2026-10-20', items: { x: [{ text: 'Thread: exposure', qualifier: null }] } } });
    expect((await enqueue(env, new Date(CRON))).topic).toBe('Thread: exposure');
  });

  it('still enqueues (and notes it) when there is no topic yet', async () => {
    const env = makeEnv({ topic: null });
    const msg = await enqueue(env, new Date(CRON));
    expect(msg).not.toHaveProperty('topic');
    expect(env.sent).toHaveLength(1);
    expect(env.logs[0].error_message).toMatch(/no topic/);
  });

  it('falls back to no topic when the KV read throws', async () => {
    const env = makeEnv({ topicError: 'kv down' });
    const msg = await enqueue(env, new Date(CRON));
    expect(msg.topic).toBeUndefined();
    expect(env.sent).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('topic read failed', 'kv down');
  });

  it('logs a failure and rethrows when the queue send fails', async () => {
    const env = makeEnv({ sendError: 'queue full' });
    await expect(enqueue(env, new Date(CRON))).rejects.toThrow('queue full');
    expect(env.logs).toHaveLength(1);
    expect(env.logs[0]).toMatchObject({ status: 'failed', error_message: 'enqueue failed: queue full' });
  });

  it('a failing D1 log never breaks the enqueue', async () => {
    const env = makeEnv({ logError: 'd1 down' });
    await expect(enqueue(env, new Date(CRON))).resolves.toMatchObject({ date: '2026-10-20' });
    expect(console.error).toHaveBeenCalledWith('log failed', 'd1 down');
  });

  it('uses the current time by default', async () => {
    const env = makeEnv();
    expect((await enqueue(env)).date).toBe(hktDate());
  });
});

describe('default export', () => {
  it('scheduled() enqueues via waitUntil using the cron time', async () => {
    const env = makeEnv();
    const pending = [];
    await producer.scheduled({ scheduledTime: CRON }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    expect(env.sent[0][0].date).toBe('2026-10-20');
    expect(env.logs[0].status).toBe('queued');
  });

  it('fetch() is health-only', async () => {
    const res = await producer.fetch();
    expect(await res.json()).toEqual({ ok: true, worker: 'mpt-content-producer' });
  });
});
