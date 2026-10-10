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

type CmpData = { userChoiceExists?: boolean; purposeConsents?: Record<string, boolean> };

/**
 * True once the visitor has made a choice in the consentmanager.net layer and
 * granted at least one purpose. Defaults to false (no consent) whenever the CMP
 * is missing, still loading or errors, so third-party scripts stay off.
 */
export function hasConsent(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.__cmp !== "function") return false;
    const data = (window.__cmp as unknown as (c: string) => CmpData | undefined)("getCMPData");
    const purposes = data?.purposeConsents;
    return !!data?.userChoiceExists && !!purposes && Object.values(purposes).some(Boolean);
  } catch {
    return false;
  }
}

/**
 * Calls `cb` whenever the visitor saves a consent choice. Returns an
 * unsubscribe function. A no-op if the CMP has not loaded.
 */
export function onConsentChange(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.__cmp !== "function") return () => {};
  try {
    window.__cmp("addEventListener", ["consent", cb, false], null);
  } catch {
    return () => {};
  }
  return () => {
    try {
      window.__cmp?.("removeEventListener", ["consent", cb, false], null);
    } catch {
      /* ignore */
    }
  };
}
