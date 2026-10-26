import { describe, it, expect } from 'vitest';
import {
  compare, load, purge, recordRecheck, recordSelfReport, saveBaseline, observationFrom, RECHECK_KEY, RECHECK_TTL_MS, MAX_RECHECKS, OUTCOME_COPY,
  type Deps, type Observation,
} from './webrtcRecheck';
import { webrtcStateFrom, WEBRTC_DETECTOR_VERSION } from '@/lib/fingerprintDetection';

// Synthetic users only: an in-memory storage stands in for one visitor's browser. Nothing here touches a network or a real database.
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
};
const T0 = new Date('2026-10-26T10:00:00.000Z');
const at = (ms: number) => () => new Date(T0.getTime() + ms);
const obs = (state: Observation['state'], over: Partial<Observation> = {}): Observation =>
  ({ state, detectorVersion: WEBRTC_DETECTOR_VERSION, browser: 'chrome', observedAt: T0.toISOString(), ...over });

function journey() {
  const storage = mem();
  const d = (ms = 0, consent = true): Deps => ({ storage, consent, now: at(ms) });
  return { storage, d };
}

describe('the state rule (detector)', () => {
  it('only a finished gathering with a candidate and no public address is none_found', () => {
    expect(webrtcStateFrom({ publicCount: 1, candidateCount: 2, completed: true })).toBe('found');
    expect(webrtcStateFrom({ publicCount: 1, candidateCount: 1, completed: false })).toBe('found');
    expect(webrtcStateFrom({ publicCount: 0, candidateCount: 1, completed: true })).toBe('none_found');
    expect(webrtcStateFrom({ publicCount: 0, candidateCount: 0, completed: true })).toBe('blocked');
    expect(webrtcStateFrom({ publicCount: 0, candidateCount: 3, completed: false })).toBe('timed_out');
    expect(webrtcStateFrom({ publicCount: 0, candidateCount: 0, completed: false })).toBe('timed_out');
  });
});

describe('compare: honest outcomes', () => {
  const base = obs('found');
  it('improvement only for found -> none_found, same version and browser', () => {
    expect(compare(base, obs('none_found')).outcome).toBe('improvement');
  });
  it('no change when the address is still visible', () => {
    expect(compare(base, obs('found')).outcome).toBe('no_change');
  });
  it('blocked, timed out and unsupported are inconclusive, never improvement', () => {
    for (const s of ['blocked', 'timed_out', 'unsupported'] as const) expect(compare(base, obs(s)).outcome).toBe('inconclusive');
  });
  it('a different detector version or browser is incomparable, even when the re-check looks better', () => {
    expect(compare(base, obs('none_found', { detectorVersion: 'webrtc-state-2' })).outcome).toBe('incomparable');
    expect(compare(base, obs('none_found', { browser: 'firefox' })).outcome).toBe('incomparable');
  });
  it('a baseline that was not a found reading, or none, is incomparable', () => {
    for (const s of ['none_found', 'blocked', 'timed_out', 'unsupported', 'error'] as const) expect(compare(obs(s), obs('none_found')).outcome).toBe('incomparable');
    expect(compare(null, obs('none_found')).outcome).toBe('incomparable');
  });
  it('a failed re-check is an error whatever the baseline', () => {
    expect(compare(base, obs('error')).outcome).toBe('error');
    expect(compare(null, obs('error')).outcome).toBe('error');
  });
  it('no outcome copy claims protection, safety or that we changed anything', () => {
    for (const c of Object.values(OUTCOME_COPY)) expect(`${c.headline} ${c.text}`).not.toMatch(/\bsafe\b|protected|we (fixed|changed|turned)|score|%/i);
  });
});

describe('the journey in one visitor browser', () => {
  it('improvement: baseline kept, own word recorded, comparable re-check', () => {
    const { storage, d } = journey();
    expect(saveBaseline(obs('found'), d())).not.toBeNull();
    expect(recordSelfReport(d(1000))?.selfReport?.at).toBe(new Date(T0.getTime() + 1000).toISOString());
    const { entry } = recordRecheck(obs('none_found', { observedAt: new Date(T0.getTime() + 2000).toISOString() }), d(2000));
    expect(entry?.comparison.outcome).toBe('improvement');
    // read the persisted state back, not the returned object
    const saved = JSON.parse(storage.raw.get(RECHECK_KEY)!);
    expect(saved.baseline.state).toBe('found');
    expect(saved.selfReport.at).toBeTruthy();
    expect(saved.rechecks).toHaveLength(1);
    expect(saved.rechecks[0].comparison.outcome).toBe('improvement');
  });

  it('the original observation is never overwritten by a later one', () => {
    const { d } = journey();
    const first = saveBaseline(obs('found', { observedAt: '2026-10-26T10:00:00.000Z' }), d())!;
    const again = saveBaseline(obs('found', { observedAt: '2026-10-26T10:05:00.000Z' }), d(5000))!;
    expect(again.baseline.observedAt).toBe(first.baseline.observedAt);
    recordSelfReport(d(6000));
    recordRecheck(obs('none_found', { observedAt: '2026-10-26T10:06:00.000Z' }), d(6000));
    expect(load(d(7000))!.baseline).toEqual(first.baseline);
  });

  it('no change and inconclusive re-checks are kept honestly, in order', () => {
    const { d } = journey();
    saveBaseline(obs('found'), d());
    recordSelfReport(d(1));
    recordRecheck(obs('found', { observedAt: 'a1' }), d(2));
    recordRecheck(obs('timed_out', { observedAt: 'a2' }), d(3));
    expect(load(d(4))!.rechecks.map((r) => r.comparison.outcome)).toEqual(['no_change', 'inconclusive']);
  });

  it('a re-check is refused until the visitor has said they did the step', () => {
    const { d } = journey();
    saveBaseline(obs('found'), d());
    const { entry } = recordRecheck(obs('none_found', { observedAt: 'x' }), d(1));
    expect(entry).toBeNull();
    expect(load(d(2))!.rechecks).toHaveLength(0);
  });

  it('closed prompt or Later: nothing is recorded as a response', () => {
    const { storage, d } = journey();
    saveBaseline(obs('found'), d());
    // the prompt is closed: recordSelfReport is never called
    const saved = JSON.parse(storage.raw.get(RECHECK_KEY)!);
    expect(saved.selfReport).toBeUndefined();
    expect(load(d(10))!.selfReport).toBeUndefined();
  });

  it('duplicate and replayed requests change nothing', () => {
    const { d } = journey();
    saveBaseline(obs('found'), d());
    const a = recordSelfReport(d(1000))!;
    const b = recordSelfReport(d(9000))!;
    expect(b.selfReport!.at).toBe(a.selfReport!.at);
    const o = obs('none_found', { observedAt: 'same' });
    recordRecheck(o, d(2000));
    recordRecheck(o, d(3000));
    expect(load(d(4000))!.rechecks).toHaveLength(1);
  });

  it('re-checks are capped', () => {
    const { d } = journey();
    saveBaseline(obs('found'), d());
    recordSelfReport(d(1));
    for (let i = 0; i < MAX_RECHECKS + 3; i++) recordRecheck(obs('found', { observedAt: `r${i}` }), d(10 + i));
    expect(load(d(100))!.rechecks).toHaveLength(MAX_RECHECKS);
  });

  it('only a found reading becomes a baseline', () => {
    const { storage, d } = journey();
    for (const s of ['none_found', 'blocked', 'timed_out', 'unsupported', 'error'] as const) expect(saveBaseline(obs(s), d())).toBeNull();
    expect(storage.raw.size).toBe(0);
  });
});

describe('consent, withdrawal, expiry, deletion, failure', () => {
  it('missing consent: nothing is saved and nothing can be re-checked', () => {
    const { storage, d } = journey();
    expect(saveBaseline(obs('found'), d(0, false))).toBeNull();
    expect(storage.raw.size).toBe(0);
    expect(recordSelfReport(d(1, false))).toBeNull();
    expect(recordRecheck(obs('none_found'), d(2, false)).entry).toBeNull();
  });

  it('withdrawal: a saved journey is deleted the next time it is read', () => {
    const { storage, d } = journey();
    saveBaseline(obs('found'), d());
    expect(storage.raw.has(RECHECK_KEY)).toBe(true);
    expect(load(d(1, false))).toBeNull();
    expect(storage.raw.has(RECHECK_KEY)).toBe(false);
    expect(load(d(2, true))).toBeNull();
  });

  it('expired state is deleted, not returned', () => {
    const { storage, d } = journey();
    saveBaseline(obs('found'), d());
    expect(load(d(RECHECK_TTL_MS - 1))).not.toBeNull();
    expect(load(d(RECHECK_TTL_MS))).toBeNull();
    expect(storage.raw.has(RECHECK_KEY)).toBe(false);
  });

  it('deleted state: purge, and a damaged record, leave nothing and do not throw', () => {
    const { storage, d } = journey();
    saveBaseline(obs('found'), d());
    purge(d());
    expect(load(d())).toBeNull();
    storage.raw.set(RECHECK_KEY, '{not json');
    expect(load(d())).toBeNull();
    expect(storage.raw.has(RECHECK_KEY)).toBe(false);
    storage.raw.set(RECHECK_KEY, JSON.stringify({ v: 1, hexagonId: 'canvas-fingerprint', baseline: {}, rechecks: [], expiresAt: '2999-01-01' }));
    expect(load(d())).toBeNull();
  });

  it('storage failures never throw and never pretend to have saved', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
    const d: Deps = { storage: broken, consent: true, now: at(0) };
    expect(saveBaseline(obs('found'), d)).toBeNull();
    expect(load(d)).toBeNull();
    expect(() => purge(d)).not.toThrow();
    expect(saveBaseline(obs('found'), { storage: null, consent: true })).toBeNull();
  });

  it('no sensitive payload: what is stored holds no address and only the allowed fields', () => {
    const { storage, d } = journey();
    // an observation built from a detector result that also carried addresses must not carry them over
    const fromDetector = observationFrom({ state: 'found', detectorVersion: WEBRTC_DETECTOR_VERSION, ...{ publicIPs: ['203.0.113.7'], localIPs: ['192.168.1.20'] } } as never, { ...d(), browser: 'chrome' });
    saveBaseline(fromDetector, d());
    recordSelfReport(d(1));
    recordRecheck(obs('none_found', { observedAt: 'z' }), d(2));
    const text = storage.raw.get(RECHECK_KEY)!;
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+|publicIPs|localIPs|203\.0\.113|@/);
    const rec = JSON.parse(text);
    expect(Object.keys(rec).sort()).toEqual(['baseline', 'consent', 'expiresAt', 'explanationShownAt', 'hexagonId', 'rechecks', 'selfReport', 'v']);
    expect(Object.keys(rec.baseline).sort()).toEqual(['browser', 'detectorVersion', 'observedAt', 'state']);
  });
});
