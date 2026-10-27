// MPC-7902 client for the proof-of-possession handshake (webhook-receiver Worker, workers/webhook-receiver/pop.ts).
// The server mints the session token and the code; this file only carries them. The token is a bearer secret: keep it in memory,
// never in a URL, log line, analytics event or storage. Unset API address = feature not deployed = nothing is sent.
const BASE = ((import.meta.env.VITE_DEEP_DIVE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export const isPossessionApiConfigured = (base: string = BASE): boolean => !!base;

/** Wording shown with the code. Must match VERIFY_PROMPT in workers/webhook-receiver/pop.ts. */
export const POSSESSION_PROMPT = 'To protect privacy, verify that you control this number by sending this code to our WhatsApp bot.';

export interface PossessionChallenge { session_token: string; code: string; expires_at: number; whatsapp_link: string | null }
export type ChallengeResult = { ok: true; challenge: PossessionChallenge } | { ok: false; reason: 'not_configured' | 'disabled' | 'rate_limited' | 'bad_target' | 'unavailable' };

/** Asks for a code. `consent` must be true: the caller shows the consent wording and passes the person's explicit answer. */
export async function requestChallenge(target: string | undefined, consent: boolean, fetchImpl: typeof fetch = fetch, base: string = BASE): Promise<ChallengeResult> {
  if (!base) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${base}/api/pop/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, consent }) });
    if (res.status === 403) return { ok: false, reason: 'disabled' };          // flag OFF: there is no unverified alternative
    if (res.status === 429) return { ok: false, reason: 'rate_limited' };
    if (res.status === 400) return { ok: false, reason: 'bad_target' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const j = await res.json();
    if (typeof j?.session_token !== 'string' || typeof j?.code !== 'string') return { ok: false, reason: 'unavailable' };
    return { ok: true, challenge: { session_token: j.session_token, code: j.code, expires_at: Number(j.expires_at) || 0, whatsapp_link: typeof j.whatsapp_link === 'string' ? j.whatsapp_link : null } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** True only when the server says this session is bound to a sender. Any error is "not verified". */
export async function isVerified(sessionToken: string, fetchImpl: typeof fetch = fetch, base: string = BASE): Promise<boolean> {
  if (!base || !sessionToken) return false;
  try {
    const res = await fetchImpl(`${base}/api/pop/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken }) });
    return res.ok && (await res.json())?.verified === true;
  } catch {
    return false;
  }
}
