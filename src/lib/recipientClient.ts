// MPC-9886 (Open Tracker rule 6, design 1.3 / 2.4): the browser's one door to the recipient wrapper. Every outbound call the SITE makes goes
// through recipientFetch / loadRecipientScript / createPeerConnection here, with a string-literal registry key at the call site (MPC-9884 checks that).
//
// Two things this module does that a bare call to the wrapper would not, both to keep today's behaviour exactly as it is until MPC-9888:
//
// 1. USER_ACTION_MARKER. The wrapper refuses a post_click recipient without a consent id (check 4). The id comes from the Scan me click (MPC-9887 /
//    MPC-9888). A recipient whose registry basis is user_action (a form submit, a connect button) may carry the fixed marker below INSTEAD, but only after
//    a real user action on the page (MPC-10790); scan_consent and analytics_consent recipients never get the marker. It is NOT evidence of scan consent.
//
// 2. Own-origin calls. A relative path such as /api/hk-geo is a call to the page's own origin. The registry names the production hosts, but a
//    developer's machine (localhost / 127.0.0.1) and a Cloudflare preview (*.pages.dev) are the same site. For a first-party key only, the host
//    the page itself was served from is accepted as that key's host; no other host is widened.
import {
  createPeerConnection as wrappedCreatePeerConnection,
  fetchRecipient,
  loadRecipientScript as wrappedLoadRecipientScript,
  RECIPIENTS,
  type DataItem,
  type RecipientContext,
  type RecipientRegistry,
} from "@/config/recipients";
import { getConsentId, getScanId } from "@/lib/scanConsent";
import { isLoopbackHost } from "../../shared/recipients/outbound";
import { recordRecipient } from "@/lib/recipientLog";

/**
 * MPC-9888 / MPC-10790: what proves a call may go, by the recipient's own registry entry (browserContext below):
 *   pre_click                      nothing (the registry names these as the exceptions: first-party service calls, Turnstile at its own click, fonts)
 *   scan_consent, analytics_consent  ONLY the real consent id the server issued at the Scan me click (src/lib/scanConsent.ts); with none, the wrapper refuses
 *   user_action                    the real id if there is one, else this fixed marker, but ONLY once a real person has acted on this page (a trusted
 *                                  click, tap, key press or submit, hasUserAction below). The marker is NOT evidence of scan consent and nothing
 *                                  server-side may read it as such: it only records that the call follows a person's own action.
 * Before 2026-11-24 every browser key except google-stun carried the marker from page load, so a ga4 / pwned-passwords / Turnstile-class call passed the
 * wrapper's consent check with no click at all.
 */
export const USER_ACTION_MARKER = "user-action:no-scan-consent";

/**
 * Which post_click recipients may carry the marker after a user action: the ones whose basis is the person's own action (user_action) or the service they asked
 * for (service: scan-report calls from the unsubscribe page, a Deep Research form, ...). Not scan_consent, not analytics_consent.
 * One named exception: "supabase" is registered as scan_consent (the Workers' database), but the browser also writes the /newsletter sign-up and the hk-spam
 * registration to it directly, each its own form submit. Those keep working on a trusted submit; the registry basis for browser-direct Supabase writes is
 * flagged on MPC-10790 for a decision, so this stays one line, not a pattern.
 */
const FORM_SUBMIT_KEYS = new Set(["supabase"]);
const markerBases = (r: { key: string; consent_basis: string }): boolean => r.consent_basis === "user_action" || r.consent_basis === "service" || FORM_SUBMIT_KEYS.has(r.key);

// A real user action on this page: a TRUSTED pointer, touch, click, Enter/Space or submit event (script-dispatched events are not trusted). Listens from the
// moment this module loads, capture phase and passive, so it sees the gesture before any handler that then makes the call.
let userActed = false;
const waiters: Array<() => void> = [];
const GESTURE_EVENTS = ["pointerdown", "click", "touchend", "submit", "keydown"] as const;
function noteGesture(e: Event): void {
  if (!e.isTrusted || userActed) return;
  if (e.type === "keydown") { const k = (e as KeyboardEvent).key; if (k !== "Enter" && k !== " ") return; }
  userActed = true;
  for (const w of waiters.splice(0)) w();
}
if (typeof window !== "undefined") for (const t of GESTURE_EVENTS) window.addEventListener(t, noteGesture, { capture: true, passive: true });

/** True once a real person has acted on this page (see above), or this journey holds the scan consent (the Scan me click is itself such an action). */
export const hasUserAction = (): boolean => userActed || getConsentId() !== null;
/** Resolves at once if hasUserAction(), else at the first real user action. For calls a page starts on arrival that need a person's action first. */
export function afterUserAction(): Promise<void> {
  if (hasUserAction()) return Promise.resolve();
  return new Promise((resolve) => { waiters.push(resolve); });
}
/** Tests only. */
export function __setUserActionForTests(v: boolean): void { userActed = v; if (v) for (const w of waiters.splice(0)) w(); }

const pageHost = (): string => (typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "");

/** The site's own origin: a loopback dev server, a Cloudflare preview, or a host the registry already lists for serving the site. */
export function isOwnOrigin(hostname: string = pageHost(), registry: RecipientRegistry = RECIPIENTS): boolean {
  if (!hostname) return false;
  if (isLoopbackHost(hostname) || hostname.endsWith(".pages.dev")) return true;
  const edge = registry.recipients.find((r) => r.key === "cloudflare-edge");
  return !!edge?.hosts.includes(hostname);
}

/** A copy of the registry in which `key` also accepts `host`. Only ever called for the page's own origin. */
function withOwnHost(key: string, host: string, registry: RecipientRegistry): RecipientRegistry {
  return { ...registry, recipients: registry.recipients.map((r) => (r.key === key && !r.hosts.includes(host) ? { ...r, hosts: [...r.hosts, host] } : r)) };
}

/** Build-time flags (VITE_*), so a registry entry's `flag` (check 2) reads the same variable the feature itself reads. */
const buildFlag = (name: string): unknown => (import.meta.env as Record<string, unknown>)[name];

export function browserContext(extra: Partial<RecipientContext> = {}, key?: string, registry: RecipientRegistry = RECIPIENTS): RecipientContext {
  const real = getConsentId();
  // MPC-10790: the proof each recipient may carry comes from ITS registry entry, not from the caller. An unknown key carries nothing (the wrapper refuses it anyway).
  const entry = key ? registry.recipients.find((r) => r.key === key) : undefined;
  let consentId: string | null = real;
  if (!real && userActed && entry?.phase === "post_click" && markerBases(entry)) consentId = USER_ACTION_MARKER;
  // MPC-9893: every browser call also lands in the in-tab record the per-scan "who saw what" panel renders (item names only, memory only).
  return { consentId, ...(real ? { scanId: getScanId() } : {}), flags: buildFlag, log: recordRecipient, ...extra };
}

export interface RecipientFetchOptions {
  /** "none" only for the reads/writes of the consent store itself (the call that records the consent cannot require one). */
  consentGate?: "enforce" | "none";
  /** Tests and dependency-injected callers pass their own fetch. */
  fetchImpl?: typeof fetch;
  /** MPC-9893: do not add this call to the in-tab "who saw what" record. Only the panel's own read of that record uses it, so the panel does not list itself. */
  silent?: boolean;
}

/**
 * fetch() for a registered recipient. `url` may be absolute, or a path on this site (resolved against the page's origin; only then is the page's own
 * host accepted for `key`). `credentials` stays the browser default ("same-origin") unless the caller sets it, so behaviour matches the raw fetch it replaces.
 * Throws a RecipientError if the registry refuses; every caller already treats a throw like a network failure.
 */
export function recipientFetch(key: string, url: string, init: RequestInit | undefined, sent: readonly DataItem[], opts: RecipientFetchOptions = {}): Promise<Response> {
  // A relative URL resolves against the page, like fetch() does ("curtain.json" next to /footprint/, "/api/x" at the origin root).
  const abs = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : new URL(url, typeof window !== "undefined" ? window.location.href : "http://localhost/").toString();
  let host = "";
  try { host = new URL(abs).hostname.toLowerCase(); } catch { /* the wrapper reports BAD_URL */ }
  // No window = a Node/SSR/test run with no page: a loopback host there is the dev server itself.
  const own = host !== "" && isOwnOrigin(host) && (typeof window === "undefined" || host === pageHost());
  return fetchRecipient(
    key,
    { url: abs, init: { credentials: "same-origin", ...init }, sent },
    browserContext({ ...(own ? { registry: withOwnHost(key, host, RECIPIENTS) } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.consentGate ? { consentGate: opts.consentGate } : {}), ...(opts.silent ? { log: undefined } : {}) }, key),
  );
}

/** A <script> from a registered recipient. Resolves when it has loaded; rejects (never throws synchronously) if the registry refuses or the load fails. */
export function recipientScript(key: string, src: string, attrs?: Record<string, string>, doc?: Document): Promise<HTMLScriptElement> {
  return wrappedLoadRecipientScript(key, src, browserContext({}, key), { ...(attrs ? { attrs } : {}), ...(doc ? { document: doc } : {}) });
}

/** The STUN path. iceServers may only name stun hosts of `key`; an empty list contacts nobody. */
export function recipientPeerConnection(key: string, config: RTCConfiguration, ctx: RecipientContext = browserContext({}, key)): Promise<RTCPeerConnection> {
  return wrappedCreatePeerConnection(key, config, ctx);
}

/** Feature test only (nothing is created or contacted): does this browser have WebRTC at all? Lives here so detectors never name the RTCPeerConnection global. */
export const webRtcAvailable = (): boolean => typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection !== "undefined";
