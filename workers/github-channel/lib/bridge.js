/**
 * Channel data bridge (MPC-113): raw channel data -> classification -> sanitization -> PaPIT export.
 *
 * 1. classify(): every ingested record is tagged `core_identity` (durable facts: career, skills, projects),
 *    `ephemeral_behavioral` (one-off signals: a star, a single event) or `restricted` (direct identifiers
 *    that must never leave the Worker). Deterministic type rules, no LLM; unknown types fall back to
 *    `ephemeral_behavioral`, the least identity-bearing class.
 * 2. sanitize(): restricted records are dropped and the PII patterns below are stripped from free text.
 * 3. bridgeGithub(): feeds only the sanitized records to githubToPapit (MPC-115) and returns the PaPIT v1
 *    profile (with its own cryptographic_receipt) plus a sanitization receipt: SHA-256 over the rules
 *    version, redaction counts, record digests and the PaPIT receipt, so a consumer can tell which
 *    rule set produced the profile and that nothing was changed afterwards.
 */
import { githubToPapit, canonicalJson, sha256Hex } from './papit.js';
import { redditToPapit } from './reddit-papit.js';

export const RULES_VERSION = 'bridge-v1';
export const CORE_IDENTITY = 'core_identity';
export const EPHEMERAL = 'ephemeral_behavioral';
export const RESTRICTED = 'restricted';

const CORE_TYPES = new Set([
  'bio', 'repo', 'language', 'employment', 'education', 'certification', 'skill', 'org_membership', 'project_count',
]);
const EPHEMERAL_TYPES = new Set([
  'star', 'event', 'like', 'reaction', 'post', 'comment', 'follow', 'view', 'share', 'topic_interest',
]);
const RESTRICTED_TYPES = new Set([
  'email', 'name', 'login', 'username', 'location', 'company', 'blog', 'avatar', 'profile_url', 'user_id', 'phone', 'address',
]);

/** @param {{type:string}} record */
export function classify(record) {
  const t = String(record?.type || '').toLowerCase();
  if (RESTRICTED_TYPES.has(t)) return RESTRICTED;
  if (CORE_TYPES.has(t)) return CORE_IDENTITY;
  if (EPHEMERAL_TYPES.has(t)) return EPHEMERAL;
  return EPHEMERAL;
}

// Order matters: URLs and emails go first so their parts are not re-matched by the later, looser patterns.
export const PII_PATTERNS = [
  ['url', /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi],
  ['email', /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi],
  ['handle', /(?<![\w@])@[a-z0-9](?:[a-z0-9-]{0,38})\b/gi],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['card', /\b(?:\d[ -]?){13,19}\b/g],
  ['ipv4', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g],
  ['phone', /(?<![\w.])\+?\d[\d\s().-]{7,}\d\b/g],
];

/** Replace every PII pattern in `text`; returns the clean text and a per-pattern hit count. */
export function sanitizeText(text) {
  const hits = {};
  let out = String(text ?? '');
  for (const [name, re] of PII_PATTERNS) {
    out = out.replace(re, () => { hits[name] = (hits[name] || 0) + 1; return `[redacted:${name}]`; });
  }
  return { text: out, hits };
}

const addHits = (into, from) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] || 0) + v; };

/**
 * @param {{type:string, text?:string}[]} records
 * @returns {{records: object[], redactions: Record<string,number>, dropped: number}}
 */
export function sanitize(records) {
  const redactions = {};
  let dropped = 0;
  const out = [];
  for (const rec of records) {
    const cls = rec.class || classify(rec);
    if (cls === RESTRICTED) { dropped++; continue; }
    if (typeof rec.text === 'string') {
      const { text, hits } = sanitizeText(rec.text);
      addHits(redactions, hits);
      out.push({ ...rec, class: cls, text });
    } else {
      out.push({ ...rec, class: cls });
    }
  }
  return { records: out, redactions, dropped };
}

/** Flatten raw GitHub data into typed records. Every profile field is represented so none bypasses classification. */
export function githubRecords(raw) {
  const { profile = {}, repos = [], starred = [], events = [] } = raw || {};
  const recs = [];
  for (const [type, key] of [['email', 'email'], ['name', 'name'], ['login', 'login'], ['location', 'location'],
    ['company', 'company'], ['blog', 'blog'], ['avatar', 'avatar_url'], ['profile_url', 'html_url'], ['user_id', 'id']]) {
    if (profile[key] != null && profile[key] !== '') recs.push({ type, text: String(profile[key]) });
  }
  if (profile.bio) recs.push({ type: 'bio', text: profile.bio });
  if (Number.isFinite(profile.public_repos)) recs.push({ type: 'project_count', value: profile.public_repos });
  for (const r of repos) {
    recs.push({
      type: 'repo', language: r.language || null, topics: r.topics || [], fork: !!r.fork, private: !!r.private,
    });
  }
  for (const s of starred) recs.push({ type: 'star', topics: s.topics || [] });
  for (const e of events) recs.push({ type: 'event', created_at: e.created_at });
  return recs;
}

/** Rebuild the raw shape githubToPapit expects, from sanitized records only. */
function toRaw(records) {
  const raw = { profile: {}, repos: [], starred: [], events: [] };
  const cleanTopics = (topics) => topics.map((t) => sanitizeText(t).text);
  for (const r of records) {
    if (r.type === 'bio') raw.profile.bio = r.text;
    else if (r.type === 'project_count') raw.profile.public_repos = r.value;
    else if (r.type === 'repo') {
      raw.repos.push({
        language: r.language ? sanitizeText(r.language).text : null, topics: cleanTopics(r.topics), fork: r.fork, private: r.private,
      });
    } else if (r.type === 'star') raw.starred.push({ topics: cleanTopics(r.topics) });
    else if (r.type === 'event') raw.events.push({ created_at: r.created_at });
  }
  return raw;
}

const digestRecords = (records) => sha256Hex(canonicalJson(records));

/**
 * Shared pipeline tail: classify -> sanitize -> build the PaPIT profile from SANITIZED records only -> receipts.
 * @returns {Promise<{papit: object, sanitization: object, sanitization_receipt: string, classification: Record<string,number>}>}
 */
async function runBridge(rawRecords, buildPapit) {
  const classified = rawRecords.map((r) => ({ ...r, class: classify(r) }));
  const classification = { [CORE_IDENTITY]: 0, [EPHEMERAL]: 0, [RESTRICTED]: 0 };
  for (const r of classified) classification[r.class]++;

  const { records, redactions, dropped } = sanitize(classified);
  const papit = await buildPapit(records);

  const sanitization = {
    rules_version: RULES_VERSION,
    records_in: classified.length,
    records_out: records.length,
    records_dropped: dropped,
    redactions,
    output_digest: await digestRecords(records),
    papit_receipt: papit.cryptographic_receipt,
  };
  return {
    papit, sanitization, classification, sanitization_receipt: await sha256Hex(canonicalJson(sanitization)),
  };
}

/** Full pipeline for the GitHub channel. */
export function bridgeGithub(raw, { now = new Date() } = {}) {
  return runBridge(githubRecords(raw), (records) => githubToPapit(toRaw(records), { now }));
}

/**
 * Flatten raw Reddit activity into typed records. The handle and id are restricted (dropped); comments and
 * posts are ephemeral behavioral records whose text is sanitized before the transformer sees it.
 */
export function redditRecords(raw) {
  const recs = [];
  if (raw?.username) recs.push({ type: 'username', text: String(raw.username) });
  if (raw?.id) recs.push({ type: 'user_id', text: String(raw.id) });
  recs.push({ type: 'account_stats', created_utc: Number(raw?.accountCreatedUtc ?? 0), karma: Number(raw?.totalKarma ?? 0) });
  for (const c of raw?.comments ?? []) {
    recs.push({ type: 'comment', subreddit: c.subreddit, text: c.body, score: c.score, controversiality: c.controversiality, created_utc: c.createdUtc });
  }
  for (const s of raw?.submissions ?? []) {
    recs.push({ type: 'post', subreddit: s.subreddit, text: s.title, score: s.score, created_utc: s.createdUtc });
  }
  return recs;
}

/** Rebuild the raw shape redditToPapit expects, from sanitized records only (no handle, no id). */
function toRedditRaw(records) {
  const raw = { accountCreatedUtc: 0, comments: [], submissions: [] };
  for (const r of records) {
    if (r.type === 'account_stats') raw.accountCreatedUtc = r.created_utc;
    else if (r.type === 'comment') {
      raw.comments.push({ subreddit: r.subreddit, body: r.text, score: r.score, controversiality: r.controversiality, createdUtc: r.created_utc });
    } else if (r.type === 'post') {
      raw.submissions.push({ subreddit: r.subreddit, title: r.text, score: r.score, createdUtc: r.created_utc });
    }
  }
  return raw;
}

/** Full pipeline for the Reddit channel. The handle is passed separately, only to scrub it from free text. */
export function bridgeReddit(raw, { now = new Date() } = {}) {
  return runBridge(redditRecords(raw), (records) => redditToPapit(toRedditRaw(records), { now, username: raw?.username }));
}

/** Recompute the sanitization receipt and check it still points at this PaPIT profile. */
export async function verifySanitizationReceipt({ papit, sanitization, sanitization_receipt: receipt }) {
  return sanitization.papit_receipt === papit.cryptographic_receipt
    && receipt === await sha256Hex(canonicalJson(sanitization));
}
