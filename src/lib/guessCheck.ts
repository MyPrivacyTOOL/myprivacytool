// Guess check (prototype). A guess is only worth showing if it can be made 100% true or shown wrong. For Location the guess comes from the
// visitor's IP address, so two things can settle it: the visitor's own answer ("Are you in X?", their word) and, if they allow it, their
// device's own position compared with the IP's (an independent check). Nothing here is sent anywhere or stored.

export interface GuessCheckSpec {
  /** The question, given the tile's value ("Springfield, Exampleshire"). */
  question: (value: string) => string;
  yes: string;
  no: string;
  /** Can the visitor's device settle it? */
  deviceCheck: boolean;
}

export const GUESS_CHECKS: Record<string, GuessCheckSpec> = {
  location: {
    question: (value) => `Are you in ${value}?`,
    yes: 'Yes',
    no: "No, I'm somewhere else",
    deviceCheck: true,
  },
};

export const guessCheckFor = (id: string): GuessCheckSpec | undefined => GUESS_CHECKS[id];

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// IP lookups name a city or its provider's hub, so "agrees" is generous: within a metro area. Beyond a few hundred km the guess is a miss.
export const AGREES_KM = 50;
export const NEAR_KM = 300;

export type DeviceVerdict = 'agrees' | 'near' | 'far';
export interface DeviceCheckResult {
  verdict: DeviceVerdict;
  km: number;
}

export function compareDeviceToGuess(device: LatLon, guess: LatLon): DeviceCheckResult {
  const km = Math.round(haversineKm(device, guess));
  return { verdict: km <= AGREES_KM ? 'agrees' : km <= NEAR_KM ? 'near' : 'far', km };
}

export function deviceCheckMessage(r: DeviceCheckResult): string {
  if (r.verdict === 'agrees') return `Your device agrees: it puts you about ${r.km} km from our guess.`;
  if (r.verdict === 'near') return `Your device puts you about ${r.km} km from our guess. Close, but not the same place.`;
  return `Your device puts you about ${r.km} km from our guess, so our guess was wrong.`;
}

export type DeviceCheckError = 'denied' | 'unavailable' | 'timeout';

export const DEVICE_CHECK_ERROR_TEXT: Record<DeviceCheckError, string> = {
  denied: "You didn't allow it, so we can't check. Your answer above still counts as your word.",
  unavailable: "Your device couldn't give a position, so we can't check this way.",
  timeout: 'Your device took too long to answer, so we stopped.',
};

/** Ask the browser for the device position (it shows its own permission prompt). Never called without a click. */
export function requestDevicePosition(geo: Pick<Geolocation, 'getCurrentPosition'> | undefined, timeoutMs = 10000): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (!geo) return reject('unavailable' as DeviceCheckError);
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject((e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable') as DeviceCheckError),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: timeoutMs }
    );
  });
}
