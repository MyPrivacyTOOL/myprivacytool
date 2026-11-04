import { describe, expect, it } from 'vitest';
import { checkedExtraIds, collectWebExtras, deviceModel, edgeExtras, WEB_EXTRA_IDS } from './webExtras';
import { HEXAGON_CATALOGUE } from '../../shared/hexagon-registry/catalogue.js';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { footprintSummary } from '../../shared/hexagon-registry/footprint.js';
import { scanCounts } from '../../shared/hexagon-registry/counts.js';

// MPC-8689 pilot: the extra web hexagons. Stubbed fetch, no network.
const EDGE = { postal_code: 'SW1A', metro_code: '826', timezone: 'Europe/London', tcp_rtt_ms: 12, colo: 'LHR', asn: 64500, org: 'Example ISP', tls_ciphers_sha1: 'abcdef123456', tls_hello_length: 508, http_protocol: 'HTTP/2', is_eu: true, continent: 'EU', region_code: 'ENG', now: 1_000_000 };
const by = (l: { id: string; status?: string; value?: string }[], id: string) => l.find((x) => x.id === id)!;

describe('web extras', () => {
  it('are nine catalogue web items marked OK, still "new", outside the 54', () => {
    expect(WEB_EXTRA_IDS).toHaveLength(9);
    for (const id of WEB_EXTRA_IDS) expect(HEXAGON_CATALOGUE.find((h) => h.id === id && h.channel === 'web' && h.status === 'new' && h.access === 'OK')).toBeTruthy();
    expect(WEB_EXTRA_IDS.filter((id) => HEXAGONS.some((h: { id: string }) => h.id === id))).toEqual([]);
  });
  it('turn the Worker answer into plain results, all found, with the real values', () => {
    const l = edgeExtras(EDGE, { deviceTimeZone: 'Europe/London', nowMs: 1_000_000 });
    expect(l.map((x) => x.status)).toEqual(['found', 'found', 'found', 'found', 'found', 'found', 'found', 'found']);
    expect(by(l, 'web.postal_area').value).toContain('SW1A');
    expect(by(l, 'web.ip_timezone').value).toContain('agree');
    expect(by(l, 'web.network_distance').value).toContain('12 ms');
    expect(by(l, 'web.network_owner').value).toContain('AS64500');
    expect(by(l, 'web.tls_fingerprint').value).toContain('abcdef12…');
    expect(by(l, 'web.tls_fingerprint').value).not.toContain('abcdef123456');
    expect(by(l, 'web.eu_region').value).toContain('in the EU');
    expect(by(l, 'web.clock_skew').value).toContain('within a few seconds');
  });
  it('notice a timezone mismatch and a clock that is off', () => {
    const l = edgeExtras(EDGE, { deviceTimeZone: 'Asia/Hong_Kong', nowMs: 1_000_000 + 125_000 });
    expect(by(l, 'web.ip_timezone').value).toMatch(/Europe\/London.*Asia\/Hong_Kong.*VPN/);
    expect(by(l, 'web.clock_skew').value).toContain('125 seconds ahead');
  });
  it('say "not checked" for missing data, never "clear" or a guess; a missing postcode is clear', () => {
    const l = edgeExtras({ is_eu: null, now: 5 }, { nowMs: 5 });
    expect(by(l, 'web.postal_area').status).toBe('clear');
    for (const id of ['web.ip_timezone', 'web.network_distance', 'web.network_owner', 'web.tls_fingerprint', 'web.http_protocol', 'web.eu_region']) expect(by(l, id).status).toBe('not_checked');
    expect(edgeExtras(null).every((x) => x.status === 'not_checked' && x.reason)).toBe(true);
    expect(edgeExtras({ ...EDGE, is_eu: false }, {}).find((x) => x.id === 'web.eu_region')!.value).toContain('do not appear');
    expect(by(edgeExtras({ ...EDGE, now: undefined }, { nowMs: 1 }), 'web.clock_skew').status).toBe('not_checked');
  });
  it('device model: found when the browser shares it, not checked when it cannot (never clear)', async () => {
    const ua = { platform: 'Android', getHighEntropyValues: async () => ({ model: 'Pixel 7', platformVersion: '14.0.0', architecture: 'arm' }) };
    expect((await deviceModel(ua)).value).toMatch(/model Pixel 7.*Android 14\.0\.0.*arm processor/);
    expect((await deviceModel(null)).status).toBe('not_checked');
    expect((await deviceModel({})).status).toBe('not_checked');
    expect((await deviceModel({ getHighEntropyValues: async () => { throw new Error('denied'); } })).status).toBe('not_checked');
    expect((await deviceModel({ getHighEntropyValues: async () => ({}) })).status).toBe('clear');
  });
  it('collect: one call to our own Worker route, no third party, all nine in order', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify(EDGE)); }) as unknown as typeof fetch;
    const l = await collectWebExtras(fetchImpl, { deviceTimeZone: 'Europe/London', nowMs: 1_000_000, userAgentData: { getHighEntropyValues: async () => ({ model: 'x' }) } });
    expect(l.map((x) => x.id)).toEqual(WEB_EXTRA_IDS);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/whoami-extra$/);
    expect(urls[0]).not.toMatch(/ipify|ipapi|ipinfo/);
  });
  it('collect: a Worker outage gives not_checked for the edge ones and never throws', async () => {
    const l = await collectWebExtras((async () => { throw new Error('down'); }) as unknown as typeof fetch, { deviceTimeZone: 'x', userAgentData: null });
    expect(l).toHaveLength(9);
    expect(l.every((x) => x.status === 'not_checked')).toBe(true);
    expect(checkedExtraIds(l)).toEqual([]);
  });
  it('count as checked in the footprint, but change no approved number', () => {
    const l = edgeExtras(EDGE, { deviceTimeZone: 'Europe/London', nowMs: 1_000_000 });
    const s = footprintSummary([...HEXAGONS.map((h: { id: string }) => h.id), ...checkedExtraIds(l)]);
    expect(s.byChannel.find((c) => c.key === 'web')!.checked).toBe(62); // 54 + 8 edge extras (device model needs the browser)
    expect(scanCounts([]).total).toBe(54);
  });
});
