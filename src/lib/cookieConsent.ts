declare global {
  interface Window {
    __cmp?: (command: string, parameter?: unknown, callback?: unknown) => void;
  }
}

/**
 * Reopens the consentmanager.net CMP preferences layer that's already loaded
 * in index.html. Guarded because the CMP script loads async and may not be
 * ready yet on first paint.
 */
export function openCookiePreferences() {
  if (typeof window !== "undefined" && typeof window.__cmp === "function") {
    window.__cmp("showConsentLayer");
  }
}
