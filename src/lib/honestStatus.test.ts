// MPC-7558: the cheap detector fixes from the hexagon registry (Table 3), one test per status the visitor can see.
import { describe, it, expect } from 'vitest';
import { generateHexagons, generateHexagonsAsync, type DeviceData } from './deviceDetection';
import { captureStatus } from '../../shared/hexagon-registry/status.js';
import { toTile } from './hexagonTile';

const base = (over: Partial<DeviceData['privacy']> = {}, referrer = 'Direct') =>
  ({
    ip: '203.0.113.7',
    location: { city: 'Testville', region: 'TS', country: 'Testland', latitude: 1, longitude: 2 },
    device: { type: 'Desktop', os: 'Windows 11', browser: 'Chrome', browserVersion: '141.0' },
    network: { isp: 'Example ISP', connectionType: 'Unknown' },
    screen: { resolution: '1920×1080', colorDepth: 24 },
    session: { timezone: 'UTC', language: 'en-GB', referrer, timestamp: '2026-01-01T00:00:00Z' },
    privacy: { doNotTrack: false, doNotTrackSupported: true, cookiesEnabled: true, ...over },
    language: { primaryLanguage: 'en-GB', languages: ['en-GB'], fallbackLanguages: [], hasLocationMismatch: false },
    orientation: { isPortrait: false, angle: 0 },
    motion: null,
    sensors: { gyroscope: false },
  }) as unknown as DeviceData;

const value = (hs: { id: string; value: string }[], id: string) => hs.find((h) => h.id === id)?.value;

describe('honest on-screen status (MPC-7558)', () => {
  it('Do Not Track: a browser without the setting is not checked, not "disabled"', () => {
    const v = value(generateHexagons(base({ doNotTrack: false, doNotTrackSupported: false })), 'privacy')!;
    expect(v).toBe('Not available');
    expect(captureStatus('privacy', v)).toBe('not_checked');
  });

  it('Do Not Track: a browser that has the setting keeps its real answer', () => {
    expect(value(generateHexagons(base()), 'privacy')).toBe('DNT Disabled');
    expect(captureStatus('privacy', 'DNT Disabled')).toBe('found');
  });

  it('referrer: an empty referrer is worded as direct OR hidden, never as a certain direct visit', () => {
    expect(value(generateHexagons(base({}, 'Direct')), 'referrer')).toBe('Direct or hidden');
  });

  it('connection: with no Network Information API the value is not an assumed WiFi', () => {
    const v = value(generateHexagons(base()), 'connection')!;
    expect(v).not.toBe('WiFi');
    expect(captureStatus('connection', v)).toBe('not_checked');
  });

  it('battery: without the battery API the hexagon is present and not checked, not silently absent', async () => {
    const hs = await generateHexagonsAsync(base());
    const v = value(hs, 'battery');
    expect(v).toBe('Not available');
    expect(captureStatus('battery', v!)).toBe('not_checked');
  });

  it('a not-checked hexagon never shows its placeholder on the honest tile', () => {
    const t = toTile({ id: 'privacy', value: 'Not available' }, {});
    expect(t.showValue).toBe(false);
  });
});
