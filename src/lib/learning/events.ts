// MPC-7915 slice 3 (browser): sends "shown" and answer events about a tile to the Worker, which only adds 1 to an anonymous daily counter.
// Design: https://app.notion.com/p/3fe28547eaa781bbb748c984b7601dd3
//
// OFF unless the build sets VITE_LEARNING_EVENTS to "true" (also "1", "on", "yes"). Nothing is read from the address bar, so nobody can turn it on
// for a visitor. Even when on, nothing is sent unless (a) an API address is set, and (b) the visitor chose "Accept analytics" in our cookie banner
// (`hasConsent`, the same gate Google Analytics and the HubSpot forms script use; "Essential only", no choice, or blocked storage all send nothing).
// The Worker has its own switch too.
// What is sent (MPC-9892, Open Tracker design 4.5): the event type, the hexagon id and, for an answer, which button. NO person key, no scan window,
// no browser-made id of any kind, no tile look, no confidence, NEVER the finding's value. Nothing identifying is stored in this browser either.
// Sending never throws and never changes what the visitor sees.
import { hasConsent } from '@/lib/cookieConsent';
import type { Answer } from '@/lib/learning/aggregate';
import { recipientFetch } from '@/lib/recipientClient';

const ON = ['true', '1', 'on', 'yes'];
export const learningEventsEnabled = (raw: unknown = import.meta.env.VITE_LEARNING_EVENTS): boolean =>
  typeof raw === 'string' && ON.includes(raw.trim().toLowerCase());

const apiBase = (): string =>
  String(((import.meta.env.VITE_LEARNING_API_URL as string | undefined) ?? (import.meta.env.VITE_DEEP_DIVE_API_URL as string | undefined)) ?? '')
    .trim().replace(/\/+$/, '');

// A tile is reported as shown once per page load (kept in memory only; a reload counts again).
const sentShown = new Set<string>();

export interface TileInfo {
  hexagonId: string;
  /** Callers still pass these; they are NOT sent (MPC-9892). */
  tileKind?: string | null;
  confidence?: number | null;
  source?: string;
}

interface Deps {
  enabled?: boolean;
  consent?: boolean;
  base?: string;
  fetchImpl?: typeof fetch;
}

async function send(body: Record<string, unknown>, d: Deps): Promise<boolean> {
  const enabled = d.enabled ?? learningEventsEnabled();
  if (!enabled) return false;
  const base = d.base ?? apiBase();
  if (!base) return false;
  if (!(d.consent ?? hasConsent())) return false;
  try {
    const res = await recipientFetch('learning-events', `${base}/api/learning/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }, ['page_load'], d.fetchImpl ? { fetchImpl: d.fetchImpl } : {});
    return res.ok;
  } catch {
    return false;
  }
}

const fields = (t: TileInfo) => ({ hexagon_id: t.hexagonId });

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
