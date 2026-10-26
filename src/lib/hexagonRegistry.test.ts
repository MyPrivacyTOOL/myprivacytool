// MPC-7466: keeps the shared hexagon registry in step with the detection code and the website.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateHexagons, generateHexagonsAsync, type DeviceData } from './deviceDetection';
import {
  HEXAGONS, HEXAGON_COUNT, HEXAGON_ALWAYS_COUNT, HEXAGON_CONDITIONAL_COUNT, STATUSES, TRUTH_LEVELS, getHexagon, isKnownHexagonId,
} from '../../shared/hexagon-registry/registry.js';

const source = readFileSync(resolve(process.cwd(), 'src/lib/deviceDetection.ts'), 'utf8');
const codeIds = [...source.matchAll(/^\s+id: '([a-z-]+)',$/gm)].map(m => m[1]);

describe('hexagon registry', () => {
  it('lists exactly the hexagon ids the detection code can produce (54: 41 always, 13 conditional)', () => {
    expect(new Set(codeIds).size).toBe(codeIds.length);
    expect([...codeIds].sort()).toEqual(HEXAGONS.map(h => h.id).sort());
    expect(HEXAGON_COUNT).toBe(54);
    expect(HEXAGON_ALWAYS_COUNT).toBe(41);
    expect(HEXAGON_CONDITIONAL_COUNT).toBe(13);
  });

  it('has the required fields on every entry and leaves the trust score empty', () => {
    for (const h of HEXAGONS) {
      for (const k of ['id', 'label', 'group', 'captures', 'value_to_user', 'value_type'] as const) expect(h[k], `${h.id}.${k}`).toBeTruthy();
      expect(['always', 'conditional']).toContain(h.presence);
      expect(['yes', 'partly', 'no']).toContain(h.user_can_check);
      expect(TRUTH_LEVELS).toContain(h.truth.level);
      expect(h.trust_score).toBeNull();
      expect(h.status.allowed.every(s => STATUSES.includes(s))).toBe(true);
      expect(h.artwork.emoji).toBeTruthy();
    }
  });

  it('never allows CLEAR where the code cannot tell clear from not checked, and defaults those to NOT_CHECKED', () => {
    const flagged = HEXAGONS.filter(h => h.status.code_cannot_tell_clear_from_not_checked);
    expect(flagged).toHaveLength(29);
    for (const h of flagged) {
      expect(h.status.allowed).not.toContain('CHECKED_AND_CLEAR');
      expect(h.status.default).toBe('NOT_CHECKED');
      expect(h.status.detection_change_to_make_checkable, h.id).toBeTruthy();
    }
    for (const id of ['google-services', 'meta-services', 'microsoft-services', 'social-platforms', 'cross-site-identity']) {
      expect(getHexagon(id)!.truth.level).toBe('cannot_be_checked');
      expect(getHexagon(id)!.status.default).toBe('NOT_CHECKED');
    }
    expect(getHexagon('demographic')!.truth.level).toBe('estimated');
  });

  it('gives the website the same labels the registry holds', async () => {
    const data = {
      ip: 'Unknown',
      location: { city: 'Unknown', region: 'Unknown', country: 'Unknown', latitude: 0, longitude: 0 },
      device: { type: 'Desktop', os: 'Windows 11', browser: 'Chrome', browserVersion: '141.0' },
      network: { isp: 'Unknown ISP', connectionType: 'Unknown' },
      screen: { resolution: '1920×1080', colorDepth: 24 },
      session: { timezone: 'UTC', language: 'en-GB', referrer: 'Direct', timestamp: '2026-01-01T00:00:00Z' },
      privacy: { doNotTrack: false, cookiesEnabled: true },
      language: { primaryLanguage: 'en-GB', languages: ['en-GB'], fallbackLanguages: [], hasLocationMismatch: false },
      orientation: { isPortrait: false, angle: 0 },
      motion: null,
      sensors: { gyroscope: false },
    } as unknown as DeviceData;
    const sync = generateHexagons(data);
    expect(sync.length).toBeGreaterThan(0);
    for (const h of sync) {
      expect(isKnownHexagonId(h.id)).toBe(true);
      expect(h.label).toBe(getHexagon(h.id)!.label);
    }
    const labelsInCode = [...source.matchAll(/id: '([a-z-]+)',\s+label: '([^']+)'/g)];
    for (const [, id, label] of labelsInCode) expect(getHexagon(id)!.label, id).toBe(label);
    expect(typeof generateHexagonsAsync).toBe('function');
  });
});
