// MPC-7468: the two-part report. Part 1 replays every hexagon of the user's saved web scan, Part 2 shows the hexagons about their email
// address. One compact block (hexRow) renders every hexagon. Honest status per hexagon: FOUND (real value) / CHECKED AND CLEAR / NOT CHECKED.
// Everything that reaches the HTML is escaped here: values come from a browser, so they are untrusted text.
import HEX, { EMAIL } from './hexagons.generated.js';
// MPC-7471-F4: the one exposure score. Imported from the shared registry module, never re-implemented here.
import { computeExposure } from '../../../shared/hexagon-registry/score.js';

const SITE = 'https://myprivacytool.io';
const BRAND = '#15803d';
export const MAX_VALUE = 100;            // characters of a value shown in the email; the JSON attachment keeps the full value
export const MAX_DETAIL = 4000;          // characters of minor technical detail kept per hexagon in the JSON attachment
export const REPORT_JSON_VERSION = 1;
export const STATUS = { FOUND: 'found', CLEAR: 'clear', NOT_CHECKED: 'not_checked' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// eslint-disable-next-line no-control-regex
const clean = (v, max) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, ' ').trim()).slice(0, max).join('');

// ---- definitions -----------------------------------------------------------------------------------------------------------------
// Web hexagons come from the shared registry (shared/hexagon-registry/registry.js, via scripts/sync-hexagons.mjs).
// `unrated` = the registry says the site can never check it (truth level cannot_be_checked): always NOT CHECKED. `canClear` = the registry allows CHECKED AND CLEAR.
export const WEB_HEXAGONS = HEX.map(([id, label, category, kind, emoji, art, cannot, level, clear]) => ({ id, label, category, kind: kind === 'r' ? 'risk' : 'info', emoji, art, cannot: Boolean(cannot), unrated: level === 'x', estimateLevel: level === 'e', canClear: Boolean(clear) }));
// Email hexagons: the registry's email_hexagons (MPC-7467 owns the checks).
export const EMAIL_HEXAGONS = EMAIL.map(([id, label, category, kind, emoji, art, , level]) => ({ id, label, category, kind: kind === 'r' ? 'risk' : 'info', emoji, art, estimateLevel: level === 'e' }));
// Hexagons whose value is a guess, not a measurement: the registry's truth level 'estimated' (MPC-7487), or a saved item that says estimate:true.

export const GROUPS = {
  device: 'Your device', network: 'Your network', privacy: 'Your privacy settings', language: 'Your language', profile: 'Your estimated profile',
  orientation: 'Your device sensors', fingerprint: 'Your browser fingerprint', storage: 'What your browser stores', social: 'Your accounts and logins',
  security: 'Your connection security', behavior: 'How you behave on a page', email: 'Your email address',
};
// One short "what to change" line per category, shown only on FOUND hexagons. The fuller guide is linked from the site.
const GUIDE = '/blog/remove-personal-information-from-internet';
const CHANGE = {
  device: 'Use a browser that reports less, and keep it updated.', network: 'A VPN hides your provider and rough location from sites.',
  privacy: 'Turn on Global Privacy Control and block third-party cookies.', language: 'Fewer language and locale hints make you harder to single out.',
  profile: 'Sites guess this from your behaviour; block trackers to feed them less.', orientation: 'Deny motion and orientation permission to sites.',
  fingerprint: 'Use a browser with fingerprint protection and fewer extensions.', storage: 'Clear site data regularly or block third-party storage.',
  social: 'Sign out of big-tech accounts when browsing, or use separate profiles.', security: 'Fix or avoid sites with weak encryption and headers.',
  behavior: 'Behaviour tracking is hard to avoid; block trackers and scripts.', email: 'Use a separate email alias for sign-ups.',
};
const CHANGE_BY_ID = { 'email-breaches': 'Change the password on each breached service and anywhere you reused it; turn on two-factor sign-in.' };
export const changeFor = (h) => CHANGE_BY_ID[h.id] || CHANGE[h.category] || CHANGE.device;
const GUIDES = { email: '/blog/remove-personal-information-from-internet' };

// ---- adapter: saved scan / email checks + definitions -> uniform hexagon objects -----------------------------------------------------
// Input item: { id, status: 'found'|'clear'|'not_checked', value?, estimate?, detail? }. Unknown ids are kept only in the JSON.
// A hexagon missing from the input, or with an unknown status, is NOT CHECKED: absence is never reported as clear. An informational
// hexagon cannot be "clear" (the registry says there is nothing to be clear of), so a clear there also becomes NOT CHECKED.
export function normaliseHexagons(defs, items) {
  const byId = new Map((Array.isArray(items) ? items : []).filter((i) => i && typeof i.id === 'string').map((i) => [i.id, i]));
  return defs.map((d) => {
    const it = byId.get(d.id);
    let status; let reported = null;
    if (it && it.status === undefined) {
      // A scan saved before MPC-7487 carries no status, only what the browser reported: today's strict behaviour. Only a hexagon the code
      // CAN tell apart is FOUND: the 29 where it cannot tell clear from not checked (registry flag `cannot`, including the five social
      // ones) are NOT CHECKED, and so is any empty or placeholder value. Their reported value stays in the JSON.
      const v = clean(it.value, 1000);
      reported = v || null;
      status = !v || PLACEHOLDER.test(v) || d.cannot ? STATUS.NOT_CHECKED : STATUS.FOUND;
    } else {
      status = it && Object.values(STATUS).includes(it.status) ? it.status : STATUS.NOT_CHECKED;
      // The status came from the visitor's browser, so the registry has the last word: the hexagons the site can never check are NOT CHECKED
      // whatever was sent, FOUND needs a real value, and CLEAR is only allowed where the registry allows it (never for an informational one).
      if (d.unrated) status = STATUS.NOT_CHECKED;
      if (status === STATUS.FOUND && (!clean(it.value, 1000) || PLACEHOLDER.test(clean(it.value, 1000)))) status = STATUS.NOT_CHECKED;
      if (status === STATUS.CLEAR && (d.kind === 'info' || d.canClear === false)) status = STATUS.NOT_CHECKED;   // nothing to be clear of / not allowed
      if (status === STATUS.NOT_CHECKED) reported = clean(it?.value, 1000) || null;
    }
    const value = status === STATUS.FOUND ? clean(it.value, 1000) : '';
    const fromBrowser = it && ['confidence', 'risk', 'confirmed', 'icon'].some((k) => it[k] !== undefined);   // a saved browser scan item
    let detail = fromBrowser ? { confidence: it.confidence ?? null, risk: it.risk ?? null, confirmed_by_visitor: it.confirmed ?? null, icon: it.icon ?? null } : it?.detail ?? null;
    if (detail !== null) { try { const s = JSON.stringify(detail); if (s.length > MAX_DETAIL) detail = { truncated: true, preview: s.slice(0, MAX_DETAIL) }; } catch { detail = null; } }
    return { ...d, status, value, reported, estimate: Boolean(it?.estimate) || Boolean(d.estimateLevel), detail };
  });
}
const PLACEHOLDER = /^(location detected|unknown|n\/a|not available|none|undefined|null)$/i;

// Email hexagons from what the Worker already knows. Breaches come from the HIBP check; the other three arrive from MPC-7467 in `extra`
// (same item shape).
export function emailItems({ breachStatus, breaches = [], extra = [] }) {
  const names = breaches.map((b) => clean(b.Name, 60)).filter(Boolean);
  const br = breachStatus !== 'checked' ? { id: 'email-breaches', status: 'not_checked' }
    : breaches.length === 0 ? { id: 'email-breaches', status: 'clear' }
      : { id: 'email-breaches', status: 'found', value: `${breaches.length} ${breaches.length === 1 ? 'breach' : 'breaches'}: ${names.join(', ')}`, detail: breaches.map((b) => ({ name: clean(b.Name, 80), date: clean(b.BreachDate, 10), exposed: (b.DataClasses || []).map((c) => clean(c, 40)) })) };
  return [br, ...(Array.isArray(extra) ? extra.filter((e) => e && e.id !== 'email-breaches') : [])];
}

export const tally = (hexes) => ({ found: hexes.filter((h) => h.status === STATUS.FOUND).length, clear: hexes.filter((h) => h.status === STATUS.CLEAR).length, not_checked: hexes.filter((h) => h.status === STATUS.NOT_CHECKED).length, total: hexes.length });

// ---- one hexagon block, reused for every hexagon -------------------------------------------------------------------------------------
const PILL = {
  found: ['FOUND', '#92400e', '#fef3c7'], clear: ['CHECKED AND CLEAR', '#14532d', '#dcfce7'], not_checked: ['NOT CHECKED', '#4b5563', '#f3f4f6'],
};
export const guideUrl = (h, { html = false, campaign = 'scan-report' } = {}) => {
  const amp = html ? '&amp;' : '&';
  return `${SITE}${GUIDES[h.category] || GUIDE}?utm_source=email${amp}utm_medium=email${amp}utm_campaign=${campaign}${amp}utm_content=${encodeURIComponent(h.id)}`;
};
// An IP address is the most identifying value in a scan and an email can be forwarded or screenshotted, so it never appears in the body:
// it stays in the attached JSON (the user's own file). Matches IPv4 and IPv6 (including ::1 and IPv4-mapped forms).
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}|::[0-9a-f:.]+/gi;
export const IP_HIDDEN = '[IP address hidden here; it is in your attached file]';
const shown = (h) => {
  const v = clean(h.value, 1000).replace(IP_RE, IP_HIDDEN);
  const a = Array.from(v);
  return a.slice(0, MAX_VALUE).join('') + (a.length > MAX_VALUE ? '…' : '');
};
const statusTag = (h) => `${PILL[h.status][0]}${h.estimate && h.status === 'found' ? ' · ESTIMATE' : ''}`;

export function hexRow(h) {
  const [word, fg, bg] = PILL[h.status];
  const on = h.status !== 'not_checked';
  // Linked artwork when the registry has a file for it; otherwise the coloured hexagon glyph (filled = we know something, outline = not checked).
  const art = h.art ? `<img src="${SITE}/email/hex/${esc(h.art)}" width="32" height="32" alt="" style="display:block;border:0">` : `<span style="font-size:30px;line-height:30px;color:${on ? BRAND : '#9ca3af'}">${on ? '⬢' : '⬡'}</span>`;
  const note = h.status === 'found'
    ? `<div style="margin-top:3px;font-size:13px;line-height:19px;color:#111827">${esc(shown(h))}${h.estimate ? ' <i style="color:#6b7280">(our estimate, not measured)</i>' : ''}</div><div style="margin-top:3px;font-size:12px;line-height:18px;color:#374151"><b>Change:</b> ${esc(changeFor(h))} <a href="${guideUrl(h, { html: true })}" style="color:${BRAND}">Guide</a></div>`
    : h.id === 'email-breaches' && h.status === 'not_checked' ? `<div style="margin-top:3px;font-size:12px;line-height:18px;color:#6b7280">We have not checked your email against known data breaches. <a href="https://haveibeenpwned.com" style="color:${BRAND}">Check it yourself, free</a>.</div>` : '';
  return `<tr><td width="40" align="center" valign="top" style="padding:7px 0 7px 6px">${art}</td><td valign="top" style="padding:7px 8px;border-bottom:1px solid #f3f4f6;font-size:14px;line-height:20px;color:#111827">${esc(h.emoji)} <b>${esc(h.label)}</b> <span style="font-size:10px;font-weight:700;color:${fg};background:${bg};padding:1px 6px;border-radius:9px;white-space:nowrap">${esc(statusTag(h))}</span>${note}</td></tr>`;
};

// A group of hexagons under a heading: FOUND first, then CLEAR, then NOT CHECKED.
const ORDER = { found: 0, clear: 1, not_checked: 2 };
export function hexGroups(hexes) {
  const cats = [...new Set(hexes.map((h) => h.category))];
  return cats.map((c) => {
    const rows = hexes.filter((h) => h.category === c).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const t = tally(rows);
    return `<div style="margin:14px 0 4px 0;font-size:13px;font-weight:700;color:#111827">${esc(GROUPS[c] || c)} <span style="font-weight:400;color:#6b7280">&middot; ${t.found} found</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(hexRow).join('')}</table>`;
  }).join('');
}

export const tallyLine = (t, what) => `${t.found} found, ${t.clear} checked and clear, ${t.not_checked} not checked (${t.total} ${what})`;

// ---- plain text, in step with the HTML ------------------------------------------------------------------------------------------------
export function hexText(hexes) {
  const cats = [...new Set(hexes.map((h) => h.category))];
  return cats.flatMap((c) => {
    const rows = hexes.filter((h) => h.category === c).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    return ['', `${(GROUPS[c] || c).toUpperCase()}`, ...rows.flatMap((h) => {
      const head = `${h.status === 'not_checked' ? '⬡' : '⬢'} ${h.label} [${statusTag(h)}]`;
      if (h.status !== 'found') return [h.id === 'email-breaches' && h.status === 'not_checked' ? `${head}\n  We have not checked your email against known data breaches. Check it yourself, free: https://haveibeenpwned.com` : head];
      return [`${head}\n  ${shown(h)}${h.estimate ? ' (our estimate, not measured)' : ''}\n  Change: ${changeFor(h)} Guide: ${guideUrl(h)}`];
    })];
  });
}

// ---- JSON attachment (shape documented in docs/report-json-shape.md) -----------------------------------------------------------------
const outHex = (h) => ({ id: h.id, label: h.label, category: h.category, status: h.status, value: h.status === 'found' ? clean(h.value, 1000) : null, reported_value: h.status !== 'found' ? (h.reported ?? null) : null, estimate: h.estimate, detail: h.detail });
// MPC-7471-F4: the web scan's exposure score, band and coverage (score_version in the object), from the statuses the report already shows.
// A saved scan is final. `report.score` below is a different measure (the email-footprint privacy health score) and is left as it was.
export const EXPOSURE_METHOD_URL = 'https://myprivacytool.io/how-we-calculate-your-score';
export const webExposure = (web) => ({ ...computeExposure(web.map((h) => ({ id: h.id, status: h.status })), { final: true }), method_url: EXPOSURE_METHOD_URL });
export function buildReportJson({ scanId, webScan, web, emailHexes, score, generatedAt = new Date().toISOString() }) {
  return {
    schema_version: REPORT_JSON_VERSION,
    generated_at: generatedAt,
    report_id: scanId || null,
    web_scan: webScan ? { saved: true, id: webScan.id ?? null, created_at: webScan.created_at ?? null, summary: tally(web), exposure: webExposure(web), hexagons: web.map(outHex) } : { saved: false, id: null, created_at: null, summary: null, exposure: null, hexagons: [] },
    email: { summary: tally(emailHexes), hexagons: emailHexes.map(outHex) },
    score: score ?? null,
  };
}
export function reportAttachment(report) {
  const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { filename: `my-privacy-scan-${String(report.report_id || 'report').replace(/[^a-z0-9-]/gi, '').slice(0, 12) || 'report'}.json`, content: btoa(bin) };
}
