import { describe, it, expect } from 'vitest';
import { liveCells, liveCounts, liveSummary, LIVE_COPY } from './liveThankYou';
import { liveThankYouEnabled, parseLiveThankYou } from '@/config/liveThankYou';

describe('MPC-8452 liveCells (honesty rule)', () => {
  it('reads the status decided at capture and never invents one', () => {
    const cells = liveCells([
      { id: 'a', label: 'A', status: 'CHECKED_AND_CLEAR' },
      { id: 'b', label: 'B', status: 'FOUND' },
      { id: 'c', label: 'C', status: 'FOUND', estimate: true },
      { id: 'd', label: 'D', status: 'NOT_CHECKED' },
    ]);
    expect(cells.map((c) => c.status)).toEqual(['clear', 'found', 'guess', 'not_checked']);
  });

  it('treats a missing, unknown or odd status as not checked, never clear', () => {
    const cells = liveCells([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', status: 'ok' }, { id: 'c', label: 'C', status: 'clear' }]);
    expect(cells.every((c) => c.status === 'not_checked')).toBe(true);
  });

  it('drops entries without an id, falls back to the id for a missing label, and handles null', () => {
    expect(liveCells(null)).toEqual([]);
    const cells = liveCells([{ label: 'no id' }, { id: 'x', status: 'FOUND' }]);
    expect(cells).toEqual([{ id: 'x', label: 'x', status: 'found' }]);
  });

  it('never carries the captured value into a cell', () => {
    const [cell] = liveCells([{ id: 'ip', label: 'IP', value: '203.0.113.9', status: 'FOUND' }]);
    expect(JSON.stringify(cell)).not.toContain('203.0.113.9');
  });

  it('counts and summarises without a score or percentage', () => {
    const text = liveSummary(liveCounts(liveCells([{ id: 'a', status: 'CHECKED_AND_CLEAR' }, { id: 'b', status: 'NOT_CHECKED' }])));
    expect(text).toBe('1 checked and clear, 0 found, 0 our guess, 1 not checked.');
    expect(text).not.toMatch(/%|score/i);
  });

  it('keeps the draft Alice lines free of alarm words and percentages', () => {
    for (const line of Object.values(LIVE_COPY)) expect(line).not.toMatch(/%|danger|alarm|hacked|urgent/i);
  });
});

describe('MPC-8452 flag', () => {
  it('is off by default and on only for the documented values', () => {
    expect(parseLiveThankYou(undefined)).toBe(false);
    expect(parseLiveThankYou('false')).toBe(false);
    expect(parseLiveThankYou(' TRUE ')).toBe(true);
    expect(liveThankYouEnabled('')).toBe(false);
    expect(liveThankYouEnabled('?live_ty=1')).toBe(true);
    expect(liveThankYouEnabled('?live_ty=0')).toBe(false);
  });
});
