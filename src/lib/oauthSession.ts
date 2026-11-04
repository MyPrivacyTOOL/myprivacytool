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

export type SignInReturn = { kind: "success" } | { kind: "error"; message: string };

/** Maps the Worker's `?oauth_error=` codes to copy that is safe to show a visitor. Never echoes the raw code. */
export function friendlySignInError(code: string): string {
  switch (code) {
    case "access_denied":
      return "You cancelled the Google sign-in. Nothing was saved.";
    case "email_not_verified":
      return "That Google account's email isn't verified, so we couldn't sign you in.";
    case "insufficient_provider_scope":
      return "We need permission to see your email address to sign you in. Please try again and allow it.";
    case "missing_code":
      return "That sign-in link expired. Please try signing in again.";
    default:
      return "We couldn't finish signing you in. Please try again.";
  }
}

/**
 * Reads the Worker's redirect back to the site: `?channel=google` on success, plus `&oauth_error=<code>` on failure.
 * Both need `channel=google`, so an unrelated page that happens to carry `oauth_error` is ignored.
 */
export function parseSignInReturn(search: string): SignInReturn | null {
  const p = new URLSearchParams(search);
  if (p.get("channel") !== "google") return null;
  const code = p.get("oauth_error");
  return code ? { kind: "error", message: friendlySignInError(code) } : { kind: "success" };
}

/** The same query string without the sign-in markers, keeping every other parameter (e.g. UTM tags). */
export function stripSignInParams(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("channel");
  p.delete("oauth_error");
  const rest = p.toString();
  return rest ? `?${rest}` : "";
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
