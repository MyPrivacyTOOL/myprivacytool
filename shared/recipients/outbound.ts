// MPC-9883 (Open Tracker rule 6, design 1.3): the ONE contract every outbound call to a recipient goes through. Runs in the browser, Pages
// Functions, Workers and Node, so it uses only web-standard APIs (fetch, URL, AbortController, WebCrypto) and takes everything environmental
// (fetch, consent verifier, log sink, flags, country) through the context. No call site uses it yet: conversion is MPC-9885 / MPC-9886, and the CI
// scan that forbids bypassing it is MPC-9884.
//
// Before ANY I/O it runs seven checks and throws a typed RecipientError on the first failure:
//   1 key exists  2 enabled and flag on  3 country override does not disable it  4 post_click needs a valid consent id
//   5 resolved host matches the entry's hosts  6 declared `sent` is a subset of its data items (after country exclusions)
//   7 user_supplied: https only, no private ranges, no redirect to a new host, size and time caps
// On a call that reaches the network it logs {key, items, at, status}; item NAMES only, never values.
import recipientsData from "./recipients.json" with { type: "json" };
import {
  DATA_ITEMS, effectiveDataItems, enabledForCountry, findRecipient, flagIsOn, hostMatches, parseRegistry,
  type DataItem, type Recipient, type RecipientRegistry,
} from "./registry.ts";

// Browser-only types, kept loose so this file compiles in Worker projects (no DOM lib) as well as the app.
type DocLike = any; type ScriptEl = any; type RtcConfig = any; type RtcPeer = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type RecipientErrorCode =
  | "UNKNOWN_KEY" | "DISABLED" | "FLAG_OFF" | "COUNTRY_DISABLED" | "CONSENT_REQUIRED" | "CONSENT_INVALID" | "BAD_URL"
  | "HOST_MISMATCH" | "UNKNOWN_DATA_ITEM" | "DATA_ITEM_NOT_ALLOWED" | "WRONG_HOST_KIND"
  | "USER_SUPPLIED_REJECTED" | "REDIRECT_BLOCKED" | "RESPONSE_TOO_LARGE" | "TIMEOUT";

export class RecipientError extends Error {
  readonly code: RecipientErrorCode;
  readonly key: string;
  readonly detail?: string;
  constructor(code: RecipientErrorCode, key: string, detail?: string) {
    super(`recipient "${key}" refused: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "RecipientError";
    this.code = code;
    this.key = key;
    this.detail = detail;
  }
}
export const isRecipientError = (e: unknown): e is RecipientError => e instanceof RecipientError;

export type RecipientLogStatus = "ran" | "failed" | "skipped_disabled" | "skipped_country" | "refused";
/** The log shape. Item NAMES only, never values. Workers write it to scan_recipient_log; the browser returns it with the scan result. */
export interface RecipientLogEntry {
  key: string;
  items: DataItem[];
  at: string;
  status: RecipientLogStatus;
  /** HTTP status when there was a response. */
  http_status?: number;
  /** The error code when status is refused / skipped_* / failed. */
  code?: RecipientErrorCode | "NETWORK";
  scan_id?: string;
}

export interface RecipientContext {
  /** ISO-3166 alpha-2 arrival country (Cloudflare cf.country). Used by check 3 and 6. */
  country?: string | null;
  /** The consent id returned by the scan gate. Required for post_click recipients (check 4). */
  consentId?: string | null;
  scanId?: string | null;
  /** Workers pass a verifier that checks scan_consents; the browser only holds the id. If omitted, presence of consentId is the check. */
  verifyConsent?: (consentId: string, scanId: string | null) => boolean | Promise<boolean>;
  /** Flag values by name: a map, or a lookup function (e.g. name => env[name]). */
  flags?: Record<string, unknown> | ((name: string) => unknown);
  /** Defaults to the bundled recipients.json. Tests and the sync script pass their own. */
  registry?: RecipientRegistry;
  fetchImpl?: typeof fetch;
  log?: (entry: RecipientLogEntry) => void | Promise<void>;
  now?: () => Date;
  /** Check 7 caps. */
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * Check 4 policy. "enforce" (default): a post_click recipient needs a consent id. "pending_mpc_9887": the server-side consent store does not exist
   * yet (MPC-9887), so Workers and Functions cannot be given a consent id without inventing one; check 4 is skipped, every other check still runs.
   * workerRecipientContext() sets this from ONE constant (CONSENT_GATE_ACTIVE in worker-ctx.ts) that MPC-9887 flips. Never set it to anything
   * else to get past a refusal.
   */
  consentGate?: "enforce" | "pending_mpc_9887";
  /** Runs after every check passed and immediately before the network call (Workers use it to count subrequests against a budget). A throw aborts the call. */
  beforeCall?: (key: string) => void | Promise<void>;
}

export interface RecipientRequest {
  url: string;
  init?: RequestInit;
  /** The data items this call sends. Declared, then checked against the registry. */
  sent: readonly DataItem[];
}

export const USER_SUPPLIED_MAX_BYTES = 1_000_000;
export const USER_SUPPLIED_TIMEOUT_MS = 8000;
const MAX_REDIRECT_HOPS = 3;

let bundled: RecipientRegistry | null = null;
const defaultRegistry = (): RecipientRegistry => (bundled ??= parseRegistry(recipientsData));
/**
 * TEST SEAM. Handler tests inject a fetchImpl but the registry is the bundled file; a test that needs a recipient in a different state (for example
 * hibp enabled with a key) swaps the bundled registry here and restores it with the returned function. Production code never calls this.
 */
export function setBundledRegistryForTests(registry: RecipientRegistry | null): () => void {
  const prev = bundled;
  bundled = registry;
  return () => { bundled = prev; };
}

const readFlag = (ctx: RecipientContext, name: string): unknown => (typeof ctx.flags === "function" ? ctx.flags(name) : ctx.flags?.[name]);

/** Private, loopback, link-local, carrier-grade and reserved destinations, and internal-looking names. Literal-address check only: see PR note on DNS. */
export function isPrivateOrInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // single-label name such as "intranet"
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0);
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true; // fc00::/7 unique-local, fe80::/10 link-local
    const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateOrInternalHost(mapped[1]);
    // URL parsing rewrites ::ffff:10.0.0.1 as ::ffff:a00:1, so decode the hex pair back to dotted form.
    const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return isPrivateOrInternalHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    return false;
  }
  return /^\d+$/.test(h); // a bare integer host such as 2130706433 is 127.0.0.1 to many resolvers
}

export interface CheckedCall {
  recipient: Recipient;
  url: URL;
  items: DataItem[];
}

async function emit(ctx: RecipientContext, entry: RecipientLogEntry): Promise<void> {
  if (!ctx.log) return;
  try { await ctx.log(entry); } catch { /* a log failure never breaks or changes the call */ }
}

const nowIso = (ctx: RecipientContext): string => (ctx.now ? ctx.now() : new Date()).toISOString();

function requireItems(key: string, sent: readonly DataItem[], allowed: readonly DataItem[]): DataItem[] {
  const items = Array.from(new Set(sent));
  for (const d of items) if (!(DATA_ITEMS as readonly string[]).includes(d)) throw new RecipientError("UNKNOWN_DATA_ITEM", key, String(d));
  const extra = items.filter((d) => !allowed.includes(d));
  if (extra.length) throw new RecipientError("DATA_ITEM_NOT_ALLOWED", key, extra.join(","));
  return items;
}

/**
 * Checks 1-6 (and the URL half of 7) without any I/O. Exported so tests, the CI crawl and the browser helpers share one implementation.
 * `hostUrl` is the URL whose host is matched against the entry. Throws RecipientError.
 */
export async function checkRecipient(key: string, hostUrl: string, sent: readonly DataItem[], ctx: RecipientContext = {}): Promise<CheckedCall> {
  const registry = ctx.registry ?? defaultRegistry();
  // 1 key exists
  const recipient = typeof key === "string" ? findRecipient(registry, key) : undefined;
  if (!recipient) throw new RecipientError("UNKNOWN_KEY", String(key));
  // 2 enabled, and its flag is on
  if (!recipient.enabled) throw new RecipientError("DISABLED", key, recipient.reason ?? "enabled is false");
  if (recipient.flag && !flagIsOn(readFlag(ctx, recipient.flag))) throw new RecipientError("FLAG_OFF", key, recipient.flag);
  // 3 country override
  if (!enabledForCountry(recipient, ctx.country)) throw new RecipientError("COUNTRY_DISABLED", key, String(ctx.country));
  // 4 consent for post_click (skipped only while the consent store is not built: ctx.consentGate, see RecipientContext)
  if (recipient.phase === "post_click" && ctx.consentGate !== "pending_mpc_9887") {
    const id = typeof ctx.consentId === "string" ? ctx.consentId.trim() : "";
    if (!id) throw new RecipientError("CONSENT_REQUIRED", key);
    if (ctx.verifyConsent && !(await ctx.verifyConsent(id, ctx.scanId ?? null))) throw new RecipientError("CONSENT_INVALID", key);
  }
  // 5 host (7 for user_supplied)
  let url: URL;
  try { url = new URL(hostUrl); } catch { throw new RecipientError("BAD_URL", key, "unparseable URL"); }
  if (recipient.host_kind === "user_supplied") {
    if (url.protocol !== "https:") throw new RecipientError("USER_SUPPLIED_REJECTED", key, "https only");
    if (url.username || url.password) throw new RecipientError("USER_SUPPLIED_REJECTED", key, "credentials in URL");
    if (url.port && url.port !== "443") throw new RecipientError("USER_SUPPLIED_REJECTED", key, "port");
    if (isPrivateOrInternalHost(url.hostname)) throw new RecipientError("USER_SUPPLIED_REJECTED", key, "private or internal host");
  } else {
    if (recipient.host_kind === "stun") {
      if (!/^stuns?:$/.test(url.protocol)) throw new RecipientError("WRONG_HOST_KIND", key, "stun entries accept stun: URLs only");
    } else if (url.protocol !== "https:" && url.protocol !== "wss:") {
      throw new RecipientError("BAD_URL", key, `protocol ${url.protocol}`);
    }
    if (!hostMatches(url.hostname, recipient.hosts)) throw new RecipientError("HOST_MISMATCH", key, url.hostname);
  }
  // 6 sent is a subset of the data items after country exclusions
  const items = requireItems(key, sent, effectiveDataItems(recipient, ctx.country));
  return { recipient, url, items };
}

/** Runs the checks, logs a refusal as skipped/refused, and rethrows. Keeps the "who saw what" panel honest about calls that did NOT happen. */
async function guarded(key: string, hostUrl: string, sent: readonly DataItem[], ctx: RecipientContext): Promise<CheckedCall> {
  try {
    return await checkRecipient(key, hostUrl, sent, ctx);
  } catch (e) {
    if (isRecipientError(e)) {
      const status: RecipientLogStatus = e.code === "DISABLED" || e.code === "FLAG_OFF" ? "skipped_disabled" : e.code === "COUNTRY_DISABLED" ? "skipped_country" : "refused";
      // Unknown keys are not logged: there is no registry row to hang the entry on (and the log table has a foreign key to it).
      if (e.code !== "UNKNOWN_KEY") await emit(ctx, { key, items: [], at: nowIso(ctx), status, code: e.code, ...(ctx.scanId ? { scan_id: ctx.scanId } : {}) });
    }
    throw e;
  }
}

async function capBody(key: string, res: Response, maxBytes: number): Promise<Response> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RecipientError("RESPONSE_TOO_LARGE", key, `content-length ${declared}`);
  if (!res.body) return res;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new RecipientError("RESPONSE_TOO_LARGE", key, `more than ${maxBytes} bytes`); }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.byteLength; }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function fetchUserSupplied(key: string, first: URL, init: RequestInit | undefined, ctx: RecipientContext, doFetch: typeof fetch): Promise<Response> {
  const timeoutMs = ctx.timeoutMs ?? USER_SUPPLIED_TIMEOUT_MS;
  const maxBytes = ctx.maxBytes ?? USER_SUPPLIED_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    let url = first;
    for (let hop = 0; ; hop++) {
      const res = await doFetch(url.toString(), { ...init, redirect: "manual", signal: controller.signal });
      const isRedirect = (res.type as string) === "opaqueredirect" || (res.status >= 300 && res.status < 400);
      if (!isRedirect) return await capBody(key, res, maxBytes);
      const location = res.headers.get("location");
      if (!location) throw new RecipientError("REDIRECT_BLOCKED", key, "redirect without a readable Location");
      let next: URL;
      try { next = new URL(location, url); } catch { throw new RecipientError("REDIRECT_BLOCKED", key, "bad Location"); }
      if (next.hostname.toLowerCase() !== url.hostname.toLowerCase() || next.protocol !== "https:") throw new RecipientError("REDIRECT_BLOCKED", key, `to ${next.hostname}`);
      if (hop + 1 > MAX_REDIRECT_HOPS) throw new RecipientError("REDIRECT_BLOCKED", key, "too many redirects");
      url = next;
    }
  } catch (e) {
    if (timedOut && !isRecipientError(e)) throw new RecipientError("TIMEOUT", key, `${timeoutMs} ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** For Workers, Pages Functions and Node: checks, then fetch, then log. */
export async function callRecipient(key: string, request: RecipientRequest, ctx: RecipientContext = {}): Promise<Response> {
  const checked = await guarded(key, request.url, request.sent, ctx);
  const doFetch = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const entry = (status: RecipientLogStatus, extra: Partial<RecipientLogEntry> = {}): RecipientLogEntry =>
    ({ key, items: checked.items, at: nowIso(ctx), status, ...(ctx.scanId ? { scan_id: ctx.scanId } : {}), ...extra });
  try {
    await ctx.beforeCall?.(key);
    const res = checked.recipient.host_kind === "user_supplied"
      ? await fetchUserSupplied(key, checked.url, request.init, ctx, doFetch)
      : await doFetch(checked.url.toString(), request.init);
    await emit(ctx, entry(res.ok ? "ran" : "failed", { http_status: res.status }));
    return res;
  } catch (e) {
    await emit(ctx, entry("failed", { code: isRecipientError(e) ? e.code : "NETWORK" }));
    throw e;
  }
}

/**
 * A fetch-shaped function bound to ONE registry key and ONE declared `sent` list, for code that takes an injected `fetchImpl` and calls it in many
 * places (the Workers do). `recipientFetcher("resend", ["email"], ctx)(url, init)` is exactly `callRecipient("resend", { url, init, sent: ["email"] }, ctx)`.
 * The CI scan requires the key to be a string literal, like every other wrapper call, and `sent` is declared at the call site, so conversion keeps
 * each call's key and data items visible in the diff. `input` must be a string or URL: a Request object has no declared host to check.
 */
export function recipientFetcher(key: string, sent: readonly DataItem[], ctx: RecipientContext = {}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : undefined;
    if (url === undefined) return Promise.reject(new RecipientError("BAD_URL", key, "pass a URL string, not a Request"));
    return callRecipient(key, { url, init, sent }, ctx);
  }) as typeof fetch;
}

/** Browser flavour of callRecipient: the same checks, and credentials are never sent to a recipient unless the caller asks. */
export function fetchRecipient(key: string, request: RecipientRequest, ctx: RecipientContext = {}): Promise<Response> {
  return callRecipient(key, { ...request, init: { credentials: "omit", ...request.init } as RequestInit }, ctx);
}

export interface ScriptLoadOptions {
  /** Defaults to every data item the entry declares (a script load discloses at least IP and user agent to its host). */
  sent?: readonly DataItem[];
  attrs?: Record<string, string>;
  /** Injected in tests; defaults to globalThis.document. */
  document?: DocLike;
}

/** Browser: the only way to add a third-party <script>. Resolves when the script has loaded. */
export async function loadRecipientScript(key: string, src: string, ctx: RecipientContext = {}, opts: ScriptLoadOptions = {}): Promise<ScriptEl> {
  const registry = ctx.registry ?? defaultRegistry();
  const declared = opts.sent ?? (findRecipient(registry, key) ? effectiveDataItems(findRecipient(registry, key)!, ctx.country) : []);
  const checked = await guarded(key, src, declared, ctx);
  const doc = opts.document ?? (globalThis as { document?: DocLike }).document;
  if (!doc) throw new RecipientError("BAD_URL", key, "loadRecipientScript needs a document");
  return await new Promise<ScriptEl>((resolve, reject) => {
    const el = doc.createElement("script");
    el.src = checked.url.toString();
    el.async = true;
    for (const [k, v] of Object.entries(opts.attrs ?? {})) el.setAttribute(k, v);
    el.onload = () => { void emit(ctx, { key, items: checked.items, at: nowIso(ctx), status: "ran", ...(ctx.scanId ? { scan_id: ctx.scanId } : {}) }); resolve(el); };
    el.onerror = () => { void emit(ctx, { key, items: checked.items, at: nowIso(ctx), status: "failed", code: "NETWORK", ...(ctx.scanId ? { scan_id: ctx.scanId } : {}) }); reject(new RecipientError("TIMEOUT", key, "script failed to load")); };
    doc.head.appendChild(el);
  });
}

export interface PeerConnectionOptions {
  /** Injected in tests; defaults to globalThis.RTCPeerConnection. */
  RTCPeerConnectionImpl?: new (config?: RtcConfig) => RtcPeer;
}

/**
 * Browser: the STUN path. `iceServers` may only name stun-kind hosts of the given key. An EMPTY iceServers list contacts nobody (host candidates
 * only), so it needs no consent and no checks: this is the pre-consent mode (design 2.4).
 */
export async function createPeerConnection(key: string, config: RtcConfig = {}, ctx: RecipientContext = {}, opts: PeerConnectionOptions = {}): Promise<RtcPeer> {
  const Impl = opts.RTCPeerConnectionImpl ?? (globalThis as { RTCPeerConnection?: PeerConnectionOptions["RTCPeerConnectionImpl"] }).RTCPeerConnection;
  if (!Impl) throw new RecipientError("BAD_URL", key, "RTCPeerConnection is not available");
  const servers = config.iceServers ?? [];
  if (servers.length === 0) return new Impl(config);
  const registry = ctx.registry ?? defaultRegistry();
  const rec = findRecipient(registry, key);
  const sent: DataItem[] = ["ip"];
  let items: DataItem[] = sent;
  for (const s of servers) {
    for (const u of Array.isArray(s.urls) ? s.urls : [s.urls]) {
      if (!/^stuns?:/i.test(u)) throw new RecipientError("WRONG_HOST_KIND", key, "only stun: / stuns: URLs are allowed");
      // "stun:host:port" parses as a URL whose pathname is "host:port"; normalise to a hostname the checker can match.
      const host = u.replace(/^stuns?:/i, "").replace(/^\/\//, "").split(/[?/]/)[0].replace(/:\d+$/, "");
      if (rec && rec.host_kind !== "stun") throw new RecipientError("WRONG_HOST_KIND", key, "registry entry is not host_kind stun");
      items = (await guarded(key, `stun://${host}`, sent, ctx)).items;
    }
  }
  const pc = new Impl(config);
  await emit(ctx, { key, items, at: nowIso(ctx), status: "ran", ...(ctx.scanId ? { scan_id: ctx.scanId } : {}) });
  return pc;
}
