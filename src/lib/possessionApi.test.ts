import { describe, expect, it, vi } from 'vitest';
import { VERIFY_PROMPT } from '../../workers/webhook-receiver/pop';
import { isVerified, POSSESSION_PROMPT, requestChallenge } from './possessionApi';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const BASE = 'https://api.example';

describe('possessionApi (MPC-7902)', () => {
  it('sends nothing when the API address is not configured', async () => {
    const f = vi.fn();
    expect(await requestChallenge('85212345678', true, f as unknown as typeof fetch, '')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await isVerified('t', f as unknown as typeof fetch, '')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('carries the server-minted token and code, and the explicit consent answer', async () => {
    const f = vi.fn(async () => res(200, { session_token: 'T', code: 'MPT-AAAA-BBBB', expires_at: 5, whatsapp_link: null }));
    const r = await requestChallenge('85212345678', true, f as unknown as typeof fetch, BASE);
    expect(r).toEqual({ ok: true, challenge: { session_token: 'T', code: 'MPT-AAAA-BBBB', expires_at: 5, whatsapp_link: null } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ target: '85212345678', consent: true });
  });

  it('maps refusals to plain reasons; flag OFF is "disabled", never a fallback', async () => {
    for (const [status, reason] of [[403, 'disabled'], [429, 'rate_limited'], [400, 'bad_target'], [503, 'unavailable']] as const) {
      expect(await requestChallenge(undefined, true, (async () => res(status, {})) as unknown as typeof fetch, BASE)).toEqual({ ok: false, reason });
    }
    expect(await requestChallenge(undefined, true, (async () => res(200, { nope: 1 })) as unknown as typeof fetch, BASE)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await requestChallenge(undefined, true, (async () => { throw new Error('offline'); }) as unknown as typeof fetch, BASE)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('isVerified is true only on an explicit verified:true', async () => {
    expect(await isVerified('t', (async () => res(200, { verified: true })) as unknown as typeof fetch, BASE)).toBe(true);
    expect(await isVerified('t', (async () => res(200, { verified: false })) as unknown as typeof fetch, BASE)).toBe(false);
    expect(await isVerified('t', (async () => res(403, { verified: true })) as unknown as typeof fetch, BASE)).toBe(false);
    expect(await isVerified('t', (async () => { throw new Error('x'); }) as unknown as typeof fetch, BASE)).toBe(false);
  });

  it('shows the approved wording', () => {
    expect(POSSESSION_PROMPT).toBe(VERIFY_PROMPT);   // client and server say the same thing
    expect(POSSESSION_PROMPT).toBe('To protect privacy, verify that you control this number by sending this code to our WhatsApp bot.');
  });
});
