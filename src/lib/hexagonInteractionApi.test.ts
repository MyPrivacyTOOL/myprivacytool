import { describe, expect, it, vi } from 'vitest';
import { sendHexagonInteraction } from './hexagonInteractionApi';

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
