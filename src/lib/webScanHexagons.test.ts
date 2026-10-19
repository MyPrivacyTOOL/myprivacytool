import { describe, it, expect } from 'vitest';
import { fromWebScan } from './webScanHexagons';
import { HEXAGONS, HEXAGON_COUNT, HEXAGON_GROUPS } from '../../shared/hexagon-registry/registry.js';
import { isEstimate } from '../../shared/hexagon-registry/status.js';
import { groupHexagons } from './hexagonGroups';
import type { HexagonData } from '@/lib/deviceDetection';

const scanned = (id: string, value: string, o: Partial<HexagonData> = {}): HexagonData => ({
  id, label: id, value, icon: '•', confidence: 80, risk: '', confirmed: false, ...o,
});
const estimateId = HEXAGONS.find((h) => isEstimate(h.id))!.id;
const measuredId = HEXAGONS.find((h) => !isEstimate(h.id) && h.id !== 'connection' && h.truth.level === 'measured')!.id;
const get = (list: ReturnType<typeof fromWebScan>, id: string) => list.find((h) => h.id === id)!;

describe('fromWebScan', () => {
  it('always returns all 54 registry hexagons in the registry groups, even for an empty scan', () => {
    const list = fromWebScan([]);
    expect(list).toHaveLength(HEXAGON_COUNT);
    expect(list.every((h) => h.status === 'not_checked' && h.data === null)).toBe(true);
    expect(groupHexagons(list).map((g) => g.title)).toEqual(HEXAGON_GROUPS);
  });
  it('a detector that returned a placeholder stays not scanned', () => {
    expect(get(fromWebScan([scanned(measuredId, 'Unknown')]), measuredId).status).toBe('not_checked');
  });
  it('a measured finding is checked and shows its value; an estimate becomes a guess to confirm', () => {
    const list = fromWebScan([scanned(measuredId, 'Chrome 141'), scanned(estimateId, 'London (en-GB)', { confidence: 60 })]);
    expect(get(list, measuredId)).toMatchObject({ status: 'checked', data: 'Chrome 141', exposure: false, confidence_score: 0.8 });
    expect(get(list, estimateId)).toMatchObject({ status: 'guess', data: 'London (en-GB)', exposure: true, confidence_score: 0.6 });
  });
  it('shows the display text when there is one, and an answer the visitor already gave stays confirmed', () => {
    const list = fromWebScan([scanned(estimateId, 'raw value', { displayValue: 'Nice text', confirmed: true })]);
    expect(get(list, estimateId)).toMatchObject({ status: 'confirmed', data: 'Nice text' });
  });
  it('attaches the remediation step and cleans control characters and length from captured text', () => {
    const list = fromWebScan([scanned(estimateId, 'a\u0000b' + 'x'.repeat(300))]);
    const h = get(list, estimateId);
    expect(h.data).toBe('a b' + 'x'.repeat(117));
    expect(h.remediation).toEqual(expect.any(String));
  });
});

describe('fromWebScan tile kinds (honest look)', () => {
  const find = (pred: (h: (typeof HEXAGONS)[number]) => boolean) => HEXAGONS.find(pred)!.id;
  it('every hexagon gets a kind, and an unscanned one is never "clear"', () => {
    const list = fromWebScan([]);
    expect(list.every((h) => !!h.tile && h.tile !== 'clear')).toBe(true);
    expect(list.filter((h) => h.tile === 'cant_check_here').length).toBe(HEXAGONS.filter((h) => h.truth.level === 'cannot_be_checked').length);
  });
  it('a measured low-sensitivity finding is "seen", not clear; a guess is our guess; a medium measured finding needs fixing', () => {
    const lowId = find((h) => h.truth.level === 'measured' && h.truth.sensitivity === 'low' && h.status.kind === 'informational' && h.id !== 'connection');
    const medId = 'canvas-fingerprint';
    const list = fromWebScan([scanned(lowId, 'Chrome 141'), scanned(estimateId, 'London (en-GB)', { confidence: 60 }), scanned(medId, 'Dune Pine')]);
    expect(get(list, lowId).tile).toBe('seen_low_risk');
    expect(get(list, estimateId).tile).toBe('our_guess');
    expect(get(list, medId).tile).toBe('needs_fixing');
  });
});
