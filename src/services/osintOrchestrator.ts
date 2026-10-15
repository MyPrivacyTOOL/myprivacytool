// OSINT orchestrator for the WhatsApp deep dive: the "Golden Trio" of lookups for one verified wa_id.
//   Layer 1  Meta Cloud API   what Meta already told us when the person messaged us (wa_id, profile name). No outbound call:
//                             the Cloud API has no lookup-by-number endpoint, so this layer is the inbound webhook contact record.
//   Layer 2  RapidAPI         profile picture present, business account (injected provider)
//   Layer 3  External DBs     spam registry + breach DB (injected providers)
//
// HONESTY FILTER. A hexagon is `checked` only when its provider answered with a well-formed value. A timeout, error, missing
// provider, unparseable answer or a missing field makes it `not_checked` with data null. Nothing here ever turns a failure,
// or an absent field, into "clean", "0" or `false`. Layers 2 and 3 run together, so one slow provider cannot starve the others.
import type { Hexagon } from '@/types/hexagon';
import { remediationFor } from '@/utils/remediationMapper';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

export type ProviderCall<T> = (wa_id: string, signal: AbortSignal) => Promise<T>;

export interface ProfileMetadata { profile_pic_exists: boolean; is_business: boolean }
export interface SpamResult { flag_count: number }
export interface BreachResult { breach_count: number }

export interface OsintProviders {
  /** Layer 2. Omit = not configured = both hexagons not_checked. */
  profileMetadata?: ProviderCall<ProfileMetadata>;
  /** Layer 3. */
  spamRegistry?: ProviderCall<SpamResult>;
  breachDb?: ProviderCall<BreachResult>;
}

/** Layer 1 input: the webhook contact record plus proof of possession. */
export interface InboundContact {
  wa_id: string;
  profile_name?: string | null;
  /** Epoch seconds of the last message the person sent us. Absent = they never messaged us = no scan. */
  inbound_message_timestamp?: number | null;
}

export type ProviderOutcome = 'ok' | 'timeout' | 'error' | 'not_configured' | 'invalid_response';
export interface Diagnostic { provider: string; outcome: ProviderOutcome; ms: number }
export interface OsintScan { hexagons: Hexagon[]; diagnostics: Diagnostic[] }

export class ProofOfPossessionError extends Error {
  constructor() { super('no inbound message from this wa_id: scan refused'); this.name = 'ProofOfPossessionError'; }
}

class ProviderTimeout extends Error {}
class InvalidResponse extends Error {}

/** Runs one provider with a hard deadline. The provider also gets an AbortSignal so a real fetch is cancelled, not just ignored. */
async function guarded<T>(
  name: string,
  call: ProviderCall<T> | undefined,
  wa_id: string,
  timeoutMs: number,
  validate: (v: unknown) => T,
): Promise<{ value: T | null; diag: Diagnostic }> {
  const t0 = Date.now();
  const done = (outcome: ProviderOutcome, value: T | null = null) => ({ value, diag: { provider: name, outcome, ms: Date.now() - t0 } });
  if (!call) return done('not_configured');
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      call(wa_id, ctrl.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new ProviderTimeout()); }, timeoutMs); }),
    ]);
    return done('ok', validate(raw));
  } catch (e) {
    return done(e instanceof ProviderTimeout ? 'timeout' : e instanceof InvalidResponse ? 'invalid_response' : 'error');
  } finally {
    clearTimeout(timer);
  }
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) throw new InvalidResponse();
  return v as Record<string, unknown>;
};

// A missing or mistyped field is an invalid response, never a default.
const validateMetadata = (v: unknown): ProfileMetadata => {
  const o = obj(v);
  if (!isBool(o.profile_pic_exists) || !isBool(o.is_business)) throw new InvalidResponse();
  return { profile_pic_exists: o.profile_pic_exists, is_business: o.is_business };
};
const validateSpam = (v: unknown): SpamResult => {
  const o = obj(v);
  if (!isCount(o.flag_count)) throw new InvalidResponse();
  return { flag_count: o.flag_count };
};
const validateBreach = (v: unknown): BreachResult => {
  const o = obj(v);
  if (!isCount(o.breach_count)) throw new InvalidResponse();
  return { breach_count: o.breach_count };
};

const REG: Record<string, { pillar: string; label: string }> = {
  hex_contact_wa_verified: { pillar: 'contact', label: 'WhatsApp number verified' },
  hex_contact_display_name: { pillar: 'contact', label: 'WhatsApp display name' },
  hex_contact_profile_pic: { pillar: 'contact', label: 'Profile photo' },
  hex_contact_business_status: { pillar: 'contact', label: 'Business account' },
  hex_security_spam_flag: { pillar: 'security', label: 'Spam flags' },
  hex_security_breach_count: { pillar: 'security', label: 'Known breaches' },
};

interface Fields { status: Hexagon['status']; data: string | null; source: string; confidence?: number; exposure?: boolean }

/** The one place a Hexagon is built, so remediation is always injected from the mapper and never forgotten. */
function hex(id: keyof typeof REG, f: Fields): Hexagon {
  const out: Hexagon = {
    id, pillar: REG[id].pillar, label: REG[id].label,
    status: f.status, data: f.data, source: f.source, remediation: remediationFor(id),
    exposure: f.exposure ?? false,
  };
  if (f.confidence !== undefined) out.confidence_score = f.confidence;
  return out;
}
const notChecked = (id: keyof typeof REG, source: string): Hexagon => hex(id, { status: 'not_checked', data: null, source });

/** Only the person's own display name may be echoed; control characters stripped, length capped. */
// eslint-disable-next-line no-control-regex
const cleanName = (n?: string | null) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 64) : '');

export async function runOsintScan(
  contact: InboundContact,
  providers: OsintProviders,
  opts: { timeoutMs?: number } = {},
): Promise<OsintScan> {
  // PoP: no inbound message from this number, no lookups. Nothing is sent to any provider.
  if (!contact.inbound_message_timestamp || !/^\d{6,15}$/.test(contact.wa_id)) throw new ProofOfPossessionError();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  const [meta, spam, breach] = await Promise.allSettled([
    guarded('rapidapi_whatsapp_profile', providers.profileMetadata, contact.wa_id, timeoutMs, validateMetadata),
    guarded('spam_registry', providers.spamRegistry, contact.wa_id, timeoutMs, validateSpam),
    guarded('breach_db', providers.breachDb, contact.wa_id, timeoutMs, validateBreach),
  ]);
  // guarded() never rejects; a rejection here would be a bug, and is still reported as not checked.
  const settle = <T>(r: PromiseSettledResult<{ value: T | null; diag: Diagnostic }>, provider: string) =>
    r.status === 'fulfilled' ? r.value : { value: null, diag: { provider, outcome: 'error' as ProviderOutcome, ms: 0 } };
  const m = settle(meta, 'rapidapi_whatsapp_profile');
  const s = settle(spam, 'spam_registry');
  const b = settle(breach, 'breach_db');

  const hexagons: Hexagon[] = [];

  // Layer 1: Meta. The wa_id is confirmed by the inbound message itself; the name is whatever Meta passed along.
  hexagons.push(hex('hex_contact_wa_verified', { status: 'given', data: 'Verified by your message to us', source: 'meta_cloud_api', confidence: 1 }));
  const name = cleanName(contact.profile_name);
  hexagons.push(name
    ? hex('hex_contact_display_name', { status: 'given', data: name, source: 'meta_cloud_api', confidence: 1, exposure: true })
    : notChecked('hex_contact_display_name', 'meta_cloud_api'));

  // Layer 2: RapidAPI metadata.
  if (m.value) {
    hexagons.push(hex('hex_contact_profile_pic', {
      status: 'checked', data: m.value.profile_pic_exists ? 'Photo visible' : 'No photo', source: 'rapidapi_whatsapp_profile',
      confidence: 0.85, exposure: m.value.profile_pic_exists,
    }));
    hexagons.push(hex('hex_contact_business_status', {
      status: 'checked', data: m.value.is_business ? 'Business account' : 'Personal account', source: 'rapidapi_whatsapp_profile',
      confidence: 0.85, exposure: m.value.is_business,
    }));
  } else {
    hexagons.push(notChecked('hex_contact_profile_pic', 'rapidapi_whatsapp_profile'));
    hexagons.push(notChecked('hex_contact_business_status', 'rapidapi_whatsapp_profile'));
  }

  // Layer 3: spam registry and breach DB, each independent of the other.
  hexagons.push(s.value
    ? hex('hex_security_spam_flag', {
        status: 'checked', data: s.value.flag_count === 0 ? 'Clean' : `${s.value.flag_count} flag${s.value.flag_count === 1 ? '' : 's'}`,
        source: 'spam_registry', confidence: 0.9, exposure: s.value.flag_count > 0,
      })
    : notChecked('hex_security_spam_flag', 'spam_registry'));
  hexagons.push(b.value
    ? hex('hex_security_breach_count', {
        status: 'checked', data: b.value.breach_count === 0 ? 'None found' : `${b.value.breach_count} breach${b.value.breach_count === 1 ? '' : 'es'}`,
        source: 'breach_db', confidence: 0.9, exposure: b.value.breach_count > 0,
      })
    : notChecked('hex_security_breach_count', 'breach_db'));

  return { hexagons, diagnostics: [m.diag, s.diag, b.diag] };
}

/** verified_exposure_count: findings that count toward the score (checked / given / confirmed, never false_positive, disputed or unanswered) AND are exposures. */
export function verifiedExposureCount(hexagons: Hexagon[]): number {
  const scored = new Set<Hexagon['status']>(['checked', 'given', 'confirmed']);
  return hexagons.filter((h) => scored.has(h.status) && h.exposure === true).length;
}
