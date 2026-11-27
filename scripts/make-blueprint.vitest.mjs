// @vitest-environment node
// Guards the Make scenario copy in docs/make against the 2026-10-29 incident: a stale blueprint update dropped fields that
// Make's HTTP modules require, so the image download failed and every receipt step was silently skipped (error handler = Ignore).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const bp = JSON.parse(readFileSync(new URL('../docs/make/mpc-6952-blueprint.json', import.meta.url), 'utf8'));

const modules = [];
const walk = (nodes) => {
  for (const m of nodes ?? []) {
    modules.push(m);
    for (const r of m.routes ?? []) walk(r.flow);
  }
};
walk(bp.flow);
const byName = (name) => modules.filter((m) => m.module === name);

describe('Make scenario MPC-6952 blueprint copy', () => {
  it('has the expected receipt steps, one per publishing route', () => {
    const receipts = byName('http:ActionSendData');
    expect(receipts.map((m) => m.id).sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 34]);
    const platforms = receipts.map((m) => JSON.parse(m.mapper.data.replace(/\{\{[^}]*\}\}/g, 'x')).platform);
    expect(platforms.sort()).toEqual(['facebook', 'instagram', 'linkedin', 'linkedin', 'youtube']);
  });

  it('gives every receipt step the fields Make requires (followAllRedirects is mandatory) and a placeholder token', () => {
    for (const m of byName('http:ActionSendData')) {
      expect(m.mapper.followAllRedirects, `module ${m.id}`).toBe(false);
      for (const k of ['url', 'data', 'method', 'headers', 'serializeUrl', 'shareCookies', 'followRedirect', 'rejectUnauthorized']) {
        expect(m.mapper[k], `module ${m.id} ${k}`).not.toBeUndefined();
      }
      expect(m.mapper.url).toBe('https://mpt-content-approval.myprivacytool.workers.dev/receipt');
      expect(m.mapper.headers).toEqual([{ name: 'x-receipt-token', value: '__RECEIPT_TOKEN__' }]);
      expect(m.onerror?.[0]?.module, `module ${m.id} keeps Ignore so a failed receipt never blocks a post`).toBe('builtin:Ignore');
    }
  });

  it('gives the LinkedIn image download the fields it requires and no unknown ones', () => {
    const [get] = byName('http:ActionGetFile');
    expect(Object.keys(get.mapper).sort()).toEqual(['method', 'serializeUrl', 'shareCookies', 'url']);
    expect(get.mapper.method).toBe('get');
  });

  it('decides YouTube days by the Hong Kong date, the same rule the approval Worker applies', () => {
    const search = modules.find((m) => m.id === 30);
    const text = JSON.stringify(search.filter);
    expect(text).toContain('Asia/Hong_Kong');
    expect(text).not.toMatch(/formatDate\(now; \\"D\\"\)/);
  });

  it('contains no real secrets', () => {
    const raw = readFileSync(new URL('../docs/make/mpc-6952-blueprint.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/[0-9a-f]{64}/);
    expect(raw).toContain('__RECEIPT_TOKEN__');
  });
});
