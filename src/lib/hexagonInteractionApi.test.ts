import { describe, expect, it, vi } from 'vitest';
import { fetchDeepDiveScan, fetchFinalScore, finalizeDeepDive, sendHexagonInteraction } from './hexagonInteractionApi';

const SCAN = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://dd.example';

describe('sendHexagonInteraction', () => {
  it('maps each outcome to the API action and posts scan_id + hexagon_id only', async () => {
    for (const [outcome, action] of [['confirmed', 'confirm'], ['rejected', 'reject'], ['disputed', 'dispute']] as const) {
      const f = vi.fn().mockResolvedValue({ ok: true });
      expect(await sendHexagonInteraction(SCAN, 'hex_contact_profile_pic', outcome, f as unknown as typeof fetch, BASE)).toBe(true);
      const [url, init] = f.mock.calls[0];
      expect(url).toBe('https://dd.example/api/scan/hexagon-interaction');
      expect(JSON.parse(init.body)).toEqual({ scan_id: SCAN, hexagon_id: 'hex_contact_profile_pic', action });
    }
  });
  it('resolves false, never throws, on a network failure or a refusal', async () => {
    expect(await sendHexagonInteraction(SCAN, 'h', 'confirmed', vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch, BASE)).toBe(false);
    expect(await sendHexagonInteraction(SCAN, 'h', 'confirmed', vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch, BASE)).toBe(false);
  });
  it('sends nothing without a base URL or a scan id', async () => {
    const f = vi.fn();
    expect(await sendHexagonInteraction(SCAN, 'h', 'confirmed', f as unknown as typeof fetch, '')).toBe(false);
    expect(await sendHexagonInteraction('', 'h', 'confirmed', f as unknown as typeof fetch, BASE)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('deep-dive reads', () => {
  it('fetch the scan and the score by scan_id, and finalize with a POST', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hexagons: [], finalized: false }) });
    expect(await fetchDeepDiveScan(SCAN, f as unknown as typeof fetch, BASE)).toEqual({ hexagons: [], finalized: false });
    expect(f.mock.calls[0][0]).toBe(`https://dd.example/api/scan/deep-dive?scan_id=${SCAN}`);
    await fetchFinalScore(SCAN, f as unknown as typeof fetch, BASE);
    expect(f.mock.calls[1][0]).toBe(`https://dd.example/api/scan/final-risk-score?scan_id=${SCAN}`);
    await finalizeDeepDive(SCAN, f as unknown as typeof fetch, BASE);
    expect(f.mock.calls[2][1].method).toBe('POST');
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ scan_id: SCAN });
  });
  it('return null on offline, a 404, or no base URL', async () => {
    expect(await fetchDeepDiveScan(SCAN, vi.fn().mockRejectedValue(new Error('x')) as unknown as typeof fetch, BASE)).toBeNull();
    expect(await fetchDeepDiveScan(SCAN, vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch, BASE)).toBeNull();
    expect(await fetchFinalScore(SCAN, vi.fn() as unknown as typeof fetch, '')).toBeNull();
  });
});
