/**
 * OSINT Lookup Module — MPC-7252
 * Passive breach/paste lookup via Have I Been Pwned (read-only GETs).
 *
 * - Only email is answerable by HIBP. phone/handle/domain return status "not_checked" (never a guessed score).
 * - Missing key, timeout, 429, 401/403 and 5xx also return "not_checked" so a failed check is never shown as "safe".
 * - The API key is passed in by the caller (Worker env); this module never reads process.env.
 * - 24h cache keyed by SHA-256 of type+value; the raw value is never stored or echoed in errors.
 */

// Types
export type InputType = 'email' | 'phone' | 'handle' | 'domain';
export type LookupStatus = 'checked' | 'not_checked';

export interface HibpBreach {
  name: string;
  date: string; // YYYY-MM-DD
  dataClasses: string[];
  pwnCount?: number;
  description?: string;
}

export interface HibpPaste {
  id: string;
  date: string;
  count: number;
  source: string;
}

export interface OsintLookupResult {
  inputValue: string;
  inputType: InputType;
  status: LookupStatus;
  /** Why a lookup is "not_checked": unsupported_type | no_api_key | rate_limited | timeout | upstream_error */
  reason?: string;
  breaches: HibpBreach[];
  pastes: HibpPaste[];
  breachCount: number;
  pasteCount: number;
  timestamp: string;
  cached: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface OsintLookupOptions {
  skipCache?: boolean;
  /** HIBP API key (paid). Without it, email lookups return "not_checked". */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class OsintValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'OsintValidationError';
  }
}

// Configuration
const HIBP_API_BASE = 'https://haveibeenpwned.com/api/v3';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const API_TIMEOUT_MS = 5000;
const CACHE_KEY_PREFIX = 'mpt_osint_';
const USER_AGENT = 'MyPrivacyTOOL-Mirror/1.0 (+https://myprivacytool.io)';

// In-memory, per-isolate cache. Stores results WITHOUT the raw input value.
interface CacheEntry {
  result: Omit<OsintLookupResult, 'inputValue'>;
  timestamp: number;
}
const osintCache = new Map<string, CacheEntry>();

async function generateCacheKey(value: string, type: InputType): Promise<string> {
  const data = new TextEncoder().encode(`${type}:${value.trim().toLowerCase()}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${CACHE_KEY_PREFIX}${hashHex}`;
}

async function getCached(inputValue: string, inputType: InputType): Promise<OsintLookupResult | null> {
  try {
    const key = await generateCacheKey(inputValue, inputType);
    const cached = osintCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.result, inputValue, cached: true };
    }
    if (cached) osintCache.delete(key);
    return null;
  } catch {
    return null;
  }
}

async function setCached(result: OsintLookupResult): Promise<void> {
  try {
    const key = await generateCacheKey(result.inputValue, result.inputType);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inputValue: _omit, ...rest } = result;
    osintCache.set(key, { result: rest, timestamp: Date.now() });
  } catch {
    // cache is an optimisation, not the critical path
  }
}

function validateInput(value: string, type: InputType): boolean {
  if (!value || value.trim().length === 0) return false;
  switch (type) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'phone':
      return /^[\d\s\-+()]{7,}$/.test(value.replace(/\s/g, ''));
    case 'handle':
      return /^[a-zA-Z0-9_-]{3,50}$/.test(value);
    case 'domain':
      return /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value);
    default:
      return false;
  }
}

class NotCheckedError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** One read-only HIBP GET. 404 means "nothing found". Anything else that is not 200 means "not checked". */
async function hibpGet(path: string, email: string, apiKey: string, fetchImpl: typeof fetch): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${HIBP_API_BASE}/${path}/${encodeURIComponent(email)}?truncateResponse=false`, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, 'hibp-api-key': apiKey },
      signal: controller.signal,
    });
    if (response.status === 404) return [];
    if (response.status === 429) throw new NotCheckedError('rate_limited');
    if (!response.ok) throw new NotCheckedError('upstream_error');
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof NotCheckedError) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw new NotCheckedError('timeout');
    throw new NotCheckedError('upstream_error');
  } finally {
    clearTimeout(timeout);
  }
}

function notChecked(inputValue: string, inputType: InputType, reason: string): OsintLookupResult {
  return {
    inputValue,
    inputType,
    status: 'not_checked',
    reason,
    breaches: [],
    pastes: [],
    breachCount: 0,
    pasteCount: 0,
    timestamp: new Date().toISOString(),
    cached: false,
    confidence: 'low',
  };
}

/**
 * Main OSINT lookup. Throws OsintValidationError on malformed input (message never echoes the value).
 * Never throws for upstream problems: those return status "not_checked".
 */
export async function osintLookup(
  inputValue: string,
  inputType: InputType,
  options: OsintLookupOptions = {}
): Promise<OsintLookupResult> {
  const codes: Record<InputType, string> = {
    email: 'INVALID_EMAIL',
    phone: 'INVALID_PHONE',
    handle: 'INVALID_HANDLE',
    domain: 'INVALID_DOMAIN',
  };
  if (!validateInput(inputValue, inputType)) {
    throw new OsintValidationError(codes[inputType] ?? 'INVALID_INPUT', `Invalid ${inputType} format`);
  }

  // HIBP cannot answer phone/handle/domain: say so instead of guessing.
  if (inputType !== 'email') return notChecked(inputValue, inputType, 'unsupported_type');
  if (!options.apiKey) return notChecked(inputValue, inputType, 'no_api_key');

  if (!options.skipCache) {
    const cached = await getCached(inputValue, inputType);
    if (cached) return cached;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let result: OsintLookupResult;
  try {
    const [rawBreaches, rawPastes] = await Promise.all([
      hibpGet('breachedaccount', inputValue, options.apiKey, fetchImpl),
      hibpGet('pasteaccount', inputValue, options.apiKey, fetchImpl),
    ]);
    const breaches: HibpBreach[] = rawBreaches.map((b) => ({
      name: b.Name,
      date: b.BreachDate,
      dataClasses: b.DataClasses || [],
      pwnCount: b.PwnCount,
      description: b.Description,
    }));
    const pastes: HibpPaste[] = rawPastes.map((p) => ({ id: p.Id, date: p.Date, count: p.EmailCount ?? p.Count, source: p.Source }));
    result = {
      inputValue,
      inputType,
      status: 'checked',
      breaches,
      pastes,
      breachCount: breaches.length,
      pasteCount: pastes.length,
      timestamp: new Date().toISOString(),
      cached: false,
      confidence: 'high',
    };
  } catch (err) {
    // Failures are not cached, so a retry can succeed.
    return notChecked(inputValue, inputType, err instanceof NotCheckedError ? err.reason : 'upstream_error');
  }

  await setCached(result);
  return result;
}

/** Bulk lookup for multiple values */
export async function osintLookupBulk(
  inputs: Array<{ value: string; type: InputType }>,
  options: OsintLookupOptions = {}
): Promise<OsintLookupResult[]> {
  return Promise.all(inputs.map(({ value, type }) => osintLookup(value, type, options)));
}

/** Clear cache (testing / manual refresh) */
export function clearOsintCache(): void {
  osintCache.clear();
}

/** Cache stats (monitoring) */
export function getOsintCacheStats() {
  return { entriesCount: osintCache.size, maxAge: CACHE_TTL_MS };
}
