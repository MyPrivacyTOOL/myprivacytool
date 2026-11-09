// MPC-9883 (Open Tracker rule 6): schema, closed vocabulary and validator for the recipient registry. NO DATA lives in this file; the data is
// shared/recipients/recipients.json and src/config/recipients.ts is the only app-side import of it. Design: Notion "MPT > Open Tracker — Design &
// Build Plan (v1)" sections 1.1-1.3, repo copy docs/open-tracker-design-mpc-9882.md. Importable from the site, Pages Functions, Workers and Node.

/** Closed vocabulary of what a recipient can receive. Adding an item is a deliberate edit here, never a free-text value in the data. */
export const DATA_ITEMS = [
  "ip", "user_agent", "email", "email_hash", "email_domain", "name", "phone", "username", "country", "city", "device_profile", "utm",
  "referrer", "scan_result", "message_text", "plan_name", "password_hash_prefix", "page_load",
] as const;
export type DataItem = (typeof DATA_ITEMS)[number];

export const HOST_KINDS = ["fixed", "pattern", "user_supplied", "stun"] as const;
export const SURFACES = ["browser", "worker", "edge", "db"] as const;
export const PARTIES = ["first", "processor", "third", "platform"] as const;
export const CONSENT_BASES = ["service", "scan_consent", "analytics_consent", "user_action", "legitimate_interest"] as const;
export const PHASES = ["pre_click", "post_click"] as const;

export type HostKind = (typeof HOST_KINDS)[number];
export type Surface = (typeof SURFACES)[number];
export type Party = (typeof PARTIES)[number];
export type ConsentBasis = (typeof CONSENT_BASES)[number];
export type Phase = (typeof PHASES)[number];

export interface CountryOverride {
  enabled?: boolean;
  data_items_exclude?: DataItem[];
  note?: string;
}

export interface Recipient {
  key: string;
  name: string;
  hosts: string[];
  host_kind: HostKind;
  surface: Surface;
  data_items: DataItem[];
  purpose: string;
  party: Party;
  retention: { days: number | null; text: string };
  consent_basis: ConsentBasis;
  phase: Phase;
  enabled: boolean;
  flag: string | null;
  country_overrides: Record<string, CountryOverride>;
  dpa_listed: boolean;
  since: string;
  until: string | null;
  disclosure?: Record<string, string>;
  /** Required when phase is pre_click and party is not first: the named exception (design 8.2 etc.). */
  exception?: string;
  /** Required when enabled is false and there is no flag: why the entry is off. */
  reason?: string;
  note?: string;
  /** true for a recipient that is not live and not built yet (rule 7: registered before switch-on). */
  planned?: boolean;
}

export interface RecipientRegistry {
  schema_version: 1;
  recipients: Recipient[];
}

const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO2_RE = /^[A-Z]{2}$/;
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const isOneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

/** Returns every problem found; an empty array means valid. Never throws on bad input. */
export function validateRegistry(input: unknown): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["registry is not an object"];
  const file = input as { schema_version?: unknown; recipients?: unknown };
  if (file.schema_version !== 1) errs.push(`schema_version must be 1, got ${JSON.stringify(file.schema_version)}`);
  if (!Array.isArray(file.recipients)) return [...errs, "recipients must be an array"];
  const seen = new Set<string>();
  file.recipients.forEach((raw, i) => {
    const r = raw as Partial<Recipient> | null;
    const at = `recipients[${i}]${r && typeof r.key === "string" ? ` (${r.key})` : ""}`;
    if (!r || typeof r !== "object") { errs.push(`${at}: not an object`); return; }
    if (typeof r.key !== "string" || !KEY_RE.test(r.key)) errs.push(`${at}: key must be lowercase kebab-case`);
    else if (seen.has(r.key)) errs.push(`${at}: duplicate key`);
    else seen.add(r.key);
    if (typeof r.name !== "string" || !r.name.trim()) errs.push(`${at}: name is required`);
    if (typeof r.purpose !== "string" || !r.purpose.trim()) errs.push(`${at}: purpose is required (one plain sentence)`);
    if (!isOneOf(HOST_KINDS, r.host_kind)) errs.push(`${at}: host_kind must be one of ${HOST_KINDS.join("/")}`);
    if (!isOneOf(SURFACES, r.surface)) errs.push(`${at}: surface must be one of ${SURFACES.join("/")}`);
    if (!isOneOf(PARTIES, r.party)) errs.push(`${at}: party must be one of ${PARTIES.join("/")}`);
    if (!isOneOf(CONSENT_BASES, r.consent_basis)) errs.push(`${at}: consent_basis must be one of ${CONSENT_BASES.join("/")}`);
    if (!isOneOf(PHASES, r.phase)) errs.push(`${at}: phase must be one of ${PHASES.join("/")}`);
    if (typeof r.enabled !== "boolean") errs.push(`${at}: enabled must be a boolean`);
    if (typeof r.dpa_listed !== "boolean") errs.push(`${at}: dpa_listed must be a boolean`);
    if (!(r.flag === null || (typeof r.flag === "string" && r.flag.length > 0))) errs.push(`${at}: flag must be a string or null`);
    // hosts
    if (!Array.isArray(r.hosts)) errs.push(`${at}: hosts must be an array`);
    else {
      if (r.host_kind === "user_supplied" && r.hosts.length > 0) errs.push(`${at}: user_supplied entries must have no hosts`);
      if (r.host_kind !== "user_supplied" && r.hosts.length === 0 && r.planned !== true) errs.push(`${at}: hosts may be empty only for user_supplied (or a planned entry with no known host)`);
      for (const h of r.hosts) {
        if (typeof h !== "string" || !HOST_RE.test(h)) errs.push(`${at}: host ${JSON.stringify(h)} must be a bare lowercase host or *.suffix (no scheme, path or port)`);
        else if (r.host_kind === "fixed" && h.startsWith("*.")) errs.push(`${at}: wildcard host ${h} needs host_kind pattern`);
      }
      if (r.host_kind === "pattern" && !r.hosts.some((h) => typeof h === "string" && h.startsWith("*."))) errs.push(`${at}: host_kind pattern needs at least one *.suffix host`);
    }
    if (r.host_kind === "stun" && r.surface !== "browser") errs.push(`${at}: stun entries are browser-surface`);
    // data items
    if (!Array.isArray(r.data_items)) errs.push(`${at}: data_items must be an array`);
    else for (const d of r.data_items) if (!isOneOf(DATA_ITEMS, d)) errs.push(`${at}: data item ${JSON.stringify(d)} is not in the closed vocabulary`);
    // retention
    const ret = r.retention as Recipient["retention"] | undefined;
    if (!ret || typeof ret !== "object" || typeof ret.text !== "string" || !ret.text.trim() || !(ret.days === null || (Number.isInteger(ret.days) && ret.days >= 0))) {
      errs.push(`${at}: retention must be {days: integer>=0 or null, text: non-empty}`);
    }
    // dates
    if (typeof r.since !== "string" || !DATE_RE.test(r.since)) errs.push(`${at}: since must be YYYY-MM-DD`);
    if (!(r.until === null || (typeof r.until === "string" && DATE_RE.test(r.until)))) errs.push(`${at}: until must be YYYY-MM-DD or null`);
    else if (typeof r.until === "string" && typeof r.since === "string" && r.until < r.since) errs.push(`${at}: until is before since`);
    // country overrides
    if (!r.country_overrides || typeof r.country_overrides !== "object" || Array.isArray(r.country_overrides)) errs.push(`${at}: country_overrides must be an object`);
    else for (const [cc, ov] of Object.entries(r.country_overrides)) {
      if (!ISO2_RE.test(cc)) errs.push(`${at}: country_overrides key ${cc} must be an upper-case ISO-3166 alpha-2 code`);
      const ex = (ov as CountryOverride | null)?.data_items_exclude;
      if (ex !== undefined && (!Array.isArray(ex) || ex.some((d) => !isOneOf(DATA_ITEMS, d)))) errs.push(`${at}: country_overrides.${cc}.data_items_exclude must list vocabulary items`);
    }
    // cross-field rules (design 1.2 CI validation)
    if (r.phase === "pre_click" && r.party !== "first" && !(typeof r.exception === "string" && r.exception.trim())) {
      errs.push(`${at}: pre_click is for first-party entries only; a third party needs a named exception`);
    }
    if (r.enabled === false && r.flag == null && !(typeof r.reason === "string" && r.reason.trim())) errs.push(`${at}: a disabled entry without a flag needs a reason`);
    if (r.disclosure !== undefined && (typeof r.disclosure !== "object" || r.disclosure === null || Object.values(r.disclosure).some((s) => typeof s !== "string"))) {
      errs.push(`${at}: disclosure must map locale to sentence`);
    }
  });
  return errs;
}

export class RegistryValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`recipient registry is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "RegistryValidationError";
    this.problems = problems;
  }
}

/** Validates then returns the registry typed; throws RegistryValidationError listing every problem. */
export function parseRegistry(input: unknown): RecipientRegistry {
  const problems = validateRegistry(input);
  if (problems.length) throw new RegistryValidationError(problems);
  return input as RecipientRegistry;
}

export const findRecipient = (registry: RecipientRegistry, key: string): Recipient | undefined => registry.recipients.find((r) => r.key === key);

/** Exact host, or "*.suffix" which matches any sub-domain of suffix (not the bare suffix). Case-insensitive; a trailing dot is ignored. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => (p.startsWith("*.") ? h.length > p.length - 1 && h.endsWith(p.slice(1)) : h === p));
}

/** Truthy flag: true, or a non-empty string that is not 0/false/off/no. A key-presence flag (HUNTER_API_KEY) therefore counts as on when set. */
export function flagIsOn(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim() !== "" && !/^(0|false|off|no)$/i.test(value.trim());
}

const normCountry = (c: string | null | undefined): string | null => (c ? c.trim().toUpperCase() : null);

/** Is the recipient switched on for this country? (country_overrides.enabled === false turns it off there.) */
export function enabledForCountry(r: Recipient, country?: string | null): boolean {
  const cc = normCountry(country);
  return r.enabled && !(cc && r.country_overrides[cc]?.enabled === false);
}

/** The data items the recipient may receive for this country, after data_items_exclude. */
export function effectiveDataItems(r: Recipient, country?: string | null): DataItem[] {
  const cc = normCountry(country);
  const excluded = new Set((cc && r.country_overrides[cc]?.data_items_exclude) || []);
  return r.data_items.filter((d) => !excluded.has(d));
}
