// How sure we are about a guess, as three bands in words (Chris approved the table on 2026-10-20; page:
// https://app.notion.com/p/3fe28547eaa78154a02deb9f89a43ade). NOT the registry's confidence numbers: those are one fixed number per hexagon, and
// several are plainly overstated by the registry's own notes (Location 95 while IP lookups often land on the provider's hub city).
// Each band is chosen from the registry's own notes and changes only when Chris approves a change. A number is never shown.
//   likely : a direct reading with a known way of working and little room to be wrong
//   maybe  : a lookup or rule that is often right but has a known way of being wrong
//   weak   : invented, or inferred from something that cannot be read
export type GuessBand = 'likely' | 'maybe' | 'weak';

export const BAND_WORD: Record<GuessBand, string> = { likely: 'likely', maybe: 'maybe', weak: 'weak' };

/** Fill strength of the purple guess tile. "Maybe" is the faint purple we already use; "likely" is a little darker, "weak" paler. */
export const BAND_FILL_OPACITY: Record<GuessBand, number> = { likely: 0.28, maybe: 0.16, weak: 0.08 };

// Every `estimated` hexagon in the registry has an entry (a test fails the build when a new one is added without one).
const FIXED: Record<string, GuessBand> = {
  location: 'maybe',                 // from the IP address; often lands on the provider's hub city, not the street
  isp: 'maybe',                      // an IP lookup can name a network owner (a VPN or office) rather than the home provider
  'language-mismatch': 'maybe',      // a comparison rule, not a measurement
  'user-profile': 'maybe',           // an inference from language settings
  'extension-detection': 'maybe',    // a heuristic; the failure fallback reads like a real clear result
  'fingerprint-protection': 'maybe', // each shield is a heuristic; "None Detected" is also the default when detection fails
  'browser-security': 'maybe',       // hard-coded version cut-offs that go stale
  demographic: 'weak',               // "an invented guess" in the registry, with a known operator-precedence bug
  'tls-config': 'weak',              // a browser cannot read the TLS version; the code guesses from the browser version
};

export const GUESS_BAND_IDS = [...Object.keys(FIXED), 'connection'];

/**
 * The band for a guess tile, or null for a hexagon that is not in the table (it keeps the plain faint look).
 * Connection Type is the one that depends on the scan: "likely" only when the browser itself reported the connection, otherwise the
 * "WiFi" on screen is an assumed default and it is a "maybe".
 */
export function guessBandFor(id: string, ctx: { connectionIsMeasured?: boolean } = {}): GuessBand | null {
  if (id === 'connection') return ctx.connectionIsMeasured ? 'likely' : 'maybe';
  return FIXED[id] ?? null;
}
