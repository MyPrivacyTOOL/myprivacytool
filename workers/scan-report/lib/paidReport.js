// MPC-9816 (F2 Paid Exposure Report). Pure helpers + the signed export link. Spec: docs/paid-report-spec-mpc-9815.md (krispyking/openclaw26), Option A (Chris, 2026-11-07).
// Rules kept here: the gate sits where the work is done (callers ask `sectionState` BEFORE running a paid check); a Free reader sees the section in an honest
// "not checked" state, never a blurred or masked paid result; every value carries source and confidence; no IP values in an export body; no price is typed here.
import { sectionState } from './entitlements.js';
import PLANS from './plans.generated.js';
import { sign, sameString } from './live.js';
import { WEB_HEXAGONS, EMAIL_HEXAGONS, normaliseHexagons, tally } from './reportHex.js';

export const EXPORT_SCHEMA_VERSION = 1;
export const PDF_MAX_BYTES = 2 * 1024 * 1024;
export const JSON_MAX_BYTES = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- config (env overrides; defaults are the decided values) -----------------------------------------------------------------------
export const retentionMonths = (env) => { const n = Number(env?.REPORT_RETENTION_MONTHS); return Number.isInteger(n) && n > 0 && n <= 120 ? n : 12; };   // Q1, Chris 2026-11-08: 12 months
export const exportLinkDays = (env) => { const n = Number(env?.EXPORT_LINK_DAYS); return Number.isInteger(n) && n > 0 && n <= 30 ? n : 7; };

/** Scans inside the retention window only. A scan older than retention is absent from history and from export. */
export function withinRetention(scans, env, now = Date.now()) {
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - retentionMonths(env));
  return (Array.isArray(scans) ? scans : []).filter((s) => { const t = Date.parse(s?.created_at); return Number.isFinite(t) && t >= cut.getTime(); });
}

// ---- the Free -> Basic upgrade moment (spec s2) --------------------------------------------------------------------------------------
/** "$7.99" for the Basic plan, from the plans data (src/data/plans.generated.json via lib/plans.generated.js). Never typed here. null if the plan is missing. */
export async function loadBasicPrice() {
  const c = PLANS.find((x) => x.slug === 'basic')?.monthly_price_cents;
  if (!Number.isInteger(c) || c <= 0) return null;
  const d = c / 100; return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

/** The one upgrade sentence, or null for a reader whose plan already has licensed broker coverage (Basic and up). Carries the "In build" marker until that source is live. */
export function upgradeSentence(ent, basicPrice) {
  const lic = sectionState(ent, 'broker.licensed_lookup');
  if (lic.allowed) return null;
  const badge = lic.status === 'live' ? '' : ' (In build)';
  return `Your free report did not search data brokers for listings in your name. Basic${basicPrice ? `, ${basicPrice} a month,` : ''} does that, with proof and a removal guide for each listing, and keeps every report for you.${badge}`;
}

export const BREACH_FREE_TEXT = 'Breaches: NOT CHECKED. The free report does not check breach databases for you. You can check any address yourself at https://haveibeenpwned.com/.';
export const breachGate = (env, ent) => (env?.BREACH_GATE_ENABLED === 'true' ? sectionState(ent, 'breach.check') : { state: 'content', allowed: true });

// ---- export document ---------------------------------------------------------------------------------------------------------------------
const hexOut = (h, cls) => {
  const found = h.status === 'found';
  return {
    id: h.id, label: h.label, category: h.category, status: h.status, value: found ? String(h.value ?? '').slice(0, 300) : null,
    confidence: found ? (h.estimate ? 'low' : 'high') : null, is_guess: Boolean(h.estimate),
    source: { class: cls, provider: cls === 'browser' ? 'your browser' : (h.detail?.source || 'email lookup'), method: cls === 'browser' ? 'scan' : 'lookup' },
    not_checked_reason: h.status === 'not_checked' ? (h.detail?.reason || 'could not be checked') : null,
  };
};
const brokerOut = (r) => ({
  broker_id: r.key, state: r.state, match: r.match, confidence: r.confidence, is_guess: r.is_guess === true,
  source: { class: 'free', provider: r.state === 'not_checked' ? null : 'the page you showed us', method: r.state === 'not_checked' ? null : 'user_pasted_page', checked_at: r.checked_on },
  evidence_url: r.evidence_url, not_checked_reason: r.state === 'not_checked' ? r.text : null, optout_guide: r.guide ? (r.guide.optOutUrl || r.guide.slug || null) : null,
});

/** web: saved web scan results ({id, created_at, hexagons}); emailItems: [{id,status,value?,detail?}]; panel: buildBrokerPanel result; breach: {state, reason?}. No IP is added by this function. */
export function buildExportDocument({ scanNumber, tier, web, emailItems, panel, breach, generatedAt = new Date().toISOString() }) {
  const w = normaliseHexagons(WEB_HEXAGONS, web?.hexagons);
  const e = normaliseHexagons(EMAIL_HEXAGONS, emailItems);
  return {
    schema_version: EXPORT_SCHEMA_VERSION, scan_id: scanNumber, generated_at: generatedAt, tier_at_generation: tier,
    scan_created_at: web?.created_at ?? null,
    summary: { browser: tally(w), email: tally(e) },
    hexagons: w.map((h) => hexOut(h, 'browser')),
    email_checks: e.map((h) => hexOut(h, 'email')),
    brokers: [...panel.rows, ...panel.others].map(brokerOut),
    breach: breach || { state: 'not_checked', not_checked_reason: 'not checked' },
  };
}

/** Values for an IP address are dropped from an export body (spec s4). */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const V6RUN = /(?<![0-9a-z:])[0-9a-f:]{3,45}(?![0-9a-z:])/gi;   // a run of hex and colons; it is an IPv6 address only with '::' or all 7 colons (so 00:00:00 in a timestamp is kept)
export function stripIps(doc) {
  const s = JSON.stringify(doc, (_k, v) => (typeof v === 'string' ? v.replace(IPV4, '[address removed]').replace(V6RUN, (m) => (m.includes('::') || (m.match(/:/g) || []).length === 7 ? '[address removed]' : m)) : v));
  return JSON.parse(s);
}

// ---- a minimal PDF (text only, Helvetica) -------------------------------------------------------------------------------------------
const pdfText = (s) => String(s ?? '').replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
const wrap = (s, n = 95) => { const out = []; let t = String(s); while (t.length > n) { let i = t.lastIndexOf(' ', n); if (i < 20) i = n; out.push(t.slice(0, i)); t = t.slice(i).trimStart(); } out.push(t); return out; };
export function documentLines(doc) {
  const L = [`MyPrivacyTOOL exposure report`, `Scan ${doc.scan_id}   generated ${doc.generated_at}   plan ${doc.tier_at_generation}`, '',
    `Browser: ${doc.summary.browser.found} found, ${doc.summary.browser.clear} clear, ${doc.summary.browser.not_checked} not checked.`,
    `Email: ${doc.summary.email.found} found, ${doc.summary.email.clear} clear, ${doc.summary.email.not_checked} not checked.`, '', 'BROWSER CHECKS'];
  const hx = (h) => `${h.label}: ${h.status.toUpperCase().replace('_', ' ')}${h.value ? ` - ${h.value.slice(0, 120)}` : ''} [source: ${h.source.provider}${h.confidence ? `, confidence: ${h.confidence}` : ''}${h.is_guess ? ', a guess' : ''}]${h.not_checked_reason ? ` (${h.not_checked_reason})` : ''}`;
  doc.hexagons.forEach((h) => L.push(...wrap(hx(h))));
  L.push('', 'EMAIL CHECKS'); doc.email_checks.forEach((h) => L.push(...wrap(hx(h))));
  L.push('', 'DATA BROKERS');
  doc.brokers.forEach((b) => L.push(...wrap(`${b.broker_id}: ${b.state.toUpperCase().replace('_', ' ')}${b.confidence ? ` (confidence ${b.confidence}${b.is_guess ? ', a guess' : ''})` : ''}${b.evidence_url ? ` evidence: ${b.evidence_url}` : ''}${b.not_checked_reason ? ` - ${b.not_checked_reason}` : ''}`)));
  L.push('', 'BREACHES', ...wrap(`${String(doc.breach.state).toUpperCase().replace('_', ' ')}${doc.breach.not_checked_reason ? ` - ${doc.breach.not_checked_reason}` : ''}`));
  return L;
}
export function renderPdf(doc) {
  const lines = documentLines(doc).map(pdfText); const per = 58; const pages = [];
  for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
  const objs = []; // 1 catalog, 2 pages, 3 font, then page/content pairs
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'; objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`; objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((p, i) => {
    const stream = `BT /F1 9 Tf 12 TL 40 800 Td ${p.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n'; const off = [];
  for (let n = 1; n < objs.length; n++) { off[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const x = out.length; out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${off.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

// ---- the signed, expiring export link ------------------------------------------------------------------------------------------------
const FORMATS = ['pdf', 'json'];
export const isFormat = (f) => FORMATS.includes(f);
export async function makeExportToken(env, accountId, scanNumber, format, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || !UUID_RE.test(accountId) || !UUID_RE.test(scanNumber) || !isFormat(format)) return null;
  const exp = now + exportLinkDays(env) * 24 * 3600 * 1000;
  return { token: `${accountId}.${scanNumber}.${format}.${exp}.${await sign(env.UNSUBSCRIBE_SECRET, `export:${accountId}:${scanNumber}:${format}:${exp}`)}`, expires_at: new Date(exp).toISOString() };
}
export async function readExportToken(env, token, now = Date.now()) {
  if (!env.UNSUBSCRIBE_SECRET || typeof token !== 'string' || token.length > 300) return null;
  const [a, s, f, exp, sig, extra] = token.split('.');
  if (extra !== undefined || !UUID_RE.test(a || '') || !UUID_RE.test(s || '') || !isFormat(f) || !/^\d{10,15}$/.test(exp || '') || !sig || Number(exp) < now) return null;
  return sameString(sig, await sign(env.UNSUBSCRIBE_SECRET, `export:${a}:${s}:${f}:${exp}`)) ? { accountId: a.toLowerCase(), scanNumber: s.toLowerCase(), format: f } : null;
}
