// MPC-7915 slice 3 (browser): sends "shown" and answer events about a tile to the Worker, so the counting in aggregate.ts has something to count.
// Design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3
//
// OFF unless the build sets VITE_LEARNING_EVENTS to "true" (also "1", "on", "yes"). Nothing is read from the address bar, so nobody can turn it on
// for a visitor. Even when on, nothing is sent unless (a) an API address is set, and (b) the visitor has made a choice in the consent layer and
// granted at least one purpose (`hasConsent`, the gate the site already uses for analytics scripts). The Worker has its own switch too.
// What is sent: a random id the browser makes (no account, phone or email), the hexagon id, which look the tile had, the confidence shown, and
// the answer. NEVER the finding's value. Sending never throws and never changes what the visitor sees.
import { hasConsent } from '@/lib/cookieConsent';
import type { Answer } from '@/lib/learning/aggregate';

export const PERSON_KEY_STORAGE = 'mpt_learning_person';
export const CONFIG_VERSION = 0;

const ON = ['true', '1', 'on', 'yes'];
export const learningEventsEnabled = (raw: unknown = import.meta.env.VITE_LEARNING_EVENTS): boolean =>
  typeof raw === 'string' && ON.includes(raw.trim().toLowerCase());

const apiBase = (): string =>
  String(((import.meta.env.VITE_LEARNING_API_URL as string | undefined) ?? (import.meta.env.VITE_DEEP_DIVE_API_URL as string | undefined)) ?? '')
    .trim().replace(/\/+$/, '');

const randomId = (bytes: number): string => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The visitor's random id, made the first time it is needed and kept in this browser only. Null when storage is blocked (then nothing is sent). */
export function getPersonKey(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): string | null {
  try {
    if (!storage) return null;
    const existing = storage.getItem(PERSON_KEY_STORAGE);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const made = randomId(18);   // 24 characters
    storage.setItem(PERSON_KEY_STORAGE, made);
    return made;
  } catch {
    return null;
  }
}

// One scan window per page load: a reload is a new scan.
const SCAN_WINDOW = (() => { try { return randomId(9); } catch { return 'w0'; } })();
const sentShown = new Set<string>();

export interface TileInfo {
  hexagonId: string;
  /** Which look the tile had (the honest tile kind), or null. */
  tileKind: string | null;
  /** The confidence shown, 0..1, or null. */
  confidence: number | null;
  source?: string;
}

interface Deps {
  enabled?: boolean;
  consent?: boolean;
  base?: string;
  personKey?: string | null;
  fetchImpl?: typeof fetch;
}

async function send(body: Record<string, unknown>, d: Deps): Promise<boolean> {
  const enabled = d.enabled ?? learningEventsEnabled();
  if (!enabled) return false;
  const base = d.base ?? apiBase();
  if (!base) return false;
  if (!(d.consent ?? hasConsent())) return false;
  const personKey = d.personKey === undefined ? getPersonKey() : d.personKey;
  if (!personKey) return false;
  try {
    const res = await (d.fetchImpl ?? fetch)(`${base}/api/learning/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, person_key: personKey, scan_window: SCAN_WINDOW, config_version: CONFIG_VERSION }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

const fields = (t: TileInfo) => ({
  hexagon_id: t.hexagonId,
  source: t.source ?? 'web-scan',
  tile_kind: t.tileKind,
  confidence_at_display: t.confidence === null ? null : Math.min(1, Math.max(0, t.confidence)),
});

/** A tile that offers an answer was put on screen. Sent once per tile per page load. */
export function recordShown(t: TileInfo, d: Deps = {}): Promise<boolean> {
  if (sentShown.has(t.hexagonId)) return Promise.resolve(false);
  sentShown.add(t.hexagonId);
  return send({ event_type: 'shown', ...fields(t) }, d);
}

/** The visitor pressed one of a tile's answer buttons. A plain tap, or closing a prompt, is never sent. */
export function recordAnswer(t: TileInfo, answer: Answer, d: Deps = {}): Promise<boolean> {
  return send({ event_type: 'answer', ...fields(t), answer }, d);
}

/** For tests: forget which tiles were reported as shown. */
export const resetShownForTests = () => sentShown.clear();
