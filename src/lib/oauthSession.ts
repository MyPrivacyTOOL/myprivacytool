/**
 * Client for the OAuth Worker's session API (MPC-6971, docs/phase5-oauth-api-contract.md).
 * The Worker owns sign-in and the signed session cookie; the SPA only reads who is connected and asks to sign out.
 * Requests send the cookie (`credentials: "include"`); the Worker allows this origin via CORS.
 *
 * Privacy: ordinary visitors never sign in, so the site must not call the Worker on every page view. A small
 * localStorage hint, set only when the browser lands back from a sign-in (`?channel=google`), gates the call.
 */
export const OAUTH_URL: string =
  (import.meta.env.VITE_OAUTH_URL as string | undefined) ?? "https://myprivacytool-oauth-poc.myprivacytool.workers.dev";

export const OAUTH_START_URL = `${OAUTH_URL}/oauth/google/start?mode=session`;

const HINT_KEY = "mpt_oauth_hint";

export type SessionResult =
  | { status: "connected"; email: string; expiresAt: number | null }
  | { status: "disconnected" }
  | { status: "error" };

type FetchFn = typeof fetch;

// localStorage can throw (private windows, blocked site data); the feature must simply not appear then.
export function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSessionHint(): void {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* no storage: the badge will not show, sign-in itself is unaffected */
  }
}

export function clearSessionHint(): void {
  try {
    window.localStorage.removeItem(HINT_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the URL is the Worker's success redirect (`?channel=google`) and not a failure (`?oauth_error=`). */
export function isSignInReturn(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.get("channel") === "google" && !p.get("oauth_error");
}

export async function fetchSession(fetchFn: FetchFn = fetch): Promise<SessionResult> {
  try {
    const res = await fetchFn(`${OAUTH_URL}/v1/session`, { credentials: "include" });
    // 401 = no session, expired, or the browser withheld the cross-site cookie: all mean "not connected".
    if (res.status === 401) return { status: "disconnected" };
    if (!res.ok) return { status: "error" };
    const body = (await res.json()) as { authenticated?: boolean; user?: { email?: string }; expires_at?: string };
    if (!body.authenticated || typeof body.user?.email !== "string" || !body.user.email) return { status: "disconnected" };
    const exp = body.expires_at ? Date.parse(body.expires_at) : NaN;
    return { status: "connected", email: body.user.email, expiresAt: Number.isNaN(exp) ? null : exp };
  } catch {
    return { status: "error" };
  }
}

export async function signOut(fetchFn: FetchFn = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${OAUTH_URL}/v1/session`, { method: "DELETE", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}
