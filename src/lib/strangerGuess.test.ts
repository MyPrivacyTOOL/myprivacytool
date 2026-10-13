import { describe, it, expect } from 'vitest';
import { generateFindings, detectInAppBrowser, MAX_FINDINGS } from './strangerGuess';
import type { DeviceData, HexagonData } from './deviceDetection';

const dd = (over: Record<string, unknown> = {}): DeviceData => ({
  location: { city: 'Springfield', region: 'Exampleshire', country: 'GB', latitude: 0, longitude: 0 },
  device: { type: 'Mobile', os: 'iOS', browser: 'Safari', browserVersion: '17' },
  language: { languages: ['en-GB'], primaryLanguage: 'en', fallbackLanguages: [], locale: 'en-GB', hasLocationMismatch: false, mismatchDetails: null },
  ...over,
}) as unknown as DeviceData;
const hex = (id: string, value: string): HexagonData => ({ id, label: id, value, icon: '', confidence: 1, risk: '', confirmed: false });
const BAD = /we know|critical|danger|attacker|%/i;

describe('stranger guess findings (CK-7805)', () => {
  it('detects in-app browsers from the user agent only', () => {
    expect(detectInAppBrowser('Mozilla/5.0 Mobile [FBAN/FBIOS;FBAV/400]')).toBe('Facebook');
    expect(detectInAppBrowser('Mozilla/5.0 Instagram 300.0')).toBe('Instagram');
    expect(detectInAppBrowser('Mozilla/5.0 (iPhone) Safari/604.1')).toBeNull();
  });
  it('region finding is likely when nothing disagrees, with evidence', () => {
    const f = generateFindings({ deviceData: dd(), hexagons: [], userAgent: 'x' }).find((x) => x.id === 'region')!;
    expect(f.band).toBe('likely');
    expect(f.evidence.join(' ')).toContain('Springfield');
  });
  it('region finding drops to possible on a language mismatch and to long-shot on VPN signs', () => {
    const mism = dd({ language: { hasLocationMismatch: true, mismatchDetails: 'Your language is French but your address is in the UK.' } });
    expect(generateFindings({ deviceData: mism, hexagons: [], userAgent: 'x' }).find((x) => x.id === 'region')!.band).toBe('possible');
    const vpn = generateFindings({ deviceData: dd(), hexagons: [hex('webrtc-leak', 'VPN Protected')], userAgent: 'x' }).find((x) => x.id === 'region')!;
    expect(vpn.band).toBe('long-shot');
    expect(vpn.evidence.join(' ')).toContain('may be passing through a VPN');
  });
  it('omits the language finding without a mismatch and the in-app finding without an app', () => {
    const ids = generateFindings({ deviceData: dd(), hexagons: [], userAgent: 'Mozilla Safari' }).map((f) => f.id);
    expect(ids).not.toContain('language-mismatch');
    expect(ids).not.toContain('in-app-browser');
  });
  it('returns at most 3 findings, each with evidence, a band and calm wording', () => {
    const d = dd({ language: { hasLocationMismatch: true, mismatchDetails: 'Language and place differ.' } });
    const f = generateFindings({ deviceData: d, hexagons: [], userAgent: 'Instagram' });
    expect(f.length).toBeLessThanOrEqual(MAX_FINDINGS);
    for (const x of f) {
      expect(x.evidence.length).toBeGreaterThan(0);
      expect(['likely', 'possible', 'long-shot']).toContain(x.band);
      expect(`${x.claim} ${x.evidence.join(' ')} ${x.action}`).not.toMatch(BAD);
    }
  });
  it('names the operating system without a version number', () => {
    const d = dd({ device: { type: 'Desktop', os: 'macOS 10.15.7', browser: 'Chrome', browserVersion: '1' } });
    const f = generateFindings({ deviceData: d, hexagons: [], userAgent: 'x' }).find((x) => x.id === 'device-class')!;
    expect(f.claim).toBe('You are probably on a computer running macOS.');
  });
  it('returns nothing when there is no data', () => {
    expect(generateFindings({ hexagons: [], userAgent: '' })).toEqual([]);
  });
});
