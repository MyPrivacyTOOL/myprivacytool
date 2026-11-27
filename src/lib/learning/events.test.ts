import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { learningEventsEnabled, recordAnswer, recordShown, resetShownForTests } from './events';

const tile = { hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95 };
const on = { enabled: true, consent: true, base: 'https://myprivacytool-webhook-receiver.myprivacytool.workers.dev' };
const ok = () => vi.fn(async () => new Response('{}', { status: 202 }));

beforeEach(() => resetShownForTests());

describe('learningEventsEnabled', () => {
  it('is off unless the build says true', () => {
    expect(learningEventsEnabled(undefined)).toBe(false);
    expect(learningEventsEnabled('')).toBe(false);
    expect(learningEventsEnabled('false')).toBe(false);
    expect(learningEventsEnabled('maybe')).toBe(false);
    for (const v of ['true', '1', 'on', 'YES']) expect(learningEventsEnabled(v)).toBe(true);
  });
});

describe('sending', () => {
  it('sends nothing when the switch is off, there is no API address, or the visitor has not consented', async () => {
    for (const d of [{ ...on, enabled: false }, { ...on, base: '' }, { ...on, consent: false }]) {
      const f = ok();
      expect(await recordAnswer(tile, 'not_me', { ...d, fetchImpl: f })).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });
  it('sends an answer with only the allowed fields and never a value', async () => {
    const f = ok();
    expect(await recordAnswer({ ...tile, source: 'web-scan' }, 'not_me', { ...on, fetchImpl: f })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://myprivacytool-webhook-receiver.myprivacytool.workers.dev/api/learning/event');
    const body = JSON.parse(String(init.body));
    // MPC-9892: exactly these three fields. No person key, scan window, tile look or confidence leaves the browser.
    expect(Object.keys(body).sort()).toEqual(['answer', 'event_type', 'hexagon_id']);
    expect(body).toEqual({ event_type: 'answer', answer: 'not_me', hexagon_id: 'location' });
  });
  it('reports a tile as shown only once per page load', async () => {
    const f = ok();
    expect(await recordShown(tile, { ...on, fetchImpl: f })).toBe(true);
    expect(await recordShown(tile, { ...on, fetchImpl: f })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('answer');
  });
  it('never throws when the network fails or the server refuses', async () => {
    expect(await recordAnswer(tile, 'yes_me', { ...on, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toBe(false);
    expect(await recordAnswer(tile, 'yes_me', { ...on, fetchImpl: vi.fn(async () => new Response('', { status: 400 })) })).toBe(false);
  });
  it('keeps nothing identifying in this browser', async () => {
    window.localStorage.clear();
    await recordShown(tile, { ...on, fetchImpl: ok() });
    await recordAnswer(tile, 'kept', { ...on, fetchImpl: ok() });
    expect(window.localStorage.length).toBe(0);
    expect(JSON.stringify(Object.keys(window.localStorage))).not.toMatch(/person|learning/i);
  });
});

// The real consent gate (not an injected flag): only "Accept analytics" in the cookie banner lets an event out.
describe('consent gate wiring', () => {
  const base = { enabled: true, base: 'https://myprivacytool-webhook-receiver.myprivacytool.workers.dev' };
  afterEach(() => window.localStorage.clear());
  const choose = (analytics: boolean) => window.localStorage.setItem('mpt_cookie_consent', JSON.stringify({ v: 1, analytics, at: new Date().toISOString() }));

  it('sends nothing with no choice or "Essential only"', async () => {
    for (const setup of [() => {}, () => choose(false)]) {
      window.localStorage.clear(); setup();
      const f = ok();
      expect(await recordAnswer(tile, 'not_me', { ...base, fetchImpl: f })).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });
  it('sends after "Accept analytics"', async () => {
    choose(true);
    const f = ok();
    expect(await recordAnswer(tile, 'not_me', { ...base, fetchImpl: f })).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

