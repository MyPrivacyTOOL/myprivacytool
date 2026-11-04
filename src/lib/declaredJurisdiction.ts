// MPC-8745: the jurisdiction the visitor DECLARES, held in memory for this page view only. Region-specific fix text is chosen from this
// and nothing else: never from a phone country code, never from the internet address (MPC-8733). Not stored, not sent anywhere.
import { useSyncExternalStore } from 'react';
import { JURISDICTIONS, type Jurisdiction } from './hexagonFix';

let declared: Jurisdiction | null = null;
const listeners = new Set<() => void>();

export function getDeclaredJurisdiction(): Jurisdiction | null {
  return declared;
}

export function declareJurisdiction(value: string | null): void {
  declared = value && (JURISDICTIONS as readonly string[]).includes(value) ? (value as Jurisdiction) : null;
  listeners.forEach((l) => l());
}

export function useDeclaredJurisdiction(): [Jurisdiction | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getDeclaredJurisdiction,
    getDeclaredJurisdiction,
  );
  return [value, declareJurisdiction];
}

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  eu_eea: 'European Union / EEA',
  uk: 'United Kingdom',
  us_california: 'United States: California',
  us_other: 'United States: another state',
  hong_kong: 'Hong Kong',
  australia: 'Australia',
  other: 'Somewhere else',
};
