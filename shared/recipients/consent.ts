// MPC-9887 (Open Tracker design 2.1, 2.3): the consent store and the server-side gate.
//
//   POST /api/consent (scan-report Worker, handleConsent)  records ONE consent per scan id and returns a consent id.
//   requireConsent(sb, scanId)                            the Worker helper: the consent for a scan id, or a typed CONSENT_REQUIRED refusal.
//   makeConsentVerifier(sb)                               the `verifyConsent` function the recipient wrapper's check 4 calls for a post_click recipient.
//
// What a consent row holds (public.scan_consents): the scan id, the wording version, the SHA-256 of the exact rendered text (including {N} and the
// locale), the locale, the registry hash at that moment (which recipients were enabled), N in hours, and the time. No IP, no email, no user agent.
// The server sets n_hours and registry_hash itself; the browser can only say which wording it showed.
//
// Consent is portable across channels (Chris, 2026-11-08 13:15 HKT, DECIDED 1): one consent per person-journey, collected once at whichever door the
// person enters. A second POST for a scan id that already has a consent returns the existing one and never writes again: a channel may collect
// consent, never re-ask it. Web-standard APIs only (the same file is bundled into every wrangler build).
import recipientsData from "./recipients.data.js";
import { registryHash } from "./canonical.js";
import { CONSENT_CONFIG } from "./consent-config.ts";
import { RecipientError } from "./outbound.ts";

export { CONSENT_CONFIG };

/** The minimal PostgREST client the helpers need. The Workers' db(env) client has this shape. */
export interface ConsentDb {
  select(path: string): Promise<unknown[] | null>;
  insert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

export interface ConsentRow {
  id: string;
  scan_id: string;
  consent_version: string;
  consent_text_sha256: string;
  locale: string;
  registry_hash: string;
  n_hours: number;
  consented_at: string;
}

export interface ConsentRequest { scan_id: string; consent_version: string; consent_text_sha256: string; locale: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Strict shape check of the POST body. Unknown keys are refused, so nothing else (an email, an IP) can ride along into the store. */
export function parseConsentRequest(body: unknown): { ok: true; value: ConsentRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request" };
  const b = body as Record<string, unknown>;
  const allowed = new Set(["scan_id", "consent_version", "consent_text_sha256", "locale"]);
  if (Object.keys(b).some((k) => !allowed.has(k))) return { ok: false, error: "Invalid request" };
  if (!isUuid(b.scan_id)) return { ok: false, error: "Invalid scan id" };
  if (b.consent_version !== CONSENT_CONFIG.consent_version) return { ok: false, error: "Unknown consent wording" };   // a stale cached page: refused, never guessed
  if (typeof b.consent_text_sha256 !== "string" || !SHA_RE.test(b.consent_text_sha256)) return { ok: false, error: "Invalid request" };
  if (typeof b.locale !== "string" || !LOCALE_RE.test(b.locale)) return { ok: false, error: "Invalid request" };
  return { ok: true, value: { scan_id: b.scan_id.toLowerCase(), consent_version: b.consent_version, consent_text_sha256: b.consent_text_sha256, locale: b.locale } };
}

let cachedHash: Promise<string> | null = null;
/** The hash of the recipient registry the Worker was built with: which recipients were enabled when the person consented. */
export const currentRegistryHash = (): Promise<string> => (cachedHash ??= registryHash(recipientsData));

const COLUMNS = "id,scan_id,consent_version,consent_text_sha256,locale,registry_hash,n_hours,consented_at";

const asRow = (r: unknown): ConsentRow | null => (r && typeof r === "object" && typeof (r as ConsentRow).id === "string" ? (r as ConsentRow) : null);

export async function findConsentByScan(sb: ConsentDb, scanId: string): Promise<ConsentRow | null> {
  if (!isUuid(scanId)) return null;
  return asRow((await sb.select(`scan_consents?scan_id=eq.${scanId.toLowerCase()}&select=${COLUMNS}&limit=1`))?.[0]);
}

export async function findConsentById(sb: ConsentDb, consentId: string): Promise<ConsentRow | null> {
  if (!isUuid(consentId)) return null;
  return asRow((await sb.select(`scan_consents?id=eq.${consentId.toLowerCase()}&select=${COLUMNS}&limit=1`))?.[0]);
}

/** Records the consent for a scan id, or returns the one already there. `created` says which. Never writes twice for one scan id. */
export async function recordConsent(sb: ConsentDb, req: ConsentRequest, now: () => Date = () => new Date()): Promise<{ created: boolean; row: ConsentRow }> {
  const existing = await findConsentByScan(sb, req.scan_id);
  if (existing) return { created: false, row: existing };
  try {
    const row = asRow(await sb.insert("scan_consents", {
      scan_id: req.scan_id, consent_version: req.consent_version, consent_text_sha256: req.consent_text_sha256, locale: req.locale,
      registry_hash: await currentRegistryHash(), n_hours: CONSENT_CONFIG.n_hours, consented_at: now().toISOString(),
    }));
    if (!row) throw new Error("scan_consents insert returned no row");
    return { created: true, row };
  } catch (e) {
    if ((e as { status?: number })?.status !== 409) throw e;
    const raced = await findConsentByScan(sb, req.scan_id);   // two copies of one POST raced: the second gets the first's row
    if (!raced) throw e;
    return { created: false, row: raced };
  }
}

/**
 * The Worker helper behind wrapper check 4: the consent row for a scan id, or a CONSENT_REQUIRED refusal naming no value.
 * `key` is the recipient the caller was about to use (it only labels the error).
 */
export async function requireConsent(sb: ConsentDb, scanId: string | null | undefined, key = "consent-gate"): Promise<ConsentRow> {
  const row = scanId ? await findConsentByScan(sb, scanId) : null;
  if (!row) throw new RecipientError("CONSENT_REQUIRED", key, "no consent on record for this scan");
  return row;
}

/**
 * Check 4's verifier. The wrapper passes the consent id the context carries; this confirms a row with that id exists in scan_consents. A forged,
 * stale or deleted id is CONSENT_INVALID. A store that cannot be read fails closed (false), never open.
 */
export function makeConsentVerifier(sb: ConsentDb): (consentId: string) => Promise<boolean> {
  return async (consentId: string) => {
    try { return Boolean(await findConsentById(sb, consentId)); } catch { return false; }
  };
}

/** The fields copied onto web_scans when the scan is saved (design 2.3). */
export function consentColumnsForWebScan(row: ConsentRow): Record<string, unknown> {
  return {
    consent_id: row.id, consent_version: row.consent_version, consent_text_sha256: row.consent_text_sha256, consent_locale: row.locale,
    consent_registry_hash: row.registry_hash, consent_n_hours: row.n_hours, consented_at: row.consented_at,
  };
}
