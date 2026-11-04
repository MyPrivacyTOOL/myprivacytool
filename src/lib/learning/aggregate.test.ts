import { describe, it, expect } from 'vitest';
import { wilson, firstAnswers, summarise, proposalFor, MIN_RESPONDERS, type AnswerEvent, type ShownEvent, type Answer } from './aggregate';

const shown = (p: string, hex = 'location', w = 'w1'): ShownEvent => ({ personKey: p, hexagonId: hex, source: 'web-scan', scanWindow: w });
const ans = (p: string, a: Answer, at = 1, hex = 'location', w = 'w1'): AnswerEvent => ({ ...shown(p, hex, w), answer: a, at });
const people = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('wilson', () => {
  it('matches the known interval for 50 of 100', () => {
    const iv = wilson(50, 100);
    expect(iv.rate).toBe(0.5);
    expect(iv.low).toBeCloseTo(0.404, 2);
    expect(iv.high).toBeCloseTo(0.596, 2);
  });
  it('is the widest interval for no data, and stays inside 0..1 at the edges', () => {
    expect(wilson(0, 0)).toEqual({ rate: 0, low: 0, high: 1 });
    const all = wilson(40, 40);
    expect(all.high).toBeLessThanOrEqual(1);
    expect(all.low).toBeGreaterThan(0.9);
  });
});

describe('firstAnswers', () => {
  it('keeps one answer per person per hexagon per window: the earliest, whatever the input order', () => {
    const out = firstAnswers([ans('a', 'not_me', 5), ans('a', 'yes_me', 2), ans('b', 'yes_me', 1)]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.personKey === 'a')!.answer).toBe('yes_me');
  });
  it('counts the same person again in a different scan window or for a different hexagon', () => {
    expect(firstAnswers([ans('a', 'yes_me', 1, 'location', 'w1'), ans('a', 'yes_me', 2, 'location', 'w2'), ans('a', 'yes_me', 3, 'isp', 'w1')])).toHaveLength(3);
  });
});

describe('summarise', () => {
  it('rates are over responders, silence is excluded, and the response rate is reported', () => {
    const ps = people(100);
    const s = summarise(ps.map((p) => shown(p)), [...ps.slice(0, 20).map((p) => ans(p, 'yes_me')), ...ps.slice(20, 25).map((p) => ans(p, 'not_me'))]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ shownPeople: 100, responders: 25, yesMe: 20, notMe: 5, responseRate: 0.25 });
    expect(s[0].accuracy!.rate).toBeCloseTo(0.8, 5);
    expect(s[0].enough).toBe(false);
  });
  it('a repeated tap by one person is one vote', () => {
    const s = summarise([shown('a')], [ans('a', 'not_me', 1), ans('a', 'not_me', 2), ans('a', 'yes_me', 3)]);
    expect(s[0]).toMatchObject({ responders: 1, notMe: 1, yesMe: 0 });
  });
  it('closing a prompt records nothing, so a dispute rate needs an explicit Keep it to be a rate', () => {
    const ps = people(40);
    const s = summarise(ps.map((p) => shown(p, 'cookies-status')), [...ps.slice(0, 4).map((p) => ans(p, 'disputed', 1, 'cookies-status')), ...ps.slice(4, 40).map((p) => ans(p, 'kept', 1, 'cookies-status'))]);
    expect(s[0].disputeRate!.rate).toBeCloseTo(0.1, 5);
    expect(s[0].accuracy).toBeNull();
  });
});

describe('proposalFor', () => {
  const build = (yes: number, no: number) => {
    const ps = people(yes + no);
    return summarise(ps.map((p) => shown(p)), ps.map((p, i) => ans(p, i < yes ? 'yes_me' : 'not_me')))[0];
  };
  it('proposes nothing below the minimum sample, however lopsided', () => {
    expect(MIN_RESPONDERS).toBe(30);
    expect(proposalFor(build(0, 29), 0.95)).toBeNull();
  });
  it('proposes nothing when the current value is still inside the interval (noise)', () => {
    expect(proposalFor(build(26, 4), 0.85)).toBeNull();
  });
  it('proposes the observed rate when the interval excludes the current value, with the response-bias note', () => {
    const p = proposalFor(build(15, 45), 0.95)!;
    expect(p).toMatchObject({ basis: 'accuracy', current: 0.95, proposed: 0.25, responders: 60 });
    expect(p.interval.high).toBeLessThan(0.95);
    expect(p.note).toMatch(/not everyone/);
  });
  it('for a confident finding the proposed confidence is 1 minus the dispute rate', () => {
    const ps = people(60);
    const s = summarise(ps.map((p) => shown(p, 'cookies-status')), ps.map((p, i) => ans(p, i < 30 ? 'disputed' : 'kept', 1, 'cookies-status')))[0];
    const p = proposalFor(s, 0.95)!;
    expect(p.basis).toBe('dispute');
    expect(p.proposed).toBe(0.5);
  });
});
