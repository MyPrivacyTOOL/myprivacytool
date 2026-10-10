// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { setup, PROPERTIES } from './hubspot-setup-mpc-7500.mjs';

describe('hubspot-setup-mpc-7500', () => {
  it('creates every property the Worker writes, and treats 409 as already existing', async () => {
    const seen = [];
    const fake = async (url, o) => { const b = JSON.parse(o.body); seen.push(b.name); return { ok: b.name !== 'mpt_lead_tier', status: b.name === 'mpt_lead_tier' ? 409 : 201 }; };
    const out = await setup('t', fake);
    expect(seen).toEqual(PROPERTIES.map((p) => p.name));
    expect(out.find((r) => r.name === 'mpt_lead_tier').status).toBe('exists');
    expect(out.find((r) => r.name === 'mpt_lead_score').status).toBe('created');
  });
  it('reports failures with the status code only', async () => {
    const out = await setup('t', async () => ({ ok: false, status: 403 }));
    expect(out.every((r) => r.status === 'failed (403)')).toBe(true);
  });
  it('property names match what lead-scoring.js writes', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../workers/mpt-leads/lead-scoring.js', import.meta.url), 'utf8');
    for (const p of PROPERTIES) expect(src).toContain(p.name);
  });
});
