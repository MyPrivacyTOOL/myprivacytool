// MPC-8689: the Telegram to Web handoff, web side. Only runs when the page was opened with ?handoff=1 (the redirect after the one-time /f/<uuid> link).
// It asks the server which Telegram hexagons were checked and gets ids back, never values. The ids live in memory only: nothing is saved to storage,
// sent anywhere or put in a URL. No valid session (or any error) means no Telegram claim at all.
import { useEffect, useState } from 'react';

export interface TelegramHandoff { ids: string[]; scanAt: string | null }
const NONE: TelegramHandoff = { ids: [], scanAt: null };
const ID_RE = /^[a-z0-9_.-]{1,80}$/;

/** Parses the /api/footprint body. Anything unexpected becomes "nothing checked" so a bad answer can never add to the count. */
export function parseHandoff(body: unknown): TelegramHandoff {
  const ch = (body as { channels?: unknown } | null)?.channels;
  const tg = Array.isArray(ch) ? ch.find((c) => (c as { channel?: unknown })?.channel === 'telegram') : null;
  const ids = (tg as { checked_ids?: unknown } | null)?.checked_ids;
  if (!Array.isArray(ids)) return NONE;
  const scanAt = (tg as { scan_at?: unknown }).scan_at;
  return { ids: [...new Set(ids.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)))].slice(0, 400), scanAt: typeof scanAt === 'string' ? scanAt : null };
}

export const isHandoffRequest = (search: string): boolean => new URLSearchParams(search).get('handoff') === '1';

let cached: Promise<TelegramHandoff> | null = null;
function load(): Promise<TelegramHandoff> {
  cached ??= fetch('/api/footprint', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseHandoff)
    .catch(() => NONE);
  return cached;
}

export function useTelegramHandoff(): TelegramHandoff {
  const [value, setValue] = useState<TelegramHandoff>(NONE);
  useEffect(() => {
    if (typeof window === 'undefined' || !isHandoffRequest(window.location.search)) return;
    let live = true;
    load().then((v) => { if (live) setValue(v); });
    return () => { live = false; };
  }, []);
  return value;
}
