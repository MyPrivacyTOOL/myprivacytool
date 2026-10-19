import { describe, it, expect } from 'vitest';
import { buildReportHtml, countSecuredFor, escapeHtml } from './honeycombReport';
import type { Hexagon } from '@/types/hexagon';

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'h1', pillar: 'security', label: 'Spam lists', status: 'confirmed', data: '2 HK registries', source: 's',
  remediation: 'Register with the HK Do Not Call registry.', exposure: true, ...o,
});
const opts = { title: "Sarah's Digital Footprint", date: '17 Oct 2026' };

describe('buildReportHtml', () => {
  it('is one self-contained white page with no scripts, and every hexagon appears', () => {
    const html = buildReportHtml([hex(), hex({ id: 'h2', pillar: 'weird', label: 'Odd one', status: 'not_checked', data: null })], opts);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/<script|<link|https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain('background:#fff');
    expect(html).toContain('SPAM LISTS');
    expect(html).toContain('ODD ONE');
    expect(html).toContain('>Weird<');
  });
  it('lists unfixed exposures under What to do next, and drops them once fixed', () => {
    expect(buildReportHtml([hex()], opts)).toContain('What to do next');
    expect(buildReportHtml([hex()], opts)).toContain('Register with the HK Do Not Call registry.');
    expect(buildReportHtml([hex()], { ...opts, fixedIds: new Set(['h1']) })).not.toContain('What to do next');
  });
  it('counts secured like the dashboard: confirmed exposures only once fixed', () => {
    const list = [hex(), hex({ id: 'h2', status: 'checked', exposure: false })];
    expect(countSecuredFor(list, new Set())).toBe(1);
    expect(countSecuredFor(list, new Set(['h1']))).toBe(2);
    expect(buildReportHtml(list, { ...opts, total: 54 })).toContain('1 of 54 secured');
  });
  it('escapes anything that came from scan data', () => {
    const html = buildReportHtml([hex({ label: '<img src=x onerror=alert(1)>', data: '"><script>', remediation: '<b>x</b>' })], { ...opts, title: '<script>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
