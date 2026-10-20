import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPersonKey, learningEventsEnabled, recordAnswer, recordShown, resetShownForTests, PERSON_KEY_STORAGE } from './events';

const tile = { hexagonId: 'location', tileKind: 'our_guess', confidence: 0.95 };
const on = { enabled: true, consent: true, base: 'https://api.example', personKey: 'abcdefghijklmnop' };
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
    for (const d of [{ ...on, enabled: false }, { ...on, base: '' }, { ...on, consent: false }, { ...on, personKey: null }]) {
      const f = ok();
      expect(await recordAnswer(tile, 'not_me', { ...d, fetchImpl: f })).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });
  it('sends an answer with only the allowed fields and never a value', async () => {
    const f = ok();
    expect(await recordAnswer({ ...tile, source: 'web-scan' }, 'not_me', { ...on, fetchImpl: f })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/learning/event');
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(['answer', 'confidence_at_display', 'config_version', 'event_type', 'hexagon_id', 'person_key', 'scan_window', 'source', 'tile_kind']);
    expect(body).toMatchObject({ event_type: 'answer', answer: 'not_me', hexagon_id: 'location', person_key: 'abcdefghijklmnop', config_version: 0, confidence_at_display: 0.95 });
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
  it('clamps a confidence outside 0..1', async () => {
    const f = ok();
    await recordAnswer({ ...tile, confidence: 4 }, 'kept', { ...on, fetchImpl: f });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).confidence_at_display).toBe(1);
  });
});

describe('getPersonKey', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it('makes a random id once, keeps it, and it matches what the server accepts', () => {
    const s = store();
    const a = getPersonKey(s);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getPersonKey(s)).toBe(a);
    expect(s.m.get(PERSON_KEY_STORAGE)).toBe(a);
  });
  it('replaces a stored value that is not a valid id, and returns null when storage is blocked', () => {
    const s = store(); s.m.set(PERSON_KEY_STORAGE, 'bad value!');
    expect(getPersonKey(s)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getPersonKey({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBeNull();
    expect(getPersonKey(null)).toBeNull();
  });
});
