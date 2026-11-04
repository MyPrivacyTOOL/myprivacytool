// Maps an email breach lookup (osintLookup.ts) to hexagon findings for the identity confirmation loop.
// Confidence mapping, from the lookup's own `confidence`:
//   high   (HIBP: names, dates, data classes)   -> status 'checked', 0.95  (user may dispute)
//   medium (XposedOrNot: breach names only)     -> status 'guess',   0.60  (user must confirm)
//   low                                         -> status 'guess',   0.40
// A lookup that was not checked gives one 'not_checked' finding, never an empty "all clear".
// A checked lookup with no breaches gives no findings: this status model has no "clear" state to show.
import type { Hexagon } from '@/types/hexagon';
import type { OsintLookupResult, BreachProvider } from './osintLookup';

type Lookup = Pick<OsintLookupResult, 'status' | 'breaches' | 'pastes' | 'pasteCount' | 'confidence'>;

const SCORE = { high: 0.95, medium: 0.6, low: 0.4 } as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';

function remediationFor(dataClasses: string[]): string {
  return dataClasses.some((c) => /password/i.test(c))
    ? 'Change the password on this service and anywhere you reused it; turn on two-factor sign-in.'
    : 'Watch for phishing that mentions this service, and use a separate email alias for sign-ups.';
}

export function breachFindingsFromLookup(lookup: Lookup, source: BreachProvider | null = null): Hexagon[] {
  if (lookup.status !== 'checked') {
    return [{
      id: 'email-breaches', pillar: 'email', label: 'Email breaches', status: 'not_checked',
      data: null, source, remediation: null,
    }];
  }
  const confidence_score = SCORE[lookup.confidence] ?? SCORE.low;
  const status = lookup.confidence === 'high' ? 'checked' : 'guess';
  const seen = new Map<string, number>();
  const findings: Hexagon[] = lookup.breaches.map((b) => {
    const base = `breach-${slug(b.name)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const year = b.date ? ` (${b.date.slice(0, 4)})` : '';
    const classes = b.dataClasses.length ? `: ${b.dataClasses.join(', ')}` : '';
    return {
      id: n === 1 ? base : `${base}-${n}`,
      pillar: 'email',
      label: b.name,
      status,
      data: `${b.name}${year}${classes}`,
      source,
      confidence_score,
      remediation: remediationFor(b.dataClasses),
    };
  });
  if (lookup.pasteCount > 0) {
    findings.push({
      id: 'email-pastes', pillar: 'email', label: 'Public pastes', status,
      data: `${lookup.pasteCount} public paste${lookup.pasteCount === 1 ? '' : 's'} listing this email`,
      source, confidence_score,
      remediation: 'Watch for phishing and spam; a paste cannot be taken back, so change any password you used here.',
    });
  }
  return findings;
}
