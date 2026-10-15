import { describe, expect, it } from 'vitest';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { remediationFor, remediationMap } from './remediationMapper';

describe('remediationMap', () => {
  it('has a step for every one of the 54 registry hexagons', () => {
    expect(HEXAGONS).toHaveLength(54);
    for (const h of HEXAGONS) expect(remediationMap[h.id], h.id).toBeTruthy();
  });
  it('has no entry for a hexagon that does not exist (hex_* ids are the phone channel)', () => {
    const known = new Set<string>([...HEXAGONS.map((h) => h.id)]);
    for (const id of Object.keys(remediationMap)) expect(known.has(id) || id.startsWith('hex_'), id).toBe(true);
  });
  it('gives the exact WhatsApp path for the profile photo', () => {
    expect(remediationFor('hex_contact_profile_pic')).toBe('Go to WhatsApp Settings > Privacy > Profile Photo > Select "My Contacts" or "Nobody".');
  });
  it('returns null for an unknown id instead of inventing a step', () => {
    expect(remediationFor('nope')).toBeNull();
  });
});
