// MPC-9814 (F1 results, Chris Decision 7): ONE place that turns "the pages the visitor showed us" into the broker panel every surface renders:
// the email-link results page, the /scan on-screen panel, and the report email. Wording lives here only, so the three cannot disagree.
// Contract: docs/broker-lookup-contract-mpc-9812.md section 6. No automated broker search exists: a broker is "listed" or "not listed" only when
// the visitor pasted a page and we read that one page (lib/listingCheck.js); every other broker is "not checked" with the reason said in words.
import { BROKER_SITES, guideFor } from './brokers.js';
import { planName, sectionState } from './entitlements.js';
import { upgradeSentence } from './paidReport.js';

export const REGIONS = { spokeo: 'US', whitepages: 'US', beenverified: 'US', truthfinder: 'US', fastpeoplesearch: 'US', mylife: 'US', intelius: 'US', whitepages_au: 'Australia', truecaller: 'Phone directory' };

export const NOT_CHECKED_DEFAULT = "Not checked. We don't search broker sites for you. Paste a page that lists you, or paid coverage (coming) will check for you.";
export const NOT_CHECKED_NO_PASTE = "Not checked. We don't search broker sites for you, and paid coverage (coming) will check for you.";
export const NOT_CHECKED_SIGN_IN = "Not checked. A Truecaller lookup needs you to sign in, so we cannot read it for you. The guide shows how to take your number off.";
export const PANEL_INTRO = "We check a broker site only when you paste the address of a page that lists you. We search no broker site for you, and we use only details you typed about yourself and confirmed.";
export const PANEL_INTRO_NO_PASTE = "We search no broker site for you. Each site below has an opt-out guide you can follow yourself.";
export const NO_GUIDE_TEXT = "No guide yet for this site. Here is the general method: find its privacy or \"do not sell\" page, send its opt-out or deletion request for your listing, then look again in a few weeks.";
export const REGION_NOTE = "Hong Kong and Singapore: we know of no people-search site there that we can lawfully read, so nothing is checked for you in those places. The guides are still yours to use: they cover the do-not-call registers and your legal opt-out rights.";
export const COVERAGE_NOTE = "Paid coverage that checks these sites for you is coming. It is not live yet.";
// MPC-9818: the same section for a reader whose plan HAS the licensed coverage (Basic and up) while that coverage is not built. Never fake content: it says so.
export const NOT_CHECKED_INCLUDED = "Not checked. We don't search broker sites for you. Paste a page that lists you. The coverage that checks for you is included in your plan and is not live yet.";
export const NOT_CHECKED_INCLUDED_NO_PASTE = "Not checked. We don't search broker sites for you. The coverage that checks for you is included in your plan and is not live yet.";
export const COVERAGE_NOTE_INCLUDED = "Your plan includes broker coverage that checks these sites for you. It is not live yet, so nothing here is checked for you until it is.";

const REASON_WORDS = {
  fetch_blocked: 'the site would not let us read that page',
  timeout: 'the page took too long to answer',
  no_identifiers: 'no name or phone was given to look for',
  not_a_listing_page: 'that address is not a page we can read as a listing',
  not_in_free_coverage: "we don't search broker sites for you",
};
const MATCH_WORDS = { exact: 'an exact match for the details you gave', probable: 'a likely match (name matches, place only in part)', possible: 'a possible match' };
const CONF = { high: { word: 'High', n: 3 }, medium: { word: 'Medium', n: 2 }, low: { word: 'Low', n: 1 } };
const RANK = { listed: 0, not_listed: 1, not_checked: 2 };
const dateOf = (r) => String(r?.source?.checked_at || '').slice(0, 10) || null;

// not_listed on one page is only as strong as one page: Medium, or High when the site itself says the page is gone.
function confidenceOf(r) {
  if (r.state === 'listed') return r.confidence || ({ exact: 'high', probable: 'medium', possible: 'low' }[r.match] ?? null);
  if (r.state === 'not_listed') return r.note === 'page_gone' ? 'high' : 'medium';
  return null;
}

function rowText(r, name) {
  const d = dateOf(r);
  if (r.state === 'listed') {
    if (r.match === 'possible' || r.is_guess) return `We are guessing: ${name} shows a page that may be you. Check it yourself with the link.`;
    return `We found a listing that matches what you told us (${MATCH_WORDS[r.match] || 'a match'}).`;
  }
  if (r.state === 'not_listed') {
    return r.note === 'page_gone'
      ? `That page no longer exists${d ? ` (checked ${d})` : ''}.`
      : `No match for the details you gave on the page you showed us${d ? `, checked ${d}` : ''}. This is about that one page only, not the whole site.`;
  }
  return `Not checked: ${REASON_WORDS[r.not_checked_reason] || 'we could not check it'}. This is not a clear result.`;
}

function build(r, def) {
  const conf = confidenceOf(r);
  const key = def?.key ?? 'other';
  const name = def?.name ?? (r.name || r.host || 'Another site');
  const guide = def ? guideFor(def.guide) : null;
  return {
    key, name, region: def ? REGIONS[def.key] || null : null,
    state: r.state, match: r.match ?? null, is_guess: r.is_guess === true || r.match === 'possible',
    confidence: conf, confidence_word: conf ? CONF[conf].word : null, confidence_level: conf ? CONF[conf].n : 0,
    text: rowText(r, name), checked_on: dateOf(r),
    source: r.state === 'not_checked' ? 'Not checked' : 'The page you showed us',
    evidence_url: r.evidence_url && String(r.evidence_url).startsWith('https://') ? r.evidence_url : null,
    guide, no_guide_text: guide ? null : NO_GUIDE_TEXT,
  };
}

function defaultRow(def, pasteAvailable, included = false) {
  const signIn = def.fetchable === false;
  return {
    key: def.key, name: def.name, region: REGIONS[def.key] || null, state: 'not_checked', match: null, is_guess: false,
    confidence: null, confidence_word: null, confidence_level: 0,
    text: signIn ? NOT_CHECKED_SIGN_IN : included ? (pasteAvailable ? NOT_CHECKED_INCLUDED : NOT_CHECKED_INCLUDED_NO_PASTE) : pasteAvailable ? NOT_CHECKED_DEFAULT : NOT_CHECKED_NO_PASTE, checked_on: null, source: 'Not checked', evidence_url: null,
    guide: guideFor(def.guide), no_guide_text: null,
  };
}

/**
 * The broker panel. `listings` is { pending, items } from loadListings (or null / absent when nothing was pasted or the visitor has not confirmed).
 * Always returns all shortlist brokers in registry order, then any other site the visitor pasted. Never throws.
 */
export function buildBrokerPanel(listings, { pasteAvailable = true, entitlements = null, basicPrice = null } = {}) {
  const items = Array.isArray(listings?.items) ? listings.items : [];
  // MPC-9818: what this reader's plan has. No entitlements given = the Free reading (byte-identical to before). A Free reader still SEES the whole section, with the
  // honest paid-coverage note; the licensed check is never run for them, so there is nothing to hide, blur or truncate.
  const sec = entitlements ? sectionState(entitlements, 'report.broker_section_full') : { state: 'paid_coverage', min_tier: 'basic' };
  const included = sec.state === 'included_not_live';
  const rows = BROKER_SITES.map((def) => {
    const mine = items.filter((r) => r?.key === def.key).sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3));
    if (!mine.length) return defaultRow(def, pasteAvailable, included);
    const row = build(mine[0], def);
    const also = mine.slice(1).map((r) => ({ state: r.state, evidence_url: r.evidence_url && String(r.evidence_url).startsWith('https://') ? r.evidence_url : null }));
    return also.length ? { ...row, also } : row;
  });
  const others = items.filter((r) => r && !BROKER_SITES.some((d) => d.key === r.key)).map((r) => build(r, null));
  return { pending: listings?.pending === true, paste_available: pasteAvailable, intro: pasteAvailable ? PANEL_INTRO : PANEL_INTRO_NO_PASTE, rows, others, region_note: REGION_NOTE,
    coverage_note: sec.state === 'content' ? null : included ? COVERAGE_NOTE_INCLUDED : COVERAGE_NOTE,
    upgrade: upgradeSentence(entitlements, basicPrice),   // MPC-9816: the one Free-to-Basic sentence (null for Basic and up)
    coverage: { state: sec.state, min_tier: sec.min_tier ?? null, min_plan: sec.min_tier ? planName(sec.min_tier) : null } };
}

export const STATE_LABEL = { listed: 'Listed', not_listed: 'Not listed', not_checked: 'Not checked' };
