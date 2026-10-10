import { describe, it, expect } from 'vitest';
import { buildDigest, movers } from './digest.js';
import { rowFromPage, runDigest } from './worker.js';

const cur = { cumulativeScans: 120, targetScans: 200, paceGapPct: -40, paceStatus: '🔴 Behind', ga4ActiveUsers: 90, currentMrr: 0, conversionRate: 2, blogPosts: 3, xThreads: 4 };
const prev = { cumulativeScans: 100, ga4ActiveUsers: 120, currentMrr: 0, conversionRate: 2, blogPosts: 3, xThreads: 4 };

describe('buildDigest', () => {
  it('is at most five lines and names biggest up and down movers', () => {
    const { lines, text } = buildDigest({ weekOf: '2026-10-12', current: { ...cur, agentPlan: 'fix traffic', decisions: 'ladder revision' }, previous: prev });
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(text).toContain('120 scans against a target of 200');
    expect(text).toContain('up Cumulative Scans 100→120 (+20%)');
    expect(text).toContain('down GA4 Active Users 120→90 (-25%)');
    expect(text).toContain('Needs your decision: ladder revision');
  });
  it('names failed sources and never estimates blanks', () => {
    const { text } = buildDigest({ weekOf: 'w', current: { ...cur, ga4ActiveUsers: null }, previous: prev, failedSources: ['ga4'] });
    expect(text).toContain('DATA GAP: ga4 failed');
    expect(text).not.toContain('GA4 Active Users 120');
  });
  it('handles a missing row and missing previous week', () => {
    expect(buildDigest({ weekOf: 'w', current: null, previous: null }).text).toContain('no tracker row found');
    expect(buildDigest({ weekOf: 'w', current: cur, previous: null }).text).toContain('no comparable previous week');
  });
  it('movers skips blanks and zero baselines', () => {
    expect(movers({ currentMrr: 5 }, { currentMrr: 0 })).toEqual([]);
  });
});

describe('worker', () => {
  const page = (scans, status) => ({ properties: {
    'Week Of': { date: { start: '2026-10-12' } },
    'Cumulative Scans': { type: 'number', number: scans },
    'Target Cumulative Scans': { type: 'formula', formula: { type: 'number', number: 200 } },
    'Pace Status': { select: { name: status } },
    'Agent Insights': { rich_text: [{ plain_text: 'Plan: more X\nFailed sources: hubspot, ga4' }] },
  } });
  it('rowFromPage parses insights lines', () => {
    const r = rowFromPage(page(120, '🔴 Behind'));
    expect(r.agentPlan).toBe('more X');
    expect(r.failedSources).toEqual(['hubspot', 'ga4']);
  });
  it('posts the digest to Slack', async () => {
    const calls = [];
    const f = async (url, init) => {
      calls.push([url, init]);
      if (url.includes('notion')) return { ok: true, json: async () => ({ results: [page(120, '🔴 Behind'), page(100, '🟢 On Track')] }) };
      return { ok: true, json: async () => ({ ok: true, ts: '1', channel: 'C1' }) };
    };
    const out = await runDigest({ TRACKER_DATA_SOURCE_ID: 'x', NOTION_TOKEN: 't', SLACK_BOT_TOKEN: 's', SLACK_CHANNEL_ID: 'C1' }, f);
    expect(out.ok).toBe(true);
    expect(JSON.parse(calls[1][1].body).text).toContain('DATA GAP: hubspot, ga4');
  });
  it('reports a Notion failure without figures', async () => {
    const f = async (url) => (url.includes('notion') ? { ok: false, status: 500 } : { ok: true, json: async () => ({ ok: true }) });
    let body;
    const g = async (u, i) => { if (!u.includes('notion')) body = JSON.parse(i.body); return f(u, i); };
    await runDigest({ TRACKER_DATA_SOURCE_ID: 'x' }, g);
    expect(body.text).toContain('could not be built');
  });
});
