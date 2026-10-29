// MPC-8689: builds the master risk page (/hexagon/) and one risk page per hexagon (/hexagon/<slug>/) into dist/ at deploy time
// (npm "postbuild" hook), from shared/hexagon-registry/catalogue.js. Static HTML, no script needed to read a page, so every
// hexagon has a stable link that can be shared and a title/description for link previews.
// The "what it could be used for" text is general guidance written from each hexagon's own description plus common misuse themes (THEMES below).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { HEXAGON_CATALOGUE as ITEMS, CATALOGUE_CHANNELS as CHANNELS } from '../shared/hexagon-registry/catalogue.js';
import { EXTRA_HEXAGON_IDS } from '../shared/hexagon-registry/channels.js';
import { REVIEWED, REVIEWED_ON } from './hexagon-reviewed-copy.mjs';

const EXTRA = new Set(EXTRA_HEXAGON_IDS); // built and checked, but outside every score (MPC-8689 pilot)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = '/hexagon';
const SITE_URL = 'https://www.myprivacytool.io';
const chLabel = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));

const AR = { A: 'First contact', B: 'Public lookup', C: 'They choose to share', D: 'Wider lookup' };
const ARX = {
  A: "It arrives by itself with the person's first message, request or event. No extra step is needed to get it.",
  B: 'One public lookup using an ID, handle, number, domain or IP address we already received. The person does nothing.',
  C: 'It is only revealed if the person presses a share button, grants a permission, signs in, or opens a link or Mini App.',
  D: 'It goes beyond the channel: the data is sent to a third party or cross-referenced with other sources.',
};
const RN = { high: 'High', medium: 'Medium', low: 'Low' };
const RL = { high: 'H', medium: 'M', low: 'L' };
const RDEF = { high: 'This fact can identify, contact or locate a person.', medium: 'This fact narrows down who someone is or links them across different places.', low: 'This fact is context only. On its own it says little, but it adds to a bigger picture.' };
const ACC = {
  OK: 'Free to read and allowed by MPT rules today.', 'OK (off)': 'Defined, but currently switched off.', Verify: 'Documented, but the exact field must be confirmed on a test account first.',
  Paid: 'Needs a paid API.', 'Partner access': 'Needs platform approval (for example Meta App Review or a partner programme).', 'Their sign-in': 'Only available after the person signs in with that platform.',
  'Owner decision': 'Possible, held until the owner decides.', 'Not allowed': "Breaks MPT's own rules, so MPT will not do this.",
};
const THEMES = [
  [/location|city|region|country|address|gps|coordinat|geo|postcode|zip|nearby|place|timezone|time zone|\bip\b/, 'Show where a person is or roughly lives', ['Stalking and unwanted visits, especially when the place is precise or repeated.', 'Choosing the right moment for a break-in when someone is away from home.', 'Locally targeted scams, such as a fake "delivery to your area" message.']],
  [/name|username|handle|@|profile|display|nickname|bio|alias|vanity|url/, 'Put a name to an account and link accounts together', ['Finding the same person across other platforms by searching the same name or handle.', 'Doxxing: gathering scattered details into one profile to expose or harass someone.', 'Impersonation: creating a convincing fake account in their name.']],
  [/e-?mail/, 'Open the door to phishing and account takeover', ['Phishing that appears to come from a company the person really uses.', 'Password-reset attacks on any account registered with that address.', 'Looking the address up in breach databases to find old passwords.']],
  [/phone|number|sms|call|msisdn|sim\b|carrier|fax|voice/, 'Reach, track or hijack the person through their number', ['SIM-swap fraud, where an attacker takes over the number to intercept codes.', 'Voice or text scams that quote real details to sound legitimate.', 'Linking the number to other accounts, because many sites use it as a login.']],
  [/photo|avatar|picture|image|face|selfie|logo|thumbnail/, 'Match a face or picture to a real identity', ['Reverse image search to find the person on other sites.', 'Face matching to link an anonymous account to a real name.', 'Fake profiles that reuse the photo.']],
  [/device|browser|operating|screen|resolution|user.?agent|fingerprint|language|plugin|font|canvas|cpu|memory|battery|model|version|platform|hardware/, 'Fingerprint the person and track them across sites', ['Browser fingerprinting: a combination of device details can single out one person without cookies.', 'Choosing attacks that fit their software, such as known flaws in old versions.', 'Recognising the same person again later even if they change account or clear cookies.']],
  [/time|date|online|last seen|active|activity|presence|schedule|login|seen|created|joined|since/, 'Reveal when the person is active, away or new', ['Learning daily routines, such as when someone is asleep, at work or away.', 'Timing a scam for when the person is least likely to check.', 'Judging how long an account has existed to decide whether it is real or a good target.']],
  [/contact|friend|follower|following|connection|group|member|server|guild|community|subscriber|mutual|network|relationship|family/, 'Map who the person knows', ['Social engineering: contacting friends or family while pretending to be them.', 'Pressure on or through people close to the target.', "Building a picture of the person's workplace, interests and circle."]],
  [/message|typed|said|content|post|comment|caption|chat|description/, 'Expose what the person says or shares', ['Quoting real messages back to the person to make a scam believable.', 'Finding private details that people mention without thinking, such as employer, school or plans.', 'Blackmail or embarrassment using content the person thought was private.']],
  [/payment|card|bank|billing|purchase|wallet|subscription|price|financial/, 'Aim fraud at the person', ['Fake invoices or payment requests that match what the person really uses.', 'Choosing victims who are likely to have money or paid subscriptions.', 'Account takeover that leads to charges or stolen balances.']],
  [/job|employer|company|work|school|university|education|occupation|title|position|business/, 'Reveal where the person works or studies', ['Spear phishing that pretends to be their employer or school.', 'Targeting a company through one employee.', 'Pretexting: calling or writing with just enough detail to be believed.']],
  [/verified|verification|identity|kyc|government|passport|licen|birth|dob|gender|nationality|religion|politic|health/, 'Touch on highly personal or official details', ['Identity theft when combined with a name and a date of birth.', 'Discrimination or pressure based on sensitive traits.', "Opening accounts or claims in the person's name."]],
  [/token|secret|session|cookie|oauth|\bid\b|uid|numeric|guid|hash/, 'Tie activity to one account across systems', ['A stable ID follows the person even if they change their name or handle.', 'Joining data from different sources into one profile.', 'Targeted account attacks that need an ID to start.']],
];
const TIER_FALL = {
  high: ['Directly contacting, tracking or impersonating the person.', 'Combining this fact with one or two others to identify them completely.', 'Targeted scams that feel personal.'],
  medium: ['Narrowing down who the person is when combined with other facts.', "Linking this person's accounts and activity across places.", 'Making a scam or message more believable.'],
  low: ['Adding context to a profile that already contains more serious facts.', 'Helping sort people into groups for advertising or tracking.', 'On its own, little harm, but it can tip a close call when joined with other data.'],
};
const DO = {
  high: ['Treat this as a priority to review: hide, remove or restrict it wherever you can.', 'Check what this channel shows publicly and what apps or people can see.', 'Use a unique email, phone number or handle for important accounts so this fact cannot link them.'],
  medium: ['Review your settings on this channel and limit what is visible to people you do not know.', 'Avoid using the same name, photo or handle on every platform.', 'Be careful with unexpected messages that already know this detail about you.'],
  low: ['Fine to leave on its own, but check it is not combined with higher-risk facts.', 'Review it when you next tidy your privacy settings.', 'Be aware it contributes to your overall footprint.'],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// 29 defined Telegram hexagons carry a placeholder ("Already in the MPT registry; read from ...") instead of a description in the discovery data.
// Show a plain sentence built from the name and the Bot API field, and keep the placeholder out of the topic matching below.
const PLACEHOLDER = /^(Already in the MPT registry|Registry hexagon)/;
export const revealsText = (i) => (PLACEHOLDER.test(i.reveals) || !i.reveals ? `On ${chLabel[i.channel]}, MPT can read this from the account: ${i.label.toLowerCase()}${i.field ? ` (${i.field.replace(/_/g, '_')})` : ''}.` : i.reveals);

export function misuse(i) {
  const r = REVIEWED[i.slug];
  if (r) return { heads: [r.heads], uses: r.uses };
  const text = ` ${i.label} ${PLACEHOLDER.test(i.reveals) ? '' : i.reveals} ${i.field} `.toLowerCase();
  const hit = THEMES.filter((t) => t[0].test(text)).slice(0, 3);
  const heads = hit.map((t) => t[1]);
  const out = hit.map((t) => t[2][0]);
  if (hit[1]) out.push(hit[1][2][1]);
  for (const b of TIER_FALL[i.risk]) if (out.length < 4) out.push(b);
  return { heads, uses: out.slice(0, 5) };
}

const CSS = `<style>:root{--bg:#f7f6f3;--ink:#25231f;--mute:#6b675f;--line:#e3e0d8;--card:#fff;--teal:#1f6f6b;--high:#8c2f3d;--med:#e0a93b;--low:#c9dcdc;--lowink:#3d5a5a;--medink:#4a3406}
@media(prefers-color-scheme:dark){:root{--bg:#171614;--ink:#f1eee8;--mute:#a29e94;--line:#34312c;--card:#211f1c;--teal:#59b8b2;--high:#c8566a;--med:#e0a93b;--low:#47605f;--lowink:#e6f1f0;--medink:#2a1d02}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:24px 16px 80px}.wide{max-width:1100px}nav{font-size:14px;color:var(--mute)}a{color:var(--teal)}
.eyebrow{color:var(--teal);font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-top:20px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:6px 0 12px}h2{font-size:19px;margin:30px 0 6px}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 18px}.tag{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:2px 11px;background:var(--card)}
.risk{display:flex;gap:14px;align-items:center;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:16px;margin:12px 0}
.hexb{flex:none;width:64px;height:72px;display:grid;place-items:center;font:800 24px/1 inherit;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.hexb.high{background:var(--high);color:#fff}.hexb.medium{background:var(--med);color:var(--medink)}.hexb.low{background:var(--low);color:var(--lowink)}
.risk b{font-size:20px}.risk p{margin:2px 0;color:var(--mute)}ul{padding-left:20px}li{margin:4px 0}
.box{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:4px 16px 12px;margin:14px 0}
dl{display:grid;grid-template-columns:130px 1fr;gap:6px 14px;margin:8px 0}dt{color:var(--mute);font-size:14px}dd{margin:0}code{font-size:13px;color:var(--mute);word-break:break-all}
.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:4px 10px;text-decoration:none;font-size:14px}
.note{font-size:13px;color:var(--mute);border-top:1px solid var(--line);margin-top:36px;padding-top:12px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--line)}th{color:var(--mute);font-weight:600}
.tw{overflow-x:auto}input,select{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
.f{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.dot{width:12px;height:12px;display:inline-block;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}.dot.high{background:var(--high)}.dot.medium{background:var(--med)}.dot.low{background:var(--low)}
@media(max-width:560px){dl{grid-template-columns:1fr}}</style>`;

function page({ title, desc, body, wide = false, canonical, ld }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | MyPrivacyTOOL</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="article"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE_URL}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${SITE_URL}/og-image.jpg">
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}${CSS}</head><body><div class="wrap${wide ? ' wide' : ''}">${body}</div></body></html>`;
}

export function hexagonPage(i) {
  const { heads, uses } = misuse(i);
  const extra = EXTRA.has(i.id);
  const mapped = Array.isArray(i.code_ids) && i.code_ids.length > 0; // built under different ids (the CK-8502 X hexagons)
  const checked = i.status === 'defined' || extra;
  const rel = ITEMS.filter((x) => x !== i && x.channel === i.channel && x.risk === i.risk).slice(0, 8);
  const url = `${SITE_URL}${BASE}/${i.slug}/`;
  const desc = `${i.label} on ${chLabel[i.channel]} is a ${RN[i.risk].toLowerCase()}-risk fact. ${revealsText(i)}`.trim().slice(0, 240);
  const title = `${i.label}: what it reveals and how it can be misused`;
  return page({
    title, desc, canonical: url,
    ld: { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: desc, url, publisher: { '@type': 'Organization', name: 'MyPrivacyTOOL' } },
    body: `<nav><a href="${BASE}/">All hexagons</a> › ${esc(chLabel[i.channel])}</nav>
<div class="eyebrow">MyPrivacyTOOL · Hexagon risk page</div><h1>${esc(i.label)}</h1>
<div class="tags"><span class="tag">${esc(chLabel[i.channel])}</span><span class="tag">${i.arrival} · ${AR[i.arrival]}</span>${REVIEWED[i.slug] ? `<span class="tag">Text reviewed ${REVIEWED_ON}</span>` : ''}<span class="tag">${extra ? 'Checked by MPT (extra check)' : mapped ? 'Built (capture switch)' : checked ? 'Checked by MPT' : 'Not checked by MPT yet'}</span></div>
<div class="risk"><div class="hexb ${i.risk}" aria-hidden="true">${RL[i.risk]}</div><div><b>${RN[i.risk]} risk</b><p>${RDEF[i.risk]}</p></div></div>
<h2>What it reveals</h2><p>${esc(revealsText(i))}</p>
<h2>How easily it can be obtained</h2><p><b>${i.arrival} · ${AR[i.arrival]}.</b> ${ARX[i.arrival]}</p>
<h2>What it could be used for</h2>${heads.length ? `<p>${esc(heads.join(' · '))}.</p>` : ''}<ul>${uses.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
<h2>What you can do</h2><ul>${(REVIEWED[i.slug]?.todo ?? DO[i.risk]).map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
<div class="box"><dl><dt>Hexagon id</dt><dd><code>${esc(i.id)}</code></dd><dt>Field</dt><dd>${esc(i.field || 'Not recorded yet')}</dd><dt>Access</dt><dd>${esc(i.access)}. ${esc(ACC[i.access] || '')}</dd><dt>Status</dt><dd>${i.plan ? `${i.plan === 'later' ? 'Planned for later' : 'Not planned'}: ${esc(i.plan_reason)}. ` : ''}${mapped ? `Built in the code as ${esc(i.code_ids.join(', '))}. X capture records it only when its switch is on.${i.note ? ' ' + esc(i.note) : ''}` : extra ? 'Checked by MPT today as an extra check. It is shown to you but is not part of your risk number or any score yet.' : checked ? 'Checked by MPT today.' : 'Found in the platform documentation. Not checked by MPT yet, and not part of any score.'}</dd>${i.source ? `<dt>Source</dt><dd><a href="${esc(i.source)}" target="_blank" rel="noopener">${esc(i.source)}</a></dd>` : ''}</dl></div>
${rel.length ? `<h2>Other ${RN[i.risk].toLowerCase()}-risk hexagons on ${esc(chLabel[i.channel])}</h2><div class="rel">${rel.map((x) => `<a href="${BASE}/${x.slug}/">${esc(x.label)}</a>`).join('')}</div>` : ''}
<p style="margin-top:24px"><a href="/footprint/">See the full footprint map</a> · <a href="${BASE}/">All ${ITEMS.length} hexagons</a></p>
<p class="note">One hexagon is one fact a channel can reveal about a person. Risk tiers were approved by the owner on 28 Oct 2026. The explanation on this page is general guidance on how this kind of information is commonly misused. It is not a statement that any specific person has been targeted.</p>`,
  });
}

export function masterPage() {
  const order = { high: 0, medium: 1, low: 2 };
  const srt = [...ITEMS].sort((a, b) => order[a.risk] - order[b.risk] || a.arrival.localeCompare(b.arrival) || chLabel[a.channel].localeCompare(chLabel[b.channel]) || a.label.localeCompare(b.label));
  const rc = (r) => ITEMS.filter((i) => i.risk === r).length;
  const worst = ITEMS.filter((i) => i.risk === 'high' && i.arrival === 'A').length;
  const chs = [...CHANNELS].sort((a, b) => a.label.localeCompare(b.label));
  const rows = srt.map((i) => `<tr data-r="${i.risk}" data-c="${i.channel}" data-a="${i.arrival}" data-t="${esc(`${i.label} ${chLabel[i.channel]} ${revealsText(i)}`.toLowerCase())}"><td><i class="dot ${i.risk}"></i> ${RN[i.risk]}</td><td><a href="${BASE}/${i.slug}/">${esc(i.label)}</a></td><td>${esc(chLabel[i.channel])}</td><td>${i.arrival} · ${AR[i.arrival]}</td><td>${esc(revealsText(i))}</td></tr>`).join('');
  const title = `All ${ITEMS.length} hexagons ranked by risk`;
  const desc = `Every fact a channel can reveal about a person, across ${CHANNELS.length} channels, ranked from the highest to the lowest risk.`;
  return page({
    title, desc, wide: true, canonical: `${SITE_URL}${BASE}/`,
    body: `<nav><a href="/footprint/">Footprint map</a> › All hexagons</nav>
<div class="eyebrow">MyPrivacyTOOL · Master hexagon risk page</div><h1>${ITEMS.length} hexagons, ranked by risk</h1>
<p style="color:var(--mute)">Every fact a channel can reveal about a person, worst first. Each one has its own page explaining the risk and what it could be used for.</p>
<div class="tags"><span class="tag"><i class="dot high"></i> ${rc('high')} High</span><span class="tag"><i class="dot medium"></i> ${rc('medium')} Medium</span><span class="tag"><i class="dot low"></i> ${rc('low')} Low</span><span class="tag">${worst} high-risk facts arrive on first contact (A)</span></div>
<div class="f"><input id="q" type="search" placeholder="Search hexagons" aria-label="Search"><select id="r" aria-label="Risk"><option value="">All risks</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select id="a" aria-label="Arrival"><option value="">All arrival classes</option>${Object.entries(AR).map(([k, v]) => `<option value="${k}">${k} · ${v}</option>`).join('')}</select><select id="c" aria-label="Channel"><option value="">All channels</option>${chs.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}</select></div>
<p id="n" style="color:var(--mute)"></p><div class="tw"><table><thead><tr><th>Risk</th><th>Hexagon</th><th>Channel</th><th>Arrival</th><th>What it reveals</th></tr></thead><tbody id="b">${rows}</tbody></table></div>
<script>const rs=[...document.querySelectorAll("#b tr")];function f(){const q=document.getElementById("q").value.toLowerCase(),r=document.getElementById("r").value,a=document.getElementById("a").value,c=document.getElementById("c").value;let n=0;for(const t of rs){const ok=(!q||t.dataset.t.includes(q))&&(!r||t.dataset.r===r)&&(!a||t.dataset.a===a)&&(!c||t.dataset.c===c);t.hidden=!ok;if(ok)n++}document.getElementById("n").textContent=n+" of ${ITEMS.length} hexagons"}["q","r","a","c"].forEach(x=>document.getElementById(x).addEventListener("input",f));f()</script>`,
  });
}

export function writeHexagonPages(outDir) {
  const dir = path.join(outDir, 'hexagon');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), masterPage());
  for (const i of ITEMS) {
    mkdirSync(path.join(dir, i.slug), { recursive: true });
    writeFileSync(path.join(dir, i.slug, 'index.html'), hexagonPage(i));
  }
  return ITEMS.length + 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = writeHexagonPages(path.resolve(ROOT, process.argv[2] || 'dist'));
  console.log(`hexagon pages written: ${n} (1 master + ${n - 1} hexagons)`);
}
