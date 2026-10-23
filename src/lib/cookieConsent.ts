// MPC-8450: our own cookie choice (replaces the consentmanager.net layer). One optional category: analytics (Google Analytics 4 and the
// HubSpot forms script). The choice lives only in this browser (localStorage), with the date; it is never sent to us.
// index.html reads the same key for the Google Analytics gate, so keep KEY and the shape in step with it.
export const CONSENT_KEY = "mpt_cookie_consent";
const CHANGED = "mpt:consent";
const OPEN = "mpt:consent-open";

export type ConsentChoice = { v: 1; analytics: boolean; at: string };

/** The stored choice, or null when the visitor has not chosen (or storage is unavailable or the value is not ours). */
export function getChoice(): ConsentChoice | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<ConsentChoice> | null;
    return c && c.v === 1 && typeof c.analytics === "boolean" && typeof c.at === "string" ? (c as ConsentChoice) : null;
  } catch {
    return null;
  }
}

/** Saves the visitor's choice and tells listeners (the banner closes, analytics scripts load or stop). */
export function setChoice(analytics: boolean): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics, at: new Date().toISOString() } satisfies ConsentChoice));
  } catch {
    /* storage blocked: the choice cannot be kept, so nothing optional will load next visit either */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * True only after the visitor chose "Accept analytics". Defaults to false (no consent) whenever there is no choice,
 * storage is blocked or the value is damaged, so optional scripts stay off.
 */
export function hasConsent(): boolean {
  return getChoice()?.analytics === true;
}

/** Calls `cb` whenever the visitor saves a choice. Returns an unsubscribe function. */
export function onConsentChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

/** Footer "Manage cookies": asks the banner to open again so the visitor can change their choice. */
export function openCookiePreferences(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN));
}

/** For the banner: calls `cb` when "Manage cookies" is pressed. */
export function onOpenPreferences(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN, cb);
  return () => window.removeEventListener(OPEN, cb);
}
