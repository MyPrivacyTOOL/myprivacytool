import { describe, it, expect, vi } from 'vitest';
import { haversineKm, compareDeviceToGuess, deviceCheckMessage, requestDevicePosition, guessCheckFor, AGREES_KM, NEAR_KM } from './guessCheck';

const london = { lat: 51.5074, lon: -0.1278 };
const paris = { lat: 48.8566, lon: 2.3522 };

describe('guess check (Location)', () => {
  it('only Location has a check so far, and it can use the device', () => {
    expect(guessCheckFor('location')?.question('Springfield, England')).toBe('Are you in Springfield, England?');
    expect(guessCheckFor('location')?.deviceCheck).toBe(true);
    for (const id of ['isp', 'connection', 'demographic', 'user-profile', 'fingerprint-protection', 'browser']) expect(guessCheckFor(id)).toBeUndefined();
  });

  it('measures distance between two places', () => {
    expect(haversineKm(london, london)).toBe(0);
    expect(Math.round(haversineKm(london, paris))).toBeGreaterThan(330);
    expect(Math.round(haversineKm(london, paris))).toBeLessThan(350);
  });

  it('agrees within a metro area, near up to a few hundred km, far beyond', () => {
    expect(compareDeviceToGuess(london, { lat: 51.55, lon: -0.2 }).verdict).toBe('agrees');
    expect(compareDeviceToGuess(london, paris).verdict).toBe('far'); // ~344 km
    expect(compareDeviceToGuess(london, { lat: 52.4862, lon: -1.8904 }).verdict).toBe('near'); // Birmingham ~163 km
    expect(AGREES_KM).toBeLessThan(NEAR_KM);
  });

  it('says what it found in words, with no percentage', () => {
    for (const r of [compareDeviceToGuess(london, london), compareDeviceToGuess(london, { lat: 52.4862, lon: -1.8904 }), compareDeviceToGuess(london, paris)]) {
      expect(deviceCheckMessage(r)).not.toMatch(/%/);
    }
    expect(deviceCheckMessage(compareDeviceToGuess(london, paris))).toMatch(/our guess was wrong/);
  });

  it('turns the browser position callbacks into a position or a named reason', async () => {
    const ok = { getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition) };
    await expect(requestDevicePosition(ok)).resolves.toEqual({ lat: 1, lon: 2 });
    const err = (code: number) => ({ getCurrentPosition: (_s: PositionCallback, e?: PositionErrorCallback | null) => e?.({ code } as GeolocationPositionError) });
    await expect(requestDevicePosition(err(1))).rejects.toBe('denied');
    await expect(requestDevicePosition(err(3))).rejects.toBe('timeout');
    await expect(requestDevicePosition(err(2))).rejects.toBe('unavailable');
    await expect(requestDevicePosition(undefined)).rejects.toBe('unavailable');
  });

  it('never touches the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    compareDeviceToGuess(london, paris);
    await requestDevicePosition({ getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition) });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
