// MPC-9894 (Open Tracker design section 5): the legal-page blocks that name who receives a visitor's data, generated from the registry and nothing else.
// Privacy "Who receives your data", the Cookies recipient list and the DPA sub-processor list are all built HERE from shared/recipients/recipients.json
// through renderDisclosure (shared/recipients/disclosure.ts, MPC-9893). No recipient sentence is typed in a page: add, switch off or end a recipient in
// the registry and `node scripts/render-privacy-from-registry.mjs` (run by hand: `npm run legal-blocks`; CI fails on a stale file) rewrites src/data/legalBlocks.generated.json, which the pages render.
// A test (src/data/legalBlocks.test.ts) fails if that file is out of date, or if a recipient host or provider name is typed in a legal page outside it.
//
// Pure: no DOM, no I/O, no clock. "Today" is the registry's own latest date (registryDate), so the same registry always gives the same file.
//
// Locales: English is the written text. For the other nine locales the same blocks are produced IN ENGLISH with `translation_pending: true` and a
// plain note, instead of leaving old text behind. The translations are one ClaudeKing task (see the MPC-9894 hand-off).
import { renderDisclosure, isLive, isRemoved, registryDate, PARTY_ORDER, LOCALES, type Locale } from "./disclosure.ts";
import type { Recipient, Party } from "./registry.ts";
import { CONSENT_CONFIG } from "./consent-config.ts";

/**
 * Flags known to be OFF in production today. An entry gated by one of these is not live: the pages say it is planned and nothing is sent. Every other
 * flagged entry is a secret or build variable that is set where the service runs; the registry's `enabled` is its word that the call is allowed, and the
 * lists say so ("a service is only called where its setting is on"). Pinned to FEATURE_STATUS.F3 by a test.
 */
export const FLAGS_KNOWN_OFF: readonly string[] = ["CHECKOUT_ENABLED"];

export const TRANSLATION_PENDING_NOTE = "This section is shown in English while its translation is pending. The English text is the one that applies.";

const PARTY_TITLE: Record<Party, { title: string; intro: string }> = {
  first: { title: "Run by us", intro: "These are our own services. Nothing in this group is an outside company." },
  processor: { title: "Companies that process data for us", intro: "They act on our instructions and may not use the data for their own purposes." },
  platform: { title: "Messaging and social platforms you choose to use", intro: "They see what you send us through them, under their own terms." },
  third: { title: "Other outside services", intro: "Independent services we call, or that your browser calls, as listed." },
};

export interface LegalItem { key: string; name: string; text: string }
export interface LegalGroup { party: Party; title: string; intro: string; items: LegalItem[] }
export interface SubProcessor { key: string; name: string; purpose: string; retention: string }
export interface RemovedItem { key: string; name: string; until: string }

export interface LegalBlocks {
  locale: Locale;
  translation_pending: boolean;
  translation_note: string | null;
  as_of: string;
  privacy: {
    groups: LegalGroup[];
    switched_off: LegalItem[];
    removed: RemovedItem[];
    visit_log_sentence: string;
    visit_log_raw_days: number;
  };
  cookies: { items: LegalItem[]; switched_off: LegalItem[] };
  dpa: { sub_processors: SubProcessor[] };
}

const stripDot = (s: string) => s.replace(/\s+$/, "");

/** The one-sentence visit-log disclosure (design 3.5), with the raw-IP window read from the registry's visit-log entry. */
export function visitLogSentence(days: number): string {
  return `When you arrive, we log your IP address (in full for up to ${days} days in some countries, shortened or not at all in others), the page that sent you, any campaign tags, your country and device type, so we can tell which of our posts and pages bring visitors; this log is kept apart from your scan and your account and is never joined to them.`;
}

function switchedOffText(e: Recipient): string {
  const items = e.data_items.length ? e.data_items.join(", ").replace(/_/g, " ") : "nothing";
  return `${e.name} (planned, not yet open): ${stripDot(e.purpose)} Today it is switched off and nothing is sent to it. When paid plans open, it will receive: ${items}. Kept: ${e.retention.text.toLowerCase()}.`;
}

function partition(registry: readonly Recipient[]) {
  const asOf = registryDate(registry);
  const live: Recipient[] = [];
  const off: Recipient[] = [];
  const removed: Recipient[] = [];
  for (const e of registry) {
    if (e.planned) continue;
    if (isRemoved(e, asOf)) { removed.push(e); continue; }
    if (!isLive(e, asOf)) continue;
    if (e.flag && FLAGS_KNOWN_OFF.includes(e.flag)) { off.push(e); continue; }
    live.push(e);
  }
  return { asOf, live, off, removed };
}

export function buildLegalBlocks(registry: readonly Recipient[], locale: Locale = "en"): LegalBlocks {
  const { asOf, live, off, removed } = partition(registry);
  const item = (e: Recipient): LegalItem => ({
    key: e.key,
    name: e.name,
    // An entry that is sent no visitor data says so, instead of "receives —".
    text: e.data_items.length || e.disclosure?.en ? renderDisclosure(e, "en") : `${e.name} receives no visitor data. Why: ${stripDot(e.purpose)} Kept: ${e.retention.text}.`,
  });
  const visit = registry.find((r) => r.key === "visit-log");
  if (!visit || visit.retention.days === null) throw new Error("legal-blocks: the registry has no visit-log entry with a raw-IP window");
  const groups: LegalGroup[] = PARTY_ORDER.map((party) => ({
    party,
    ...PARTY_TITLE[party],
    items: live.filter((e) => e.party === party).map(item),
  })).filter((g) => g.items.length > 0);
  const pending = locale !== "en";
  return {
    locale,
    translation_pending: pending,
    translation_note: pending ? TRANSLATION_PENDING_NOTE : null,
    as_of: asOf,
    privacy: {
      groups,
      switched_off: off.map((e) => ({ key: e.key, name: e.name, text: switchedOffText(e) })),
      removed: removed.map((e) => ({ key: e.key, name: e.name, until: String(e.until) })),
      visit_log_sentence: visitLogSentence(visit.retention.days),
      visit_log_raw_days: visit.retention.days,
    },
    cookies: {
      // The services a browser contacts itself (surface "browser"), apart from our own: what a cookie or storage notice has to name.
      items: live.filter((e) => e.surface === "browser" && e.party !== "first").map(item),
      switched_off: off.filter((e) => e.surface === "browser").map((e) => ({ key: e.key, name: e.name, text: switchedOffText(e) })),
    },
    dpa: {
      sub_processors: [...live, ...off].filter((e) => e.dpa_listed && e.party !== "first").map((e) => ({
        key: e.key,
        name: e.name,
        purpose: stripDot(e.purpose),
        retention: e.retention.text,
      })),
    },
  };
}

/** Every locale's blocks, keyed by locale. */
export function buildAllLegalBlocks(registry: readonly Recipient[]): Record<Locale, LegalBlocks> {
  return Object.fromEntries(LOCALES.map((l) => [l, buildLegalBlocks(registry, l)])) as Record<Locale, LegalBlocks>;
}

/** Retention by relationship (design 4.1), from the one config value; {N} is the consent config's n_hours in days. */
export function retentionByRelationship(nHours: number = CONSENT_CONFIG.n_hours) {
  const days = nHours % 24 === 0 ? `${nHours / 24} days` : `${nHours} hours`;
  return { days, nHours };
}
