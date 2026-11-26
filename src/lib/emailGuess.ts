// MPC-11111: the magic guess on /scan. Built SWITCHED OFF (VITE_EMAIL_GUESS_ENABLED must be exactly "true", and the Worker side must be on too).
// A bot's bridge link can carry a sealed token in its URL FRAGMENT (#g=...). The page reads it once, removes it from the address bar at once (so it is not copied,
// shared or kept in history), asks the scan-report Worker to open it, and if that returns an address the person published in their own public bio, offers it back
// ("Is this your main email?"). Nothing is stored in the browser; the address lives in component state for this visit only. See shared/email-guess.ts.
import { recipientFetch } from "@/lib/recipientClient";
import { resolveScanApiUrl } from "@/lib/webScan";

export const emailGuessEnabled = (): boolean => import.meta.env.VITE_EMAIL_GUESS_ENABLED === "true";

export interface EmailGuessAnswer {
  email: string;
  channel: string;
  confidence: number;
  basis: "bio_email";
}

// The token shape the Worker issues: "v1." + 12-byte IV (16 chars) + "." + the sealed body. Anything else in the fragment is ignored.
const TOKEN_SHAPE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,900}$/;
const LOOSE_EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,24}$/;

// React StrictMode runs an effect twice in development; the token is removed from the URL on the first read, so the first answer is kept for this page load.
let taken: string | null | undefined;
export const resetGuessTokenForTests = (): void => { taken = undefined; };

/** Reads the sealed token from `#g=` once, removes it from the address bar, and returns it (null when absent or not shaped like one). */
export function takeGuessToken(win: Window = window): string | null {
  if (taken !== undefined) return taken;
  const params = new URLSearchParams(win.location.hash.replace(/^#/, ""));
  const raw = params.get("g");
  if (raw === null) return null;   // nothing to remove; leave `taken` unset so a later navigation to a link with a token still works
  params.delete("g");
  const rest = params.toString();
  try { win.history.replaceState(win.history.state, "", win.location.pathname + win.location.search + (rest ? `#${rest}` : "")); } catch { /* the address bar keeps it; nothing else to do */ }
  taken = TOKEN_SHAPE.test(raw) ? raw : null;
  return taken;
}

/** Asks the Worker to open the token. Null for every kind of "no guess": off, expired, forged, offline, an unexpected answer. Never throws. */
export async function fetchEmailGuess(token: string, fetchImpl?: typeof fetch): Promise<EmailGuessAnswer | null> {
  const base = resolveScanApiUrl();
  if (!base) return null;
  try {
    // The sealed token carries an email address (encrypted), so the call declares the "email" data item. It happens BEFORE the visitor's scan consent click (they
    // have only opened a link), which the "scan-report" entry (post_click) refuses, so it has its own first-party pre_click entry, off until the privacy owner approves it.
    const res = await recipientFetch(
      "email-guess-service",
      `${base}/api/scan/guess`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" },
      ["email"],
      fetchImpl ? { fetchImpl } : {},
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { guess?: Partial<EmailGuessAnswer> | null } | null;
    const g = data?.guess;
    if (!g || typeof g.email !== "string" || !LOOSE_EMAIL.test(g.email) || g.email.length > 254) return null;
    if (g.basis !== "bio_email" || typeof g.channel !== "string" || typeof g.confidence !== "number" || g.confidence < 0.8) return null;
    return { email: g.email, channel: g.channel, confidence: g.confidence, basis: "bio_email" };
  } catch {
    return null;
  }
}
