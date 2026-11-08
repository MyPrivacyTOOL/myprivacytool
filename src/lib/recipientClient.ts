// MPC-9886 (Open Tracker rule 6, design 1.3 / 2.4): the browser's one door to the recipient wrapper. Every outbound call the SITE makes goes
// through recipientFetch / loadRecipientScript / createPeerConnection here, with a string-literal registry key at the call site (MPC-9884 checks that).
//
// Two things this module does that a bare call to the wrapper would not, both to keep today's behaviour exactly as it is until MPC-9888:
//
// 1. INTERIM_CONSENT_ID. The wrapper refuses a post_click recipient without a consent id (check 4). The consent gate that produces that id is
//    MPC-9887 (server) and MPC-9888 (UI); it does not exist yet, and this task must not change consent behaviour. Until then every call this site
//    already made on its own authority (a form submit, the analytics banner, the device scan) still carries the one fixed marker below. It is NOT
//    evidence of consent and nothing server-side may read it as such: it only lets the call proceed exactly as it did before. MPC-9888 replaces
//    it with the id returned by the Scan me click. Grep for INTERIM_CONSENT_ID to find every place that changes.
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
import { isLoopbackHost } from "../../shared/recipients/outbound";

/** Interim marker, see the header. MPC-9888 deletes this constant when the real consent id exists. */
export const INTERIM_CONSENT_ID = "interim-pre-gate:mpc-9886";

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

export function browserContext(extra: Partial<RecipientContext> = {}): RecipientContext {
  return { consentId: INTERIM_CONSENT_ID, flags: buildFlag, ...extra };
}

export interface RecipientFetchOptions {
  /** Tests and dependency-injected callers pass their own fetch. */
  fetchImpl?: typeof fetch;
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
    browserContext({ ...(own ? { registry: withOwnHost(key, host, RECIPIENTS) } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) }),
  );
}

/** A <script> from a registered recipient. Resolves when it has loaded; rejects (never throws synchronously) if the registry refuses or the load fails. */
export function recipientScript(key: string, src: string, attrs?: Record<string, string>, doc?: Document): Promise<HTMLScriptElement> {
  return wrappedLoadRecipientScript(key, src, browserContext(), { ...(attrs ? { attrs } : {}), ...(doc ? { document: doc } : {}) });
}

/** The STUN path. iceServers may only name stun hosts of `key`; an empty list contacts nobody. */
export function recipientPeerConnection(key: string, config: RTCConfiguration, ctx: RecipientContext = browserContext()): Promise<RTCPeerConnection> {
  return wrappedCreatePeerConnection(key, config, ctx);
}

/** Feature test only (nothing is created or contacted): does this browser have WebRTC at all? Lives here so detectors never name the RTCPeerConnection global. */
export const webRtcAvailable = (): boolean => typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection !== "undefined";
