// MPC-9888 (Open Tracker design 2.1, 2.4): the browser half of the scan consent. One consent per person-journey, collected at whichever door the person
// enters; pressing Scan me (or the scan form's button) is the agreement, no toggle. This module owns the journey's scan id and the consent id the
// server gave back (MPC-9887, POST /api/consent), keeps them for this tab only (sessionStorage, memory when storage is blocked), and tells listeners.
//
// What it never does: store an email, an IP or a user agent. The only thing sent is { scan_id, consent_version, consent_text_sha256, locale }.
// Consent is portable (Chris, DECIDED 1): a deep link from a channel carries ?scan=<uuid>; adoptExistingConsent() asks the server whether that journey
// already has a consent and, if so, takes it without showing the block again. A channel may collect consent, never re-ask it.
import { recipientFetch } from "@/lib/recipientClient";
import { resolveScanApiUrl } from "@/lib/webScan";
import { consentTextSha256, pickConsentLocale, renderConsent, type ConsentLocale } from "../../shared/recipients/consent-text";
import { CONSENT_CONFIG } from "../../shared/recipients/consent-config";

const KEY = "mpt_scan_consent";
const CHANGED = "mpt:scan-consent";

interface Stored { scanId: string; consentId: string | null; version: string | null; at: string | null }
let memory: Stored | null = null;
let inflight: Promise<string> | null = null;

const uuid = (): string => globalThis.crypto.randomUUID();
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function read(): Stored {
  if (memory) return memory;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    if (p && isUuid(p.scanId)) {
      memory = { scanId: p.scanId, consentId: isUuid(p.consentId) ? p.consentId : null, version: typeof p.version === "string" ? p.version : null, at: typeof p.at === "string" ? p.at : null };
      return memory;
    }
  } catch { /* storage blocked: keep it in memory */ }
  memory = { scanId: uuid(), consentId: null, version: null, at: null };
  write();
  return memory;
}

function write(): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* memory only */ }
}

/** This journey's scan id (client-generated, becomes the scan number once saved). Created on first use. */
export const getScanId = (): string => read().scanId;
/** The consent id the server returned, or null before the person has pressed the button. */
export const getConsentId = (): string | null => read().consentId;
/** True once this journey holds a server-issued consent for the CURRENT wording. A consent for an older wording does not count. */
export const hasScanConsent = (): boolean => { const s = read(); return s.consentId !== null && s.version === CONSENT_CONFIG.consent_version; };

export function onScanConsent(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

function store(consentId: string, version: string, at: string): void {
  memory = { ...read(), consentId, version, at };
  write();
  window.dispatchEvent(new Event(CHANGED));
}

const base = (): string => resolveScanApiUrl().replace(/\/$/, "");

export const consentLocale = (): ConsentLocale => pickConsentLocale(typeof navigator !== "undefined" ? navigator.language : "en");

export class ConsentError extends Error {
  constructor(readonly kind: "unavailable" | "stale" | "network") { super(`scan consent ${kind}`); }
}

/**
 * Press-to-agree. Records the consent for this journey (POST /api/consent) and resolves with the consent id. Idempotent: a second call, a double click
 * or a second door returns the same id and never asks the server to write twice. Rejects with ConsentError if the server could not record it, in which
 * case nothing post-click must start.
 */
export function giveScanConsent(locale: ConsentLocale = consentLocale()): Promise<string> {
  if (hasScanConsent()) return Promise.resolve(read().consentId as string);
  if (inflight) return inflight;
  inflight = (async () => {
    const api = base();
    if (!api) throw new ConsentError("unavailable");   // VITE_SCAN_API_URL="off"
    const shown = renderConsent(locale);
    const body = { scan_id: getScanId(), consent_version: shown.consentVersion, consent_text_sha256: await consentTextSha256(shown.plain), locale: shown.locale };
    let res: Response;
    try {
      // consentGate "none": this call IS the consent being recorded, so it cannot require one (design 1.3, the reads/writes of the consent store itself).
      res = await recipientFetch("scan-report", `${api}/api/consent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, [], { consentGate: "none" });
    } catch { throw new ConsentError("network"); }
    if (res.status === 400) throw new ConsentError("stale");   // the Worker knows a newer wording: reload to get it
    if (!res.ok) throw new ConsentError("network");
    const data = (await res.json().catch(() => null)) as { consent_id?: unknown; consent_version?: unknown; consented_at?: unknown } | null;
    if (!data || !isUuid(data.consent_id)) throw new ConsentError("network");
    store(data.consent_id, String(data.consent_version ?? shown.consentVersion), String(data.consented_at ?? new Date().toISOString()));
    return data.consent_id;
  })().finally(() => { inflight = null; });
  return inflight;
}

/**
 * Portable consent: a deep link from a channel carries ?scan=<uuid>. If that journey already has a consent on the server, adopt it (and its scan id) so
 * the gate does not ask again. Resolves false when there is none or it cannot be checked; the block is then shown as for a cold arrival.
 */
export async function adoptExistingConsent(scanId: string | null | undefined): Promise<boolean> {
  if (hasScanConsent() || !isUuid(scanId)) return hasScanConsent();
  const api = base();
  if (!api) return false;
  try {
    const res = await recipientFetch("scan-report", `${api}/api/consent?scan_id=${encodeURIComponent(scanId)}`, undefined, [], { consentGate: "none" });
    if (!res.ok) return false;
    const d = (await res.json().catch(() => null)) as { consent_id?: unknown; scan_id?: unknown; consent_version?: unknown; consented_at?: unknown } | null;
    if (!d || !isUuid(d.consent_id) || d.consent_version !== CONSENT_CONFIG.consent_version) return false;   // an older wording is not "agreed" to the current one
    memory = { scanId: scanId.toLowerCase(), consentId: d.consent_id, version: String(d.consent_version), at: String(d.consented_at ?? "") };
    write();
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch { return false; }
}

/** Tests only. */
export function __resetScanConsentForTests(): void {
  memory = null; inflight = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Tests only: pretend the visitor already pressed the consent button. */
export function __seedScanConsentForTests(): void {
  memory = { scanId: "11111111-1111-4111-8111-111111111111", consentId: "22222222-2222-4222-8222-222222222222", version: CONSENT_CONFIG.consent_version, at: "2026-11-08T00:00:00.000Z" };
}
