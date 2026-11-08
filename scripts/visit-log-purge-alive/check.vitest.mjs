import { describe, expect, it, vi } from 'vitest';
import { judge, main } from './check.mjs';

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k-secret' };
const answer = (body, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('visit-log purge alive', () => {
  it('judge: fresh ok, late fails, never-run fails, garbage fails', () => {
    expect(judge({ last_run: '2026-11-08T19:20:00Z', age_hours: 3, degraded: false }).ok).toBe(true);
    expect(judge({ last_run: '2026-11-07T10:00:00Z', age_hours: 27.5, degraded: true }).ok).toBe(false);
    expect(judge({ last_run: null, degraded: true }).ok).toBe(false);
    expect(judge(null).ok).toBe(false);
  });
  it('main: 0 fresh, 1 late, 1 on HTTP error without leaking the key, 2 when not configured', async () => {
    const log = vi.fn();
    expect(await main(env, answer({ last_run: 'x', age_hours: 2, degraded: false }), log)).toBe(0);
    expect(await main(env, answer({ last_run: 'x', age_hours: 30, degraded: true }), log)).toBe(1);
    expect(await main(env, answer({}, 500), log)).toBe(1);
    expect(await main({}, vi.fn(), log)).toBe(2);
    expect(log.mock.calls.flat().join('\n')).not.toContain('k-secret');
  });
  it('calls only the health RPC', async () => {
    const f = answer({ last_run: 'x', age_hours: 1, degraded: false });
    await main(env, f, () => {});
    expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/rest/v1/rpc/mpt_visit_log_purge_health');
  });
});
