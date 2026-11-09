// MPC-9885 (Open Tracker design 1.3): the Worker / Pages Function side of the recipient wrapper. Builds the RecipientContext every converted call
// site uses, and the scan_recipient_log sink. Web-standard APIs only (the same file is bundled into every wrangler build).
//
//   const rctx = workerRecipientContext(env, { fetchImpl, scanId });          // scanId only inside a scan; everything else omits it
//   const res  = await recipientFetcher("resend", ["email"], rctx)(url, init);  // or callRecipient("resend", { url, init, sent: ["email"] }, rctx)
//   await rctx.flush?.();                                                      // once, at the end of the job: one INSERT for the whole scan
//
// What gets logged (scan_recipient_log): scan id, recipient key, data item NAMES, time, status, HTTP status, error code. Never a value, a URL or a
// header. A call made outside a scan (no scanId: cron collectors, ops notifications, the content pipeline) writes no row; there is no scan to hang it on.
import { callRecipient, type RecipientContext, type RecipientLogEntry } from "./outbound.ts";
import { makeConsentVerifier } from "./consent.ts";

/**
 * Check 4 (consent id for post_click recipients), MPC-9887. The consent store (public.scan_consents) and its verifier now exist, so a call made INSIDE
 * a scan (a scan id on the context) is checked against the store whenever either is true:
 *   - the scan carries a consent id (the visitor's gate returned one): it must exist in the store, or the call is refused CONSENT_INVALID; or
 *   - the Worker runs with CONSENT_GATE_ENFORCED = "true": a scan without a consent id is refused CONSENT_REQUIRED.
 * CONSENT_GATE_ENFORCED stays "false" in every wrangler.toml until the consent block (MPC-9888) sends the id, because no visitor holds one before
 * that; flipping it earlier would refuse every report. Calls outside a scan (cron collectors, ops notifications, the content pipeline) are not on
 * a visitor's behalf and carry no consent. Every other check runs on every call either way.
 */
export const CONSENT_GATE_ACTIVE = true;

/** True only for the exact string "true" (same rule as every other Worker switch). */
export const consentGateEnforced = (env: Env): boolean => ((env ?? {}) as Record<string, unknown>).CONSENT_GATE_ENFORCED === "true";

type Env = Record<string, unknown> | undefined | null;

export interface WorkerContextOptions {
  fetchImpl?: typeof fetch;
  /** Set only inside a scan. Rows are written for calls that carry it. */
  scanId?: string | null;
  /** Cloudflare cf.country of the visitor, if the call is on a visitor's behalf. */
  country?: string | null;
  /** Consent id returned by the gate (POST /api/consent) and stored on the scan. With a scanId it is verified against scan_consents on every post_click call. */
  consentId?: string | null;
  verifyConsent?: RecipientContext["verifyConsent"];
  /** Overrides the sink (tests). Pass `null` to disable logging. */
  sink?: RecipientLogSink | null;
  /** Runs right before each network call (subrequest budget guards). See RecipientContext.beforeCall. */
  beforeCall?: RecipientContext["beforeCall"];
  /** user_supplied caps (check 7); defaults are in outbound.ts. */
  timeoutMs?: number;
  maxBytes?: number;
}

export interface RecipientLogSink {
  log: (entry: RecipientLogEntry) => void;
  /** Writes everything buffered in ONE request. Never throws; resolves to the number of rows written (0 on failure or nothing to write). */
  flush: () => Promise<number>;
  readonly pending: number;
}

export type WorkerRecipientContext = RecipientContext & { flush: () => Promise<number> };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The service-role key name differs between Workers; take whichever this Worker has. */
export function supabaseCredentials(env: Env): { url: string; key: string } | null {
  const e = (env ?? {}) as Record<string, unknown>;
  const url = str(e.SUPABASE_URL).replace(/\/+$/, "");
  const key = str(e.SUPABASE_SERVICE_ROLE_KEY) || str(e.SUPABASE_SERVICE_KEY) || str(e.SUPABASE_KEY);
  return url && key ? { url, key } : null;
}

const MAX_BUFFER = 200; // a scan makes a few dozen calls; this only bounds a runaway loop

/** Buffers log entries for one scan and writes them with a single INSERT. The write itself goes through the wrapper (key "supabase", no items, no log). */
export function createRecipientLogSink(env: Env, fetchImpl?: typeof fetch): RecipientLogSink {
  const buf: Record<string, unknown>[] = [];
  return {
    log(entry) {
      if (!entry.scan_id || buf.length >= MAX_BUFFER) return;
      buf.push({ scan_id: entry.scan_id, recipient_key: entry.key, items: entry.items, status: entry.status, http_status: entry.http_status ?? null, code: entry.code ?? null, at: entry.at });
    },
    async flush() {
      const creds = supabaseCredentials(env);
      if (!creds || buf.length === 0) return 0;
      const rows = buf.splice(0, buf.length);
      try {
        const res = await callRecipient("supabase", {
          url: `${creds.url}/rest/v1/scan_recipient_log`,
          init: { method: "POST", headers: { apikey: creds.key, authorization: `Bearer ${creds.key}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(rows) },
          sent: [],
        }, { fetchImpl, consentGate: "none" });
        return res.ok ? rows.length : 0;
      } catch {
        return 0; // the log never breaks or changes the call it describes
      }
    },
    get pending() { return buf.length; },
  };
}

/**
 * The store lookups behind check 4. They go through the wrapper too (key "supabase", no items) with consent skipped: reading the consent store cannot
 * itself need a consent. No Supabase credentials, no verifier: then only the presence of the id can be checked.
 */
function defaultVerifier(env: Env, fetchImpl?: typeof fetch): RecipientContext["verifyConsent"] {
  const creds = supabaseCredentials(env);
  if (!creds) return undefined;
  const headers = { apikey: creds.key, authorization: `Bearer ${creds.key}` };
  const sb = {
    async select(path: string) {
      const res = await callRecipient("supabase", { url: `${creds.url}/rest/v1/${path}`, init: { headers }, sent: [] }, { fetchImpl, consentGate: "none" });
      if (!res.ok) throw new Error(`consent store read failed: ${res.status}`);
      return (await res.json()) as unknown[];
    },
    async insert(): Promise<null> { throw new Error("the verifier never writes"); },
  };
  return makeConsentVerifier(sb);
}

/** The context for converted Worker and Function call sites. Flags are read from `env` by name. */
export function workerRecipientContext(env: Env, opts: WorkerContextOptions = {}): WorkerRecipientContext {
  const sink = opts.sink === undefined ? (opts.scanId ? createRecipientLogSink(env, opts.fetchImpl) : null) : opts.sink;
  const e = (env ?? {}) as Record<string, unknown>;
  const carried = typeof opts.consentId === "string" ? opts.consentId.trim() : "";
  const gated = Boolean(opts.scanId) && CONSENT_GATE_ACTIVE && (Boolean(carried) || consentGateEnforced(env));   // see CONSENT_GATE_ACTIVE
  const ctx: WorkerRecipientContext = {
    flags: (name: string) => e[name],
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.scanId ? { scanId: opts.scanId } : {}),
    ...(opts.country ? { country: opts.country } : {}),
    consentGate: gated ? ("enforce" as const) : ("none" as const),
    ...(gated ? { consentId: carried || null, verifyConsent: opts.verifyConsent ?? defaultVerifier(env, opts.fetchImpl) } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.beforeCall ? { beforeCall: opts.beforeCall } : {}),
    ...(sink ? { log: sink.log } : {}),
    flush: sink ? sink.flush : async () => 0,
  };
  return ctx;
}
