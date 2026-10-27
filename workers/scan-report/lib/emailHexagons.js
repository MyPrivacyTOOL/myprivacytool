// MPC-7467: the email hexagons. Checks that run on the address the user gave when a report is prepared.
// Each returns { id, label, status: 'found' | 'clear' | 'not_checked', value?, reason?, source, services }.
//   found       the check ran and has something to say about this address (value says what).
//   clear       the check ran and positively found nothing.
//   not_checked the check failed, timed out or could not run. Never a guess, never blocks the report.
// `services` lists every outside service that received the address, or a hash of it (for the privacy policy, MPC-7470).
// Free and public only: no paid service, and no other company's sign-up or login page is ever contacted.

const DOH = 'https://cloudflare-dns.com/dns-query';
const GRAVATAR_AVATAR = 'https://gravatar.com/avatar';
const GRAVATAR_PROFILE = 'https://api.gravatar.com/v3/profiles';
export const CHECK_TIMEOUT_MS = 3000;

export const EMAIL_HEXAGONS = {
  'email-name': { label: 'Name in your address', source: 'Analysed inside our Worker (nothing sent out)', services: [] },
  'email-provider': { label: 'Mail provider and domain', source: 'Cloudflare public DNS (1.1.1.1 over HTTPS)', services: ['Cloudflare DNS-over-HTTPS (receives the domain only, the part after the @)'] },
  'email-profile': { label: 'Public profile picture', source: 'Gravatar', services: ['Gravatar (receives a SHA-256 hash of the lower-cased address, not the address)'] },
  // MPC-8452 (OSINT list, batch 1): both send a hash or the domain only, never the address.
  'email-libravatar': { label: 'Second public profile-picture service', source: 'Libravatar', services: ['Libravatar (receives a SHA-256 hash of the lower-cased address, not the address)'] },
  'email-domain-record': { label: 'Website ownership record', source: 'RDAP (public domain registration data)', services: ['rdap.org and the domain registry it redirects to (receive the domain only, the part after the @)'] },
  // MPC-8452 Tier 2 (owner approved 2026-10-26): the ONE check that sends the plain address to a third party. OFF unless EMAIL_GITHUB_COMMITS_ENABLED is "true",
  // and that must only be set after the Privacy page names GitHub (docs/osint-list-mpc-8452.md).
  'email-github-commits': { label: 'Public code changes', source: 'GitHub commit search', services: ['GitHub (receives the plain email address, in a search for public commits that name it as author)'] },
};

// The checks that run for this deployment. The live view is "done" when this many have finished, so a switched-off check must not be counted.
export const GITHUB_COMMITS_ID = 'email-github-commits';
export const githubCommitsEnabled = (env = {}) => env.EMAIL_GITHUB_COMMITS_ENABLED === 'true';
export const enabledEmailHexagonIds = (env = {}) => Object.keys(EMAIL_HEXAGONS).filter((id) => id !== GITHUB_COMMITS_ID || githubCommitsEnabled(env));

const result = (id, status, extra = {}) => ({ id, label: EMAIL_HEXAGONS[id].label, status, source: EMAIL_HEXAGONS[id].source, services: EMAIL_HEXAGONS[id].services, ...extra });
const notChecked = (id, reason) => result(id, 'not_checked', { reason: String(reason).slice(0, 200) });

export function splitEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1 || /\s/.test(s)) return null;
  return { local: s.slice(0, at), domain: s.slice(at + 1) };
}

// ------------------------------------------------------------------ 2. name in address (pure logic)
const FIRST_NAMES = new Set(('james john robert michael william david richard joseph thomas charles chris christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel frank gregory raymond alexander patrick jack dennis jerry tyler aaron henry adam douglas nathan peter zachary kyle walter harold carl arthur gerald roger keith jeremy lawrence sean ethan harry oliver noah liam lucas mason logan' +
  ' mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet maria olivia heather diane julie joyce victoria kelly christina lauren joan evelyn judith megan cheryl andrea hannah jacqueline martha gloria teresa sara janice marie julia grace sophia alice charlotte amelia isabella chloe lucy ruby ella' +
  ' wei li wang zhang chen liu yang huang chan wong lee lam cheung ahmed mohammed muhammad ali omar priya raj amit rahul anil sanjay sunita pooja ravi kumar carlos jose juan luis miguel pedro pablo diego sofia lucia elena marco luca giulia anna hans peter jan pierre jean marie claire sophie yuki hiroshi kenji takeshi sakura').split(' '));
const ROLE_WORDS = new Set(['info', 'admin', 'support', 'sales', 'contact', 'hello', 'hi', 'office', 'team', 'help', 'billing', 'accounts', 'marketing', 'noreply', 'no-reply', 'postmaster', 'webmaster', 'enquiries', 'enquiry', 'service', 'mail', 'email', 'jobs', 'careers', 'press', 'media', 'privacy', 'security', 'abuse', 'test', 'testing', 'user', 'me', 'hk']);

// Conservative: reports only patterns that are strongly suggestive, and always as "may" / "looks like", never as fact.
export function checkNameInAddress(email) {
  const id = 'email-name';
  const parts = splitEmail(email);
  if (!parts) return notChecked(id, 'not a valid email address');
  const base = parts.local.split('+')[0];                         // drop the +tag
  const tokens = base.split(/[._-]+/).filter(Boolean);
  const hints = [];
  const alphaTokens = tokens.map((t) => t.replace(/\d+/g, '')).filter(Boolean);
  const roleOnly = tokens.length > 0 && tokens.every((t) => ROLE_WORDS.has(t.replace(/\d+/g, '')));
  if (roleOnly) return result(id, 'clear');                        // a shared/role mailbox, not a person
  // first name: a whole token (or token + digits) on the common first-name list, 3+ letters
  const first = alphaTokens.find((t) => t.length >= 3 && FIRST_NAMES.has(t));
  if (first) hints.push('what looks like a first name');
  // last name: only when a known first name sits next to another word of 3+ letters ("anna.smith")
  if (first && alphaTokens.length >= 2 && alphaTokens.some((t) => t !== first && /^[a-z]{3,}$/.test(t) && !ROLE_WORDS.has(t))) hints.push('possibly a surname');
  // initials: a single-letter token beside a longer word ("j.smith", "john.s")
  const singles = tokens.filter((t) => /^[a-z]$/.test(t));
  if (singles.length && alphaTokens.some((t) => t.length >= 3)) hints.push('what may be an initial');
  // birth year: a 4-digit 19xx/20xx run that is not part of a longer digit string (plausible ages 13-100)
  const thisYear = new Date().getUTCFullYear();
  const years = [...base.matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1])).filter((y) => y >= thisYear - 100 && y <= thisYear - 13);
  if (years.length) hints.push('a number that could be a birth year');
  if (!hints.length) return result(id, 'clear');
  return result(id, 'found', { value: `Your address may contain ${hints.join(', ')}. This is a pattern match, not a confirmed fact.` });
}

// ------------------------------------------------------------------ 3. provider and domain (public DNS only)
export const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.hk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'zoho.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com', '126.com', 'mail.com', 'yandex.com', 'netvigator.com']);
const MX_PROVIDERS = [
  [/(^|\.)(google\.com|googlemail\.com)\.?$/, 'Google (Gmail or Google Workspace)'],
  [/(outlook\.com|protection\.outlook\.com|hotmail\.com)\.?$/, 'Microsoft (Outlook or Microsoft 365)'],
  [/(yahoodns\.net|yahoo\.com)\.?$/, 'Yahoo Mail'],
  [/(icloud\.com|me\.com)\.?$/, 'Apple iCloud Mail'],
  [/(protonmail\.ch|proton\.me)\.?$/, 'Proton Mail'],
  [/(zoho\.(com|eu|in)|zohomail\.com)\.?$/, 'Zoho Mail'],
  [/(messagingengine\.com)\.?$/, 'Fastmail'],
  [/(mimecast\.com)\.?$/, 'Mimecast (business mail filtering)'],
  [/(pphosted\.com)\.?$/, 'Proofpoint (business mail filtering)'],
  [/(mailgun\.org|sendgrid\.net)\.?$/, 'a bulk-mail service'],
];

function dohQuery(name, type, fetchImpl, signal) {
  return fetchImpl(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`DNS HTTP ${res.status}`);
      const j = await res.json();
      if (j.Status !== 0 && j.Status !== 3) throw new Error(`DNS status ${j.Status}`);      // 0 ok, 3 NXDOMAIN; anything else is a failure
      return { nx: j.Status === 3, answers: (j.Answer || []).filter((a) => a.type === ({ MX: 15, TXT: 16 })[type]).map((a) => String(a.data || '')) };
    });
}

export async function checkProviderAndDomain(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email-provider';
  const parts = splitEmail(email);
  if (!parts || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(parts.domain)) return notChecked(id, 'not a valid email address');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const d = parts.domain;
    const [mx, txt, dmarc] = await Promise.all([dohQuery(d, 'MX', fetchImpl, ctl.signal), dohQuery(d, 'TXT', fetchImpl, ctl.signal), dohQuery(`_dmarc.${d}`, 'TXT', fetchImpl, ctl.signal)]);
    if (mx.nx) return result(id, 'found', { value: `The domain ${d} does not exist in public DNS, so mail to this address may not work.` });
    const hosts = mx.answers.map((a) => a.split(/\s+/).pop().toLowerCase());
    const provider = MX_PROVIDERS.find(([re]) => hosts.some((h) => re.test(h)))?.[1];
    const personal = PERSONAL_DOMAINS.has(d);
    const spf = txt.answers.some((t) => /^"?v=spf1\b/i.test(t.replace(/^"|"$/g, '')));
    const dm = dmarc.answers.map((t) => t.replace(/"/g, '')).find((t) => /^v=DMARC1/i.test(t));
    const policy = dm && (dm.match(/;\s*p=(\w+)/i) || [])[1]?.toLowerCase();
    const lines = [];
    if (!hosts.length) lines.push(`${d} publishes no mail servers.`);
    else lines.push(`Your mail is handled by ${provider || 'a provider we do not recognise'}.`);
    lines.push(personal
      ? 'This is a personal webmail domain shared by many people, so it says little about where you work.'
      : `${d} looks like a work or own domain: it can show which organisation you belong to, and whoever runs it can usually read or manage the mailbox.`);
    lines.push(!personal ? `Anti-spoofing records: SPF ${spf ? 'published' : 'not found'}; DMARC ${dm ? `published (policy: ${policy || 'unspecified'})` : 'not found'}.` : 'Anti-spoofing records for this domain are managed by the provider.');
    return result(id, 'found', { value: lines.join(' ') });
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'DNS lookup timed out' : `DNS lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ 4. public profile or avatar (Gravatar)
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkPublicProfile(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email-profile';
  const parts = splitEmail(email);
  if (!parts) return notChecked(id, 'not a valid email address');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const hash = await sha256Hex(`${parts.local}@${parts.domain}`);        // Gravatar's documented key: SHA-256 of the trimmed, lower-cased address
    const get = (url) => fetchImpl(url, { headers: { 'user-agent': 'MyPrivacyTOOL-scan-report' }, signal: ctl.signal });
    const [avatar, profile] = await Promise.all([get(`${GRAVATAR_AVATAR}/${hash}?d=404&s=1`), get(`${GRAVATAR_PROFILE}/${hash}`)]);
    if (avatar.status === 200 || profile.status === 200) {
      return result(id, 'found', { value: `A public ${profile.status === 200 ? 'Gravatar profile' : 'profile picture'} is linked to this address. Anyone who knows the address can see it.` });
    }
    if (avatar.status === 404 && profile.status === 404) return result(id, 'clear');
    return notChecked(id, `Gravatar HTTP ${avatar.status}/${profile.status}`);      // rate limited or erroring: not "clear"
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'Gravatar lookup timed out' : `Gravatar lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ 5. second avatar service (Libravatar, hash only) - MPC-8452
const LIBRAVATAR_AVATAR = 'https://seccdn.libravatar.org/avatar';
export async function checkLibravatar(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email-libravatar';
  const parts = splitEmail(email);
  if (!parts) return notChecked(id, 'not a valid email address');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const hash = await sha256Hex(`${parts.local}@${parts.domain}`);
    const res = await fetchImpl(`${LIBRAVATAR_AVATAR}/${hash}?d=404&s=1`, { headers: { 'user-agent': 'MyPrivacyTOOL-scan-report' }, signal: ctl.signal });
    if (res.status === 200) return result(id, 'found', { value: 'A public Libravatar profile picture is linked to this address. Anyone who knows the address can see it.' });
    if (res.status === 404) return result(id, 'clear');
    return notChecked(id, `Libravatar HTTP ${res.status}`);      // rate limited or erroring: not "clear"
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'Libravatar lookup timed out' : `Libravatar lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ 6. public domain registration record (RDAP, domain only) - MPC-8452
// Only for a domain that is not a shared webmail domain: the question is what the public registration record of YOUR domain tells strangers.
const RDAP = 'https://rdap.org/domain';
// What registrars print where the owner's details are hidden (GDPR redaction, privacy services). Anything else counts as visible.
const REDACTED = /redacted|privacy|withheld|not disclosed|data protected|please query|rdds|registrar of record|contact the registrant|not applicable|^n\/a$|^none$|^-$/i;
const vcardText = (entity) => {
  const rows = Array.isArray(entity?.vcardArray) ? entity.vcardArray[1] || [] : [];
  return rows.filter((r) => ['fn', 'org', 'email', 'adr', 'tel'].includes(r[0])).map((r) => (Array.isArray(r[3]) ? r[3].join(' ') : String(r[3] || '')).trim()).filter(Boolean);
};
export async function checkDomainRecord(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const id = 'email-domain-record';
  const parts = splitEmail(email);
  if (!parts || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(parts.domain)) return notChecked(id, 'not a valid email address');
  if (PERSONAL_DOMAINS.has(parts.domain)) return result(id, 'clear');      // a shared webmail domain: there is no registration of yours to expose
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${RDAP}/${encodeURIComponent(parts.domain)}`, { headers: { accept: 'application/rdap+json', 'user-agent': 'MyPrivacyTOOL-scan-report' }, redirect: 'follow', signal: ctl.signal });
    if (res.status === 404) return notChecked(id, 'no public registration record was available for this domain');   // unsupported registry or unknown domain: not "clear"
    if (!res.ok) return notChecked(id, `RDAP HTTP ${res.status}`);
    const j = await res.json();
    const reg = (j.events || []).find((e) => e.eventAction === 'registration')?.eventDate;
    const year = reg && /^\d{4}/.test(reg) ? Number(reg.slice(0, 4)) : null;
    const registrar = vcardText((j.entities || []).find((e) => (e.roles || []).includes('registrar')))[0] || '';
    const exposed = (j.entities || []).filter((e) => (e.roles || []).includes('registrant')).flatMap(vcardText).filter((t) => !REDACTED.test(t));
    if (exposed.length) {
      return result(id, 'found', { value: `The public registration record for ${parts.domain}${year ? ` (registered in ${year})` : ''}${registrar ? `, through ${registrar},` : ''} shows contact details for the owner. Anyone can look this up.` });
    }
    return result(id, 'clear');      // answered, and the owner's details are hidden or redacted
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'registration lookup timed out' : `registration lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ 7. public code commits (GitHub commit search, PLAIN address) - MPC-8452 Tier 2
// GitHub only indexes commits on a repository's default branch, so "no results" is never proof that the address appears nowhere: the wording says so.
// The search is rate limited (about 10 a minute without a token): any non-200 answer, and any answer GitHub marks incomplete, is NOT CHECKED, never clear.
const GITHUB_COMMIT_SEARCH = 'https://api.github.com/search/commits';
export async function checkGithubCommits(email, fetchImpl = fetch, { timeoutMs = CHECK_TIMEOUT_MS, token = '' } = {}) {
  const id = GITHUB_COMMITS_ID;
  const parts = splitEmail(email);
  if (!parts || !/^[^\s@"<>]+$/.test(parts.local)) return notChecked(id, 'not a valid email address');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'MyPrivacyTOOL-scan-report', ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const q = encodeURIComponent(`author-email:${parts.local}@${parts.domain}`);
    const res = await fetchImpl(`${GITHUB_COMMIT_SEARCH}?q=${q}&per_page=1`, { headers, signal: ctl.signal });
    if (res.status !== 200) return notChecked(id, `GitHub HTTP ${res.status}`);      // 403/429 rate limited, 422 unsearchable, 5xx: not "clear"
    const j = await res.json();
    if (!j || typeof j.total_count !== 'number') return notChecked(id, 'GitHub answered in an unexpected shape');
    if (j.total_count > 0) {
      const repo = String(j.items?.[0]?.repository?.full_name || '').replace(/[^\w./-]/g, '').slice(0, 100);
      return result(id, 'found', { value: `This address is the author of at least ${j.total_count} public code ${j.total_count === 1 ? 'change' : 'changes'} on GitHub${repo ? `, for example in ${repo}` : ''}. Anyone can search for these.` });
    }
    if (j.incomplete_results === true) return notChecked(id, 'GitHub search timed out on its side');
    return result(id, 'clear');
  } catch (e) {
    return notChecked(id, ctl.signal.aborted ? 'GitHub lookup timed out' : `GitHub lookup failed: ${String(e).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ run all (never throws, never exceeds the budget)
export async function runEmailHexagons(email, env = {}, fetchImpl = fetch) {
  const budget = Number(env.EMAIL_HEXAGON_TIMEOUT_MS) || CHECK_TIMEOUT_MS;
  const guard = (id, p) => Promise.race([
    Promise.resolve(p).catch((e) => notChecked(id, `check failed: ${String(e).slice(0, 100)}`)),
    new Promise((r) => setTimeout(() => r(notChecked(id, 'timed out')), budget + 500)),
  ]);
  return Promise.all([
    guard('email-name', checkNameInAddress(email)),
    guard('email-provider', checkProviderAndDomain(email, fetchImpl, { timeoutMs: budget })),
    guard('email-profile', checkPublicProfile(email, fetchImpl, { timeoutMs: budget })),
    guard('email-libravatar', checkLibravatar(email, fetchImpl, { timeoutMs: budget })),
    guard('email-domain-record', checkDomainRecord(email, fetchImpl, { timeoutMs: budget })),
    ...(githubCommitsEnabled(env) ? [guard(GITHUB_COMMITS_ID, checkGithubCommits(email, fetchImpl, { timeoutMs: budget, token: String(env.GITHUB_SEARCH_TOKEN || '') }))] : []),
  ]);
}

// Rows for the existing `signals` table (category 'email'). They do not feed the privacy score.
export function emailHexagonSignalRows(scanId, hexagons) {
  return hexagons.map((h) => ({
    scan_id: scanId, category: 'email', signal_type: h.id, severity: 'low', data_source: h.source.slice(0, 100),
    check_status: h.status === 'found' ? 'found' : h.status === 'clear' ? 'clear' : 'not_checked',
    details: (h.value || h.reason || '').slice(0, 500) || null, removal_status: 'manual_only',
  }));
}
