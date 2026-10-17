/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { ProofOfPossessionError, runOsintScan, verifiedExposureCount, type OsintProviders } from './osintOrchestrator';

const contact = { wa_id: '85212345678', profile_name: 'Alex', inbound_message_timestamp: 1760000000 };
const ok: OsintProviders = {
  profileMetadata: async () => ({ profile_pic_exists: true, is_business: false }),
  spamRegistry: async () => ({ flag_count: 0 }),
  breachDb: async () => ({ breach_count: 2 }),
};
const byId = (hs: { id: string }[], id: string) => hs.find((h) => h.id === id) as any;
const hangs = () => new Promise<never>(() => {});

describe('runOsintScan', () => {
  it('refuses with no inbound message, and calls no provider', async () => {
    const spy = vi.fn(async () => ({ flag_count: 0 }));
    await expect(runOsintScan({ ...contact, inbound_message_timestamp: null }, { spamRegistry: spy })).rejects.toBeInstanceOf(ProofOfPossessionError);
    await expect(runOsintScan({ ...contact, wa_id: '+85212; drop' }, { spamRegistry: spy })).rejects.toBeInstanceOf(ProofOfPossessionError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('spam API ok with 0 flags -> checked, "Clean"', async () => {
    const { hexagons } = await runOsintScan(contact, ok);
    expect(byId(hexagons, 'hex_security_spam_flag')).toMatchObject({ status: 'checked', data: 'Clean', exposure: false });
  });

  it('spam API timeout -> not_checked, data null, and the other layers still answer', async () => {
    const { hexagons, diagnostics } = await runOsintScan(contact, { ...ok, spamRegistry: hangs }, { timeoutMs: 20 });
    expect(byId(hexagons, 'hex_security_spam_flag')).toMatchObject({ status: 'not_checked', data: null });
    expect(byId(hexagons, 'hex_security_breach_count')).toMatchObject({ status: 'checked', data: '2 breaches' });
    expect(byId(hexagons, 'hex_contact_profile_pic').status).toBe('checked');
    expect(diagnostics.find((d) => d.provider === 'spam_registry')?.outcome).toBe('timeout');
  });

  it('aborts the provider call on timeout', async () => {
    let signal: AbortSignal | undefined;
    await runOsintScan(contact, { spamRegistry: (_w, s) => { signal = s; return hangs(); } }, { timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
  });

  it('error, missing provider, and malformed answers are all not_checked, never 0 / false', async () => {
    const bad: OsintProviders = {
      profileMetadata: async () => ({ profile_pic_exists: true } as any),     // is_business missing
      spamRegistry: async () => { throw new Error('503'); },
      breachDb: async () => ({ breach_count: '0' } as any),                    // wrong type
    };
    for (const p of [bad, {}]) {
      const { hexagons } = await runOsintScan(contact, p);
      for (const id of ['hex_contact_profile_pic', 'hex_contact_business_status', 'hex_security_spam_flag', 'hex_security_breach_count']) {
        expect(byId(hexagons, id), id).toMatchObject({ status: 'not_checked', data: null });
      }
    }
  });

  it('layer 2 failing marks both its hexagons not_checked together', async () => {
    const { hexagons } = await runOsintScan(contact, { ...ok, profileMetadata: async () => { throw new Error('x'); } });
    expect(byId(hexagons, 'hex_contact_profile_pic').status).toBe('not_checked');
    expect(byId(hexagons, 'hex_contact_business_status').status).toBe('not_checked');
    expect(byId(hexagons, 'hex_security_spam_flag').status).toBe('checked');
  });

  it('injects remediation, including the exact WhatsApp profile photo path', async () => {
    const { hexagons } = await runOsintScan(contact, ok);
    expect(byId(hexagons, 'hex_contact_profile_pic').remediation).toBe('Go to WhatsApp Settings > Privacy > Profile Photo > Select "My Contacts" or "Nobody".');
    for (const h of hexagons) expect(h.remediation, h.id).toBeTruthy();
  });

  it('no display name from Meta -> not_checked, and the name is sanitised', async () => {
    expect(byId((await runOsintScan({ ...contact, profile_name: '' }, ok)).hexagons, 'hex_contact_display_name').status).toBe('not_checked');
    expect(byId((await runOsintScan({ ...contact, profile_name: 'A\nB\t' + 'x'.repeat(100) }, ok)).hexagons, 'hex_contact_display_name').data).not.toMatch(/[\n\t]/);
  });

  it('counts only scored exposures; a disputed or false-positive finding drops out', async () => {
    const { hexagons } = await runOsintScan(contact, ok);   // name, photo, 2 breaches = 3 exposures
    expect(verifiedExposureCount(hexagons)).toBe(3);
    const rejected = hexagons.map((h) => (h.id === 'hex_contact_profile_pic' ? { ...h, status: 'disputed' as const } : h));
    expect(verifiedExposureCount(rejected)).toBe(2);
    const unchecked = (await runOsintScan(contact, {})).hexagons;
    expect(verifiedExposureCount(unchecked)).toBe(1);        // only the name Meta gave us
  });
});
