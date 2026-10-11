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
 * MPC-7488: the consentmanager.net purpose that covers saving the visitor's scan. Its id (for a custom purpose, "c" plus the
 * number the consent tool shows, e.g. "c12") is set at build time in VITE_SCAN_SAVE_CONSENT_PURPOSE. Until Chris creates the
 * purpose and sets the id, this is empty and no scan is saved for anyone.
 */
export const scanSavePurposeId = (): string => String(import.meta.env.VITE_SCAN_SAVE_CONSENT_PURPOSE ?? "").trim();

/**
 * True only when the visitor has made a choice AND accepted the specific purpose that covers saving their scan. Accepting any
 * other purpose (analytics, marketing...) is not enough. False when the purpose id is not configured, the CMP is missing,
 * still loading or errors.
 */
export function hasScanSaveConsent(): boolean {
  try {
    const id = scanSavePurposeId();
    if (!id || typeof window === "undefined" || typeof window.__cmp !== "function") return false;
    const data = (window.__cmp as unknown as (c: string) => CmpData | undefined)("getCMPData");
    return !!data?.userChoiceExists && data.purposeConsents?.[id] === true;
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
