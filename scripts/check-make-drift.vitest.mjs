// @vitest-environment node
// Guards the Make drift check: it must flag a dropped required field or a changed filter, and must ignore editor layout and the secret token.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalize, diff, unwrap, fetchLive, main, RECEIPT_TOKEN_PLACEHOLDER } from './check-make-drift.mjs';

const copy = () => JSON.parse(readFileSync(new URL('../docs/make/mpc-6952-blueprint.json', import.meta.url), 'utf8'));
const receiptStep = (bp) => bp.flow[1].routes[1].flow[1].routes[0].flow[2];

describe('normalize', () => {
  it('drops editor layout everywhere and masks the receipt token', () => {
    const bp = copy();
    bp.flow[0].metadata.designer = { x: 99, y: 99 };
    receiptStep(bp).mapper.headers[0].value = 'a'.repeat(64);
    const n = normalize(bp);
    expect(JSON.stringify(n)).not.toContain('designer');
    expect(receiptStep(n).mapper.headers[0].value).toBe(RECEIPT_TOKEN_PLACEHOLDER);
  });
  it('keeps only name, metadata and flow, so extra top-level live fields are not drift', () => {
    const n = normalize({ ...copy(), scheduling: { type: 'immediately' }, interface: { input: [] } });
    expect(Object.keys(n).sort()).toEqual(['flow', 'metadata', 'name']);
  });
});

describe('diff', () => {
  it('finds nothing for identical values', () => expect(diff(normalize(copy()), normalize(copy()))).toEqual([]));
  it('names the path of a dropped required field (the 29 Oct incident)', () => {
    const live = copy();
    delete receiptStep(live).mapper.followAllRedirects;
    expect(diff(normalize(copy()), normalize(live))).toEqual(['flow[1].routes[1].flow[1].routes[0].flow[2].mapper.followAllRedirects: in repo copy, missing in live']);
  });
  it('reports an extra field, a changed value, a missing module and an extra module', () => {
    const live = copy();
    live.flow[1].routes[1].flow[1].routes[0].flow[0].mapper.timeout = 40;
    live.name = 'renamed';
    live.flow[1].routes[0].flow.push({ id: 99 });
    live.flow[1].routes[1].flow[1].routes.pop();
    const out = diff(normalize(copy()), normalize(live));
    expect(out).toContain('flow[1].routes[1].flow[1].routes[0].flow[0].mapper.timeout: in live, missing in repo copy');
    expect(out.some((l) => l.startsWith('name: repo'))).toBe(true);
    expect(out).toContain('flow[1].routes[0].flow[1]: in live, missing in repo copy');
    expect(out.some((l) => l.endsWith('in repo copy, missing in live') && l.startsWith('flow[1].routes[1].flow[1].routes[4]'))).toBe(true);
  });
  it('reports a type change between object and array', () => {
    expect(diff({ a: [] }, { a: {} })).toEqual(['a: repo [] vs live {}']);
  });
});

describe('unwrap and fetchLive', () => {
  it('accepts the Make API envelope and a bare blueprint', () => {
    expect(unwrap({ response: { blueprint: { name: 'x' } } })).toEqual({ name: 'x' });
    expect(unwrap({ blueprint: { name: 'y' } })).toEqual({ name: 'y' });
    expect(unwrap({ name: 'z' })).toEqual({ name: 'z' });
  });
  it('calls the zone and scenario with the token header and fails on an HTTP error', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ response: { blueprint: { name: 'live' } } }) }));
    expect(await fetchLive({ token: 't0k', zone: 'eu2', scenarioId: '5' }, f)).toEqual({ name: 'live' });
    expect(f).toHaveBeenCalledWith('https://eu2.make.com/api/v2/scenarios/5/blueprint', { headers: { Authorization: 'Token t0k' } });
    await expect(fetchLive({ token: 'x' }, async () => ({ ok: false, status: 403 }))).rejects.toThrow('Make API answered 403');
  });
});

describe('main', () => {
  const lines = () => { const out = []; return { out, log: (l) => out.push(l) }; };
  const file = (bp) => { const p = path.join(mkdtempSync(path.join(tmpdir(), 'drift-')), 'live.json'); writeFileSync(p, JSON.stringify(bp)); return p; };

  it('exits 0 when the live scenario matches', async () => {
    const { out, log } = lines();
    expect(await main({}, ['node', 'x', '--file', file({ response: { blueprint: copy() } })], fetch, log)).toBe(0);
    expect(out[0]).toContain('No drift');
  });
  it('exits 1 and lists the difference when a field is missing', async () => {
    const live = copy(); delete receiptStep(live).mapper.followAllRedirects;
    const { out, log } = lines();
    expect(await main({}, ['node', 'x', '--file', file(live)], fetch, log)).toBe(1);
    expect(out[0]).toContain('1 difference');
    expect(out[1]).toContain('followAllRedirects');
    expect(out.at(-1)).toContain('docs/make/README.md');
  });
  it('truncates a long list of differences', async () => {
    const live = copy(); live.flow = [];
    const bigLive = { ...live, name: 'x', metadata: {} };
    const many = { ...copy(), flow: Array.from({ length: 60 }, (_, i) => ({ id: i })) };
    const { out, log } = lines();
    expect(await main({}, ['node', 'x', '--file', file(many)], fetch, log)).toBe(1);
    expect(out.some((l) => l.includes('... and'))).toBe(true);
    expect(bigLive.name).toBe('x');
  });
  it('requires the token when comparing the live scenario, and uses zone and scenario overrides', async () => {
    await expect(main({}, ['node', 'x'], fetch, () => {})).rejects.toThrow('MAKE_API_TOKEN is not set');
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ response: { blueprint: copy() } }) }));
    expect(await main({ MAKE_API_TOKEN: 'k' }, ['node', 'x'], f, () => {})).toBe(0);
    expect(f.mock.calls[0][0]).toBe('https://eu1.make.com/api/v2/scenarios/7817044/blueprint');
    await main({ MAKE_API_TOKEN: 'k', MAKE_ZONE: 'us1', MAKE_SCENARIO_ID: '9' }, ['node', 'x'], f, () => {});
    expect(f.mock.calls[1][0]).toBe('https://us1.make.com/api/v2/scenarios/9/blueprint');
  });
});

describe('workflow', () => {
  it('is scheduled, manually runnable, read-only, and passes when the secret is absent', () => {
    const raw = readFileSync(new URL('../.github/workflows/make-drift-check.yml', import.meta.url), 'utf8');
    expect(raw).toContain('schedule:');
    expect(raw).toContain('workflow_dispatch:');
    expect(raw).toContain('contents: read');
    expect(raw).toContain('MAKE_API_TOKEN repo secret is not set, drift check skipped');
    expect(raw).toContain('node scripts/check-make-drift.mjs');
  });
});
