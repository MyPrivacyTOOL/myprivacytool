// @vitest-environment node
import { describe, it, expect } from 'vitest';
import worker from './worker';

describe('mpt-mirror-risk worker', () => {
  it('routes POST /api/v1/scan through the handler (phone => not_checked)', async () => {
    const res = await worker.fetch(
      new Request('https://x.test/api/v1/scan', { method: 'POST', body: JSON.stringify({ value: '+1 555 123 4567', type: 'phone' }) }),
      { HIBP_API_KEY: 'k' }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.level).toBe('not_checked');
  });

  it('404s unknown paths', async () => {
    expect((await worker.fetch(new Request('https://x.test/'), {})).status).toBe(404);
  });
});
