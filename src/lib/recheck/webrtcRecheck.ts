// CK-8494: one verified customer action and re-check, for the WebRTC Leak hexagon on the existing web scan journey.
//   observation -> explanation -> considered response -> user action -> comparable re-check
// Everything lives in the visitor's own browser (localStorage), only with the analytics choice (`hasConsent`, the same gate the learning events use),
// for 7 days at most. Nothing here is sent anywhere and no address is ever stored: only the distinct outcome (WebRTCState), the detector version
// and a coarse browser family. The original observation is never overwritten; the re-check, the visitor's own word and the comparison are
// kept as separate fields. A higher or "clearer" reading is never called a privacy improvement unless the two readings are comparable.
import { hasConsent, getChoice } from '@/lib/cookieConsent';
import type { WebRTCState } from '@/lib/fingerprintDetection';

export const RECHECK_KEY = 'mpt_recheck_v1';
export const RECHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RECHECKS = 5;
export const HEXAGON_ID = 'webrtc-leak';

export interface Observation {
  state: WebRTCState;
  detectorVersion: string;
  /** Coarse browser family (a setting change cannot be compared across browsers). */
  browser: string;
  observedAt: string;
}

export type RecheckOutcome = 'improvement' | 'no_change' | 'inconclusive' | 'incomparable' | 'error';
export interface Comparison { outcome: RecheckOutcome; reason: string }
export interface RecheckEntry { observation: Observation; comparison: Comparison; at: string }

export interface RecheckRecord {
  v: 1;
  hexagonId: typeof HEXAGON_ID;
  /** The original observation. Written once, never replaced. */
  baseline: Observation;
  explanationShownAt: string;
  /** The visitor's own word that they did the step. Not proof. Absent when they closed the prompt or chose Later. */
  selfReport?: { at: string };
  rechecks: RecheckEntry[];
  /** The analytics choice this record was written under. */
  consent: { analytics: true; at: string };
  expiresAt: string;
}

export interface Deps {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  consent?: boolean;
  now?: () => Date;
}

const store = (d: Deps) => {
  if (d.storage !== undefined) return d.storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};
const nowOf = (d: Deps) => (d.now ? d.now() : new Date());
const consented = (d: Deps) => d.consent ?? hasConsent();

export function browserFamily(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/firefox\//i.test(ua)) return 'firefox';
  if (/edg\//i.test(ua)) return 'edge';
  if (/chrome\/|crios\//i.test(ua)) return 'chrome';
  if (/safari\//i.test(ua)) return 'safari';
  return 'other';
}

export function observationFrom(o: { state: string; detectorVersion: string }, d: Deps & { browser?: string } = {}): Observation {
  return { state: o.state as WebRTCState, detectorVersion: o.detectorVersion, browser: d.browser ?? browserFamily(), observedAt: nowOf(d).toISOString() };
}

/** The comparability rules, in one pure place. Only a found baseline and a none_found re-check by the same detector version in the same browser is an improvement. */
export function compare(baseline: Observation | null, recheck: Observation): Comparison {
  if (recheck.state === 'error') return { outcome: 'error', reason: 'The re-check itself failed, so it says nothing about the change.' };
  if (!baseline) return { outcome: 'incomparable', reason: 'There is no saved first reading to compare with.' };
  if (baseline.state !== 'found') return { outcome: 'incomparable', reason: 'The first reading did not show an address, so there is nothing to compare against.' };
  if (baseline.detectorVersion !== recheck.detectorVersion) return { outcome: 'incomparable', reason: 'The check changed since the first reading, so the two cannot be compared.' };
  if (baseline.browser !== recheck.browser) return { outcome: 'incomparable', reason: 'A different browser was used, so the two readings cannot be compared.' };
  switch (recheck.state) {
    case 'found': return { outcome: 'no_change', reason: 'The page could still see a public address this time.' };
    case 'none_found': return { outcome: 'improvement', reason: 'This time the page could not see a public address through WebRTC.' };
    default: return { outcome: 'inconclusive', reason: 'The check could not finish or was blocked, which is not the same as finding nothing.' };
  }
}

function parse(raw: string | null): RecheckRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<RecheckRecord> | null;
    if (!r || r.v !== 1 || r.hexagonId !== HEXAGON_ID || !r.baseline || typeof r.expiresAt !== 'string' || !Array.isArray(r.rechecks)) return null;
    return r as RecheckRecord;
  } catch { return null; }
}

/** Removes the record: withdrawal of the analytics choice, expiry, or the visitor starting over. */
export function purge(d: Deps = {}): void {
  try { store(d)?.removeItem(RECHECK_KEY); } catch { /* storage blocked: nothing was kept */ }
}

/** The saved journey, or null. Without the analytics choice, or past its date, it is deleted instead of returned. */
export function load(d: Deps = {}): RecheckRecord | null {
  const s = store(d);
  if (!s) return null;
  let raw: string | null = null;
  try { raw = s.getItem(RECHECK_KEY); } catch { return null; }
  if (raw === null) return null;
  const rec = parse(raw);
  if (!rec || !consented(d) || Date.parse(rec.expiresAt) <= nowOf(d).getTime()) { purge(d); return null; }
  return rec;
}

function write(rec: RecheckRecord, d: Deps): boolean {
  try { store(d)?.setItem(RECHECK_KEY, JSON.stringify(rec)); return !!store(d); } catch { return false; }
}

/** Keeps the first observation and the explanation. Never replaces an existing baseline. Only for a found reading, and only with consent. */
export function saveBaseline(o: Observation, d: Deps = {}): RecheckRecord | null {
  if (!consented(d) || o.state !== 'found') return null;
  const existing = load(d);
  if (existing) return existing;
  const choice = getChoice();
  const now = nowOf(d);
  const rec: RecheckRecord = {
    v: 1, hexagonId: HEXAGON_ID, baseline: o, explanationShownAt: now.toISOString(), rechecks: [],
    consent: { analytics: true, at: choice?.at ?? now.toISOString() },
    expiresAt: new Date(now.getTime() + RECHECK_TTL_MS).toISOString(),
  };
  return write(rec, d) ? rec : null;
}

/** "I've done this". Idempotent: a replay keeps the first time. Later and a closed prompt never call this, so they record no response. */
export function recordSelfReport(d: Deps = {}): RecheckRecord | null {
  const rec = load(d);
  if (!rec) return null;
  if (rec.selfReport) return rec;
  const next = { ...rec, selfReport: { at: nowOf(d).toISOString() } };
  return write(next, d) ? next : rec;
}

/** Compares a fresh reading with the saved baseline and keeps it beside the original. A re-check needs the visitor's own word first, and a replay of the same reading is ignored. */
export function recordRecheck(o: Observation, d: Deps = {}): { record: RecheckRecord | null; entry: RecheckEntry | null } {
  const rec = load(d);
  if (!rec || !rec.selfReport) return { record: rec, entry: null };
  const dup = rec.rechecks.find((r) => r.observation.observedAt === o.observedAt);
  if (dup) return { record: rec, entry: dup };
  if (rec.rechecks.length >= MAX_RECHECKS) return { record: rec, entry: null };
  const entry: RecheckEntry = { observation: o, comparison: compare(rec.baseline, o), at: nowOf(d).toISOString() };
  const next = { ...rec, rechecks: [...rec.rechecks, entry] };
  return { record: write(next, d) ? next : rec, entry };
}

/** What the visitor is told for each outcome. It says what was seen, never that the system changed anything, and never a score. */
export const OUTCOME_COPY: Record<RecheckOutcome, { headline: string; text: string }> = {
  improvement: {
    headline: 'This time, no public address was visible',
    text: 'You made the change, and when we looked again this page could not see a public address through WebRTC. That is one reading, in this browser, on this network, right now. It does not show your address is hidden everywhere, and a VPN or network change can alter it.',
  },
  no_change: {
    headline: 'No change that we can see',
    text: 'When we looked again, this page could still see a public address. The change may not have taken effect yet (some browsers need a restart), or it may not apply to this feature.',
  },
  inconclusive: {
    headline: "We couldn't tell",
    text: 'The second look was blocked or did not finish. That is not the same as finding nothing, so we make no claim either way. Try again.',
  },
  incomparable: {
    headline: "These two readings can't be compared",
    text: 'The first and second readings were taken in ways that do not match (a different browser or a changed check), so we cannot say whether anything changed.',
  },
  error: {
    headline: 'The re-check did not work',
    text: 'Something went wrong while looking again. This says nothing about whether your change worked.',
  },
};
