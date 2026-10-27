// @vitest-environment node
// MPC-8370: unit + integration tests for mpt-content-consumer. Anthropic, Slack, KV and D1 are all mocked; no network, no secrets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import consumer, { PLATFORMS, taskIdFor, guardrails, topicFor, resolveTopic, buildPrompt, parseDraft, slackBlocks, generateDailyPosts } from './worker.js';

const DATE = '2026-10-20';
const TASK = taskIdFor(DATE);
const schedule = { date: DATE, items: { x: [{ text: 'Thread: exposure', qualifier: null }] } };
const brand = { sections: [{ heading: 'Voice & tone', text: 'Empowering Detective' }, { heading: 'Logo', text: 'big' }] };

const goodFor = (platform) => ({
  x: { copy: 'one\n---\ntwo' },
  linkedin: { copy: 'pro post' },
  instagram: { copy: 'cap', slides: ['s1', 's2'] },
  facebook: { copy: 'fb post' },
  pinterest: { title: 'Pin title', copy: 'pin desc' },
  youtube: { title: 'Video title', copy: 'video desc', script: 'spoken script' },
})[platform];

/** Stateful D1 stub: INSERT into agent_execution_logs, SELECT by (task_id, status). */
const makeDb = ({ failInsertFor } = {}) => {
  const logs = [];
  return {
    logs,
    prepare(sql) {
      return {
        bind: (...a) => ({
          run: async () => {
            const cols = sql.match(/\(([^)]*)\) VALUES/)[1].split(',').map((s) => s.trim());
            const row = Object.fromEntries(cols.map((c, i) => [c, a[i] ?? null]));
            if (failInsertFor && row.status === failInsertFor) throw new Error('d1 insert failed');
            logs.push(row);
          },
          all: async () => ({ results: logs.filter((r) => r.task_id === a[0] && r.status === a[1]) }),
        }),
      };
    },
  };
};

const makeEnv = (over = {}) => ({
  AGENT_LOGS: makeDb(),
  CONTENT_CACHE: { get: vi.fn(async (k) => (k === `schedule:${DATE}` ? schedule : k === 'brand:guidelines' ? brand : null)) },
  ANTHROPIC_API_KEY: 'sk-test', SLACK_BOT_TOKEN: 'xoxb-test', SLACK_CHANNEL: '#mpt-content-approval', LLM_MODEL: 'test-model',
  ...over,
});

let anthropicCalls; let slackPosts; let inflight; let maxInflight; let llm; let slack;
const platformOf = (init) => /Platform: (\w+)/.exec(JSON.parse(init.body).messages[0].content)[1].toLowerCase();

beforeEach(() => {
  anthropicCalls = []; slackPosts = []; inflight = 0; maxInflight = 0;
  llm = (platform) => Response.json({ content: [{ type: 'text', text: JSON.stringify(goodFor(platform)) }] });
  slack = () => Response.json({ ok: true, channel: 'C99', ts: '1.1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url, init) => {
    const u = String(url);
    if (u === 'https://api.anthropic.com/v1/messages') {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      anthropicCalls.push({ headers: init.headers, body: JSON.parse(init.body) });
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return llm(platformOf(init));
    }
    if (u === 'https://slack.com/api/chat.postMessage') { slackPosts.push({ headers: init.headers, body: JSON.parse(init.body) }); return slack(); }
    throw new Error(`unexpected fetch ${u}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const statuses = (env, s) => env.AGENT_LOGS.logs.filter((r) => r.status === s);

describe('helpers', () => {
  it('PLATFORMS is the six required platforms', () => expect(PLATFORMS).toEqual(['x', 'linkedin', 'instagram', 'facebook', 'pinterest', 'youtube']));
  it('guardrails prefers voice/tone sections', () => expect(guardrails(brand)).toBe('## Voice & tone\nEmpowering Detective'));
  it('guardrails falls back to all sections, then empty', () => {
    expect(guardrails({ sections: [{ heading: 'Logo', text: 'big' }] })).toBe('## Logo\nbig');
    expect(guardrails(null)).toBe('');
  });
  it('guardrails caps length', () => expect(guardrails({ sections: [{ heading: 'Voice', text: 'a'.repeat(9000) }] }).length).toBe(6000));
  it('topicFor walks platform -> x -> pillar -> blog -> null', () => {
    expect(topicFor({ items: { youtube: [{ text: 'Y' }], x: [{ text: 'X' }] } }, 'youtube')).toBe('Y');
    expect(topicFor(schedule, 'facebook')).toBe('Thread: exposure');
    expect(topicFor({ items: { pillar: [{ text: 'P' }] } }, 'x')).toBe('P');
    expect(topicFor({ items: { blog: [{ text: 'B' }] } }, 'x')).toBe('B');
    expect(topicFor(null, 'x')).toBeNull();
  });
  it('resolveTopic prefers the queue message topic, trimmed', () => {
    expect(resolveTopic({ topic: '  From KV ' }, schedule, 'x')).toBe('From KV');
    expect(resolveTopic({ topic: '   ' }, schedule, 'x')).toBe('Thread: exposure');
    expect(resolveTopic(undefined, schedule, 'x')).toBe('Thread: exposure');
    expect(resolveTopic({ topic: 42 }, null, 'x')).toBeNull();
  });
});

describe('buildPrompt', () => {
  it.each(PLATFORMS)('%s: guardrails in system, platform + topic + CTA in user', (p) => {
    const pr = buildPrompt(p, 'T', DATE, 'GUARD');
    expect(pr.system).toContain('GUARD');
    expect(pr.system).toContain('Empowering Detective');
    expect(pr.user).toContain(`utm_source=${p}`);
    expect(pr.user).toContain(`utm_source=${p}&utm_medium=social&utm_campaign=mpc-7033-daily&utm_content=${DATE}`);
    expect(pr.user).not.toContain('oct-sprint');
    expect(pr.user).toContain("Today's topic: T");
    expect(pr.user).toContain('Check your exposure');
  });
  it('asks for the right JSON shape per platform', () => {
    expect(buildPrompt('youtube', 'T', DATE, '').user).toContain('"title": string, "script": string');
    expect(buildPrompt('pinterest', 'T', DATE, '').user).toContain('"title": string');
    expect(buildPrompt('instagram', 'T', DATE, '').user).toContain('"slides": string[]');
    expect(buildPrompt('x', 'T', DATE, '').user).toMatch(/Return JSON: \{"copy": string\}/);
  });
  it('includes pillar/format hints and a placeholder when no guardrails are cached', () => {
    const pr = buildPrompt('x', 'T', DATE, '', { pillar: 'awareness', format_type: 'thread' });
    expect(pr.user).toContain('Content pillar: awareness');
    expect(pr.user).toContain('Format: thread');
    expect(pr.system).toContain('(no guardrails cached)');
  });
});

describe('parseDraft', () => {
  const j = (o) => JSON.stringify(o);
  it('accepts a valid draft for every platform and adds the CTA', () => {
    for (const p of PLATFORMS) expect(parseDraft(p, j(goodFor(p)))).toMatchObject({ platform: p, cta: 'Check your exposure' });
  });
  it('tolerates prose around the JSON', () => expect(parseDraft('x', `sure!\n${j({ copy: 'hi' })}\nbye`).copy).toBe('hi'));
  it.each([
    ['x', 'no json here', /no JSON object/],
    ['x', j({ copy: '  ' }), /empty copy/],
    ['x', j({ copy: 5 }), /empty copy/],
    ['x', j({ copy: 'a'.repeat(281) }), /280/],
    ['linkedin', j({ copy: 'a'.repeat(3001) }), /3000/],
    ['instagram', j({ copy: 'a'.repeat(2201) }), /2200/],
    ['facebook', j({ copy: 'a'.repeat(501) }), /500/],
    ['pinterest', j({ copy: 'a'.repeat(501), title: 't' }), /500/],
    ['pinterest', j({ copy: 'ok' }), /missing title/],
    ['pinterest', j({ copy: 'ok', title: ' ' }), /missing title/],
    ['pinterest', j({ copy: 'ok', title: 't'.repeat(101) }), /title over 100/],
    ['youtube', j({ copy: 'a'.repeat(5001), title: 't', script: 's' }), /5000/],
    ['youtube', j({ copy: 'ok', title: 't' }), /missing script/],
    ['youtube', j({ copy: 'ok', title: 't', script: ' ' }), /missing script/],
  ])('%s rejects %#', (p, text, re) => expect(() => parseDraft(p, text)).toThrow(re));
});

describe('slackBlocks', () => {
  const drafts = PLATFORMS.map((p) => ({ platform: p, ...goodFor(p) }));
  const blocks = slackBlocks(TASK, 'Topic', drafts);
  it('has header, topic, one section per platform and the three buttons', () => {
    expect(blocks[0].text.text).toBe(`MPT daily drafts: ${DATE}`);
    expect(blocks[1].text.text).toBe('*Topic:* Topic');
    const sections = blocks.filter((b) => b.type === 'section' && /\*(X|LinkedIn|Instagram|Facebook|Pinterest|YouTube)\*/.test(b.text.text));
    expect(sections).toHaveLength(6);
    const actions = blocks.at(-1);
    expect(actions.type).toBe('actions');
    expect(actions.elements.map((e) => [e.text.text, e.action_id, e.style, e.value])).toEqual([
      ['Approve All', 'approve_all', 'primary', TASK],
      ['Reject', 'reject', 'danger', TASK],
      ['Edit & Resubmit', 'edit_resubmit', undefined, TASK],
    ]);
    expect(blocks.length).toBeLessThanOrEqual(50);
  });
  it('adds a destination line with a link under each draft', () => {
    const ctx = blocks.filter((b) => b.type === 'context').map((b) => b.elements[0].text);
    expect(ctx).toHaveLength(6);
    expect(ctx[0]).toBe('Not connected: copy and post by hand · <https://x.com/compose/post|Open X>');
    expect(ctx[1]).toContain('Posts automatically on Approve All · <https://www.linkedin.com/company/88918654/|LinkedIn page>');
    expect(ctx[5]).toContain('days 3, 6, 9 … 30');
    expect(ctx[5]).toContain('<https://studio.youtube.com|YouTube Studio>');
  });
  it('shows titles and clips very long copy', () => {
    const long = slackBlocks(TASK, 'T', [{ platform: 'youtube', title: 'Vid', copy: 'z'.repeat(5000) }]);
    const body = long.find((b) => b.text?.text.startsWith('*YouTube*')).text.text;
    expect(body).toContain('*Vid*');
    expect(body.endsWith('…')).toBe(true);
    expect(body.length).toBeLessThan(2700);
  });
});

describe('generateDailyPosts (integration)', () => {
  it('reads guardrails, calls Anthropic 6x concurrently, logs 6 drafts + notified, posts once to Slack', async () => {
    const env = makeEnv();
    expect(await generateDailyPosts(env, DATE)).toBe('notified');

    expect(env.CONTENT_CACHE.get).toHaveBeenCalledWith('brand:guidelines', 'json');
    expect(maxInflight).toBe(6);
    expect(anthropicCalls).toHaveLength(6);
    for (const c of anthropicCalls) {
      expect(c.headers['x-api-key']).toBe('sk-test');
      expect(c.headers['anthropic-version']).toBe('2023-06-01');
      expect(c.body.model).toBe('test-model');
      expect(c.body.system).toContain('Empowering Detective');
    }
    expect(statuses(env, 'running')).toHaveLength(1);
    const drafted = statuses(env, 'drafted').map((r) => JSON.parse(r.draft_content));
    expect(drafted.map((d) => d.platform).sort()).toEqual([...PLATFORMS].sort());
    expect(drafted.every((d) => d.topic === 'Thread: exposure' && d.cta === 'Check your exposure')).toBe(true);

    expect(slackPosts).toHaveLength(1);
    expect(slackPosts[0].headers.Authorization).toBe('Bearer xoxb-test');
    expect(slackPosts[0].body.channel).toBe('#mpt-content-approval');
    expect(slackPosts[0].body.blocks.at(-1).elements.map((e) => e.action_id)).toEqual(['approve_all', 'reject', 'edit_resubmit']);
    expect(JSON.parse(statuses(env, 'notified')[0].draft_content)).toEqual({ channel: 'C99', ts: '1.1' });
  });

  it('uses the queue-message topic and tags without needing a schedule', async () => {
    const env = makeEnv({ CONTENT_CACHE: { get: async (k) => (k === 'brand:guidelines' ? brand : null) } });
    await generateDailyPosts(env, DATE, { topic: 'From brand-topics', pillar: 'awareness', asset_tags: ['score'] });
    expect(anthropicCalls.every((c) => c.body.messages[0].content.includes("Today's topic: From brand-topics"))).toBe(true);
    expect(anthropicCalls[0].body.messages[0].content).toContain('Content pillar: awareness');
    expect(statuses(env, 'drafted').every((r) => JSON.parse(r.draft_content).asset_tags[0] === 'score')).toBe(true);
    expect(slackPosts[0].body.blocks[1].text.text).toBe('*Topic:* From brand-topics');
  });

  it('runs without cached guardrails', async () => {
    const env = makeEnv({ CONTENT_CACHE: { get: async (k) => (k === `schedule:${DATE}` ? schedule : null) } });
    await generateDailyPosts(env, DATE);
    expect(anthropicCalls[0].body.system).toContain('(no guardrails cached)');
  });

  it('throws when there is neither a message topic nor a schedule', async () => {
    const env = makeEnv({ CONTENT_CACHE: { get: async () => null } });
    await expect(generateDailyPosts(env, DATE)).rejects.toThrow(/no topic/);
    expect(anthropicCalls).toHaveLength(0);
  });

  it('a platform with no topic fails that platform only', async () => {
    const env = makeEnv({ CONTENT_CACHE: { get: async (k) => (k === `schedule:${DATE}` ? { items: {} } : brand) } });
    await expect(generateDailyPosts(env, DATE)).rejects.toThrow(/x: no topic/);
  });

  it('one failing platform: the others are saved, the error names it, and nothing is posted to Slack', async () => {
    llm = (p) => (p === 'youtube' ? new Response('overloaded', { status: 529 }) : Response.json({ content: [{ type: 'text', text: JSON.stringify(goodFor(p)) }] }));
    const env = makeEnv();
    await expect(generateDailyPosts(env, DATE)).rejects.toThrow(/youtube: Anthropic API 529: overloaded/);
    expect(statuses(env, 'drafted')).toHaveLength(5);
    expect(slackPosts).toHaveLength(0);

    // retry only regenerates the missing platform
    llm = (p) => Response.json({ content: [{ type: 'text', text: JSON.stringify(goodFor(p)) }] });
    anthropicCalls.length = 0;
    expect(await generateDailyPosts(env, DATE)).toBe('notified');
    expect(anthropicCalls).toHaveLength(1);
    expect(statuses(env, 'drafted')).toHaveLength(6);
    expect(slackPosts).toHaveLength(1);
  });

  it('a malformed LLM reply (no JSON / over limit / non-text blocks) fails with the platform name', async () => {
    llm = (p) => Response.json({ content: p === 'x' ? [{ type: 'tool_use' }] : p === 'linkedin' ? undefined : [{ type: 'text', text: JSON.stringify(goodFor(p)) }] });
    const env = makeEnv();
    const err = await generateDailyPosts(env, DATE).catch((e) => e);
    expect(err.message).toMatch(/x: LLM reply contained no JSON object/);
    expect(err.message).toMatch(/linkedin: LLM reply contained no JSON object/);
  });

  it('is a no-op once notified (duplicate delivery)', async () => {
    const env = makeEnv();
    await generateDailyPosts(env, DATE);
    anthropicCalls.length = 0;
    expect(await generateDailyPosts(env, DATE)).toBe('skipped');
    expect(anthropicCalls).toHaveLength(0);
    expect(slackPosts).toHaveLength(1);
  });

  it.each([
    ['Slack ok:false', () => Response.json({ ok: false, error: 'channel_not_found' }), /channel_not_found/],
    ['Slack HTTP 500 with a non-JSON body', () => new Response('boom', { status: 500 }), /Slack post failed: 500/],
  ])('%s fails the job after drafts are saved', async (_n, reply, re) => {
    slack = reply;
    const env = makeEnv();
    await expect(generateDailyPosts(env, DATE)).rejects.toThrow(re);
    expect(statuses(env, 'drafted')).toHaveLength(6);
    expect(statuses(env, 'notified')).toHaveLength(0);
  });

  it('skips drafted rows with empty draft_content', async () => {
    const env = makeEnv();
    env.AGENT_LOGS.logs.push({ task_id: TASK, status: 'drafted', draft_content: null });
    await generateDailyPosts(env, DATE);
    expect(statuses(env, 'drafted')).toHaveLength(7);
    expect(anthropicCalls).toHaveLength(6);
  });
});

describe('default export: queue()', () => {
  const msg = (body, attempts = 1) => ({ body, attempts, ack: vi.fn(), retry: vi.fn() });
  const good = { date: DATE, action: 'generate_daily_posts' };

  it('acks a good message after a successful run', async () => {
    const env = makeEnv(); const m = msg({ ...good, topic: 'Q topic', pillar: 'p', format_type: 'f', asset_tags: ['a'] });
    await consumer.queue({ messages: [m] }, env);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(anthropicCalls[0].body.messages[0].content).toContain('Q topic');
  });

  it.each([[{ date: DATE, action: 'other' }], [{ action: 'generate_daily_posts' }], [{ date: 'tomorrow', action: 'generate_daily_posts' }], [undefined]])('acks and drops bad message %#', async (body) => {
    const m = msg(body);
    await consumer.queue({ messages: [m] }, makeEnv());
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(anthropicCalls).toHaveLength(0);
  });

  it('retries with backoff and logs a failed row when the job throws', async () => {
    llm = () => new Response('nope', { status: 500 });
    const env = makeEnv(); const m = msg(good, 2);
    await consumer.queue({ messages: [m] }, env);
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(statuses(env, 'failed')[0].error_message).toMatch(/^attempt 2: x: Anthropic API 500/);
  });

  it('still retries when logging the failure itself fails', async () => {
    llm = () => new Response('nope', { status: 500 });
    const env = makeEnv({ AGENT_LOGS: makeDb({ failInsertFor: 'failed' }) }); const m = msg(good);
    await consumer.queue({ messages: [m] }, env);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it('records the Error message even for a thrown non-Error', async () => {
    const env = makeEnv({ CONTENT_CACHE: { get: async () => { throw undefined; } } }); const m = msg(good);
    await consumer.queue({ messages: [m] }, env);
    expect(m.retry).toHaveBeenCalled();
    expect(statuses(env, 'failed')[0].error_message).toBe('attempt 1: undefined');
  });

  it('processes a batch message by message', async () => {
    const env = makeEnv(); const a = msg(good); const b = msg({ ...good, date: '2026-10-21' });
    env.CONTENT_CACHE.get = vi.fn(async (k) => (k === 'schedule:2026-10-21' || k === `schedule:${DATE}` ? schedule : brand));
    await consumer.queue({ messages: [a, b] }, env);
    expect(a.ack).toHaveBeenCalled();
    expect(b.ack).toHaveBeenCalled();
  });
});

describe('default export: fetch()', () => {
  it('is health-only', async () => expect(await (await consumer.fetch()).json()).toEqual({ ok: true, worker: 'mpt-content-consumer' }));
});
