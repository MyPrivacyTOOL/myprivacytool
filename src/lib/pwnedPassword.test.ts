import { describe, it, expect, vi } from 'vitest';
import { checkPwnedPassword, countForSuffix, sha1Hex } from './pwnedPassword';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PW = 'password';
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

const okResponse = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

describe('pwnedPassword (k-anonymity)', () => {
  it('hashes with SHA-1 correctly', async () => {
    expect(await sha1Hex(PW)).toBe(PREFIX + SUFFIX);
  });

  it('finds a known-pwned password and reports the count', async () => {
    const f = vi.fn(async () => okResponse(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:10434004\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0`));
    const r = await checkPwnedPassword(PW, f as unknown as typeof fetch);
    expect(r).toEqual({ status: 'checked', count: 10434004 });
  });

  it('returns 0 when the suffix is absent or only padding', async () => {
    const f = vi.fn(async () => okResponse(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:0`));
    expect(await checkPwnedPassword(PW, f as unknown as typeof fetch)).toEqual({ status: 'checked', count: 0 });
  });

  it('sends only the 5-char prefix: no password, no full hash, no suffix leaves the browser', async () => {
    const SECRET = 'Zq7-unique-secret-9!';   // distinctive, so a substring check cannot match the hostname
    const full = await sha1Hex(SECRET);
    const f = vi.fn(async () => okResponse(''));
    await checkPwnedPassword(SECRET, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.pwnedpasswords.com/range/' + full.slice(0, 5));
    const sent = JSON.stringify([url, init]);
    expect(sent).not.toContain(SECRET);
    expect(sent).not.toContain(encodeURIComponent(SECRET));
    expect(sent).not.toContain(full.slice(5));
    expect(sent).not.toContain(full);
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true');
  });

  it('never reports "safe" on failure: HTTP error and network error are status error', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 503, text: async () => '' }) as unknown as Response);
    expect(await checkPwnedPassword(PW, bad as unknown as typeof fetch)).toEqual({ status: 'error', reason: 'HTTP 503' });
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await checkPwnedPassword(PW, boom as unknown as typeof fetch)).toEqual({ status: 'error', reason: 'unreachable' });
  });

  it('rejects an empty password without any network call', async () => {
    const f = vi.fn();
    expect(await checkPwnedPassword('', f as unknown as typeof fetch)).toEqual({ status: 'error', reason: 'empty' });
    expect(f).not.toHaveBeenCalled();
  });

  it('countForSuffix is case-insensitive and tolerant of blank lines', () => {
    expect(countForSuffix(`\r\n${SUFFIX.toLowerCase()}:7\r\n`, SUFFIX)).toBe(7);
  });
});
