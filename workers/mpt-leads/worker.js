import { enrichAndScore, HIGH_PRIORITY_THRESHOLD } from './lead-scoring.js';

// MPC-7350 input hardening helpers.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 16 * 1024;
const clip = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
// Slack mrkdwn control characters (&, <, >) must be escaped so user text cannot inject links or mentions.
const slackEsc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlEsc = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Per-IP limit via the Workers Rate Limiting binding (wrangler.toml [[ratelimits]]). Fails open if the
// binding is absent or errors so a platform hiccup never drops a real lead.
async function rateLimited(env, request) {
  if (!env.RATE_LIMITER) return false;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    return !success;
  } catch (_) { return false; }
}

function whoami(request, cors) {
  const cf = request.cf || {};
  let country = cf.country || '';
  try { if (country) country = new Intl.DisplayNames(['en'], { type: 'region' }).of(country) || country; } catch (_) { /* keep ISO code */ }
  const body = {
    ip: request.headers.get('CF-Connecting-IP') || '',
    city: cf.city || '',
    region: cf.region || '',
    country_name: country,
    latitude: Number(cf.latitude) || 0,
    longitude: Number(cf.longitude) || 0,
    org: cf.asOrganization || '',
  };
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepPending(env).catch((e) => console.error('Sweep error:', String(e))));
  },

  async fetch(request, env, ctx) {
    const allow = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = allow.includes(origin) ? origin : allow[0];

    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reject = (status, error) => new Response(JSON.stringify({ error }), {
      status, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    // MPC-7350: the visitor's own IP and approximate location, read from Cloudflare's request data, so the browser
    // no longer has to ask third-party lookup services (ipify, ipapi.co). This route stores nothing.
    if (request.method === 'GET' && new URL(request.url).pathname === '/whoami') {
      if (origin && !allow.includes(origin)) return reject(403, 'Forbidden origin');
      if (await rateLimited(env, request)) return reject(429, 'Too many requests');
      return whoami(request, cors);
    }
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }
    // MPC-7350: a browser request from any other site is refused (no cross-site form posts / spam).
    // Requests with no Origin header (server-to-server, curl) are still handled and rate limited below.
    if (origin && !allow.includes(origin)) return reject(403, 'Forbidden origin');
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return reject(413, 'Payload too large');
    if (await rateLimited(env, request)) return reject(429, 'Too many requests');

    try {
      let name = '', email = '', phone = '';
      let utm_source = '', utm_medium = '', utm_campaign = '', utm_content = '', referrer = '';
      let categoryScores = null; // MPC-7173: per-category risk scores for the baseline snapshot
      let riskScore = null; // MPC-6956: only the post-scan email modal sends this
      let consentRaw = null, consentSourceRaw = '', sourceRaw = ''; // MPC-6971: explicit consent only
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const b = await request.json();
        riskScore = b.riskScore ?? null;
        categoryScores = b.categoryScores ?? null;
        name = b.name || ''; email = b.email || ''; phone = b.phone || '';
        utm_source = b.utm_source || ''; utm_medium = b.utm_medium || '';
        utm_campaign = b.utm_campaign || ''; utm_content = b.utm_content || '';
        referrer = b.referrer || '';
        consentRaw = b.consent ?? null; consentSourceRaw = b.consent_source || ''; sourceRaw = b.source || '';
      } else {
        const fd = await request.formData();
        riskScore = fd.get('riskScore') || null;
        name = fd.get('name') || ''; email = fd.get('email') || ''; phone = fd.get('phone') || '';
        utm_source = fd.get('utm_source') || ''; utm_medium = fd.get('utm_medium') || '';
        utm_campaign = fd.get('utm_campaign') || ''; utm_content = fd.get('utm_content') || '';
        referrer = fd.get('referrer') || '';
        consentRaw = fd.get('consent'); consentSourceRaw = fd.get('consent_source') || ''; sourceRaw = fd.get('source') || '';
      }
      // MPC-7350: strings only, bounded lengths (Notion/HubSpot/Slack get nothing unbounded).
      email = String(email).trim(); name = clip(name, 100).trim(); phone = clip(phone, 32).trim();
      utm_source = clip(utm_source, 100); utm_medium = clip(utm_medium, 100);
      utm_campaign = clip(utm_campaign, 100); utm_content = clip(utm_content, 100);
      referrer = /^https?:\/\//i.test(String(referrer)) ? clip(referrer, 500) : '';
      // MPC-6971: record consent only when the client explicitly says the user gave it. Never default to true.
      const consented = consentRaw === true || consentRaw === 'true' || consentRaw === 'on';
      const consentSource = String(consentSourceRaw || sourceRaw || 'landing_page').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'landing_page';

      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return new Response(JSON.stringify({ error: 'Email required' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      // Silently pass watchdog health checks — do not save or alert
      if (email.endsWith('@healthcheck.io') || email === 'watchdog@healthcheck.io') {
        return new Response(JSON.stringify({ success: true, note: 'healthcheck' }), {
          status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      // Capture technical metadata from the request
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const country = request.cf?.country || '';
      const city = request.cf?.city || '';
      const ua = request.headers.get('user-agent') || '';
      const { browser, os, device } = parseUserAgent(ua);

      const firstName = name ? name.split(' ')[0] : 'there';   // raw: HubSpot/Slack paths; email body uses htmlEsc below

      // MPC-7120: record the engagement funnel step in Supabase (RLS-protected mpt_user_engagement)
      // BEFORE the Notion write and independent of it: a Notion failure must never block the engagement row.
      // Fail-soft and off the response path; stores no PII (random session id + funnel booleans).
      const engagement = recordEngagement(env, crypto.randomUUID(), { full_scan_completed: riskScore !== null });
      ctx.waitUntil(engagement);

      // MPC-7173: save the first completed scan as the user's baseline and report it back so the
      // site can show 'Your baseline: X (date)' / the delta on re-scans. Fail-soft, independent of Notion.
      const baseline = await saveBaseline(env, email, riskScore, categoryScores);

      // 1. Save to Notion
      const properties = {
        Name:   { title: [{ text: { content: name || email } }] },
        Email:  { email: email },
        Status: { select: { name: 'New' } },
        Source: { select: { name: 'Landing Page' } },
      };
      if (phone)        properties['Phone']        = { phone_number: phone };
      if (ip)           properties['IP Address']   = { rich_text: [{ text: { content: ip } }] };
      if (country)      properties['Country']      = { rich_text: [{ text: { content: country } }] };
      if (city)         properties['City']         = { rich_text: [{ text: { content: city } }] };
      if (browser)      properties['Browser']      = { rich_text: [{ text: { content: browser } }] };
      if (os)           properties['OS']           = { rich_text: [{ text: { content: os } }] };
      if (device)       properties['Device']       = { select: { name: device } };
      if (utm_source)   properties['UTM Source']   = { rich_text: [{ text: { content: utm_source } }] };
      if (utm_medium)   properties['UTM Medium']   = { rich_text: [{ text: { content: utm_medium } }] };
      if (utm_campaign) properties['UTM Campaign'] = { rich_text: [{ text: { content: utm_campaign } }] };
      if (utm_content)  properties['UTM Content']  = { rich_text: [{ text: { content: utm_content } }] };
      if (referrer)     properties['Referrer']     = { url: referrer };

      const nr = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: env.LEADS_DB_ID }, properties })
      });

      if (!nr.ok) {
        const e = await nr.text();
        console.error('Notion error:', nr.status, e.slice(0, 200));
        return new Response(JSON.stringify({ error: 'Save failed' }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      // 2. Count total real leads (exclude healthcheck entries)
      let totalLeads = '?';
      try {
        const countResp = await fetch(`https://api.notion.com/v1/databases/${env.LEADS_DB_ID}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            page_size: 100,
            filter: {
              and: [
                { property: 'Email', email: { does_not_contain: 'healthcheck.io' } },
                { property: 'Email', email: { does_not_contain: '@test.com' } },
              ]
            }
          })
        });
        if (countResp.ok) {
          let count = 0;
          let cursor = null;
          do {
            const body = { page_size: 100, filter: { and: [{ property: 'Email', email: { does_not_contain: 'healthcheck.io' } }, { property: 'Email', email: { does_not_contain: '@test.com' } }] } };
            if (cursor) body.start_cursor = cursor;
            const pageResp = await fetch(`https://api.notion.com/v1/databases/${env.LEADS_DB_ID}/query`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!pageResp.ok) break;
            const pageData = await pageResp.json();
            count += pageData.results ? pageData.results.length : 0;
            cursor = pageData.has_more ? pageData.next_cursor : null;
          } while (cursor);
          totalLeads = count;
        }
      } catch (_) {}

      const source = inferSource(utm_source, utm_medium, utm_campaign, referrer);
      const now = new Date();
      const hktTime = toHKT(now);
      const otherInfo = buildOtherInfo(phone, ip, country, city, browser, os, device, utm_content, referrer);

      const side = [];

      // 3. Slack notification
      const slackToken = env.SLACK_BOT_TOKEN;
      const channelId  = env.SLACK_CHANNEL_ID || 'C0AR4TB6Y77';

      if (slackToken) {
        const notionDbUrl = `https://www.notion.so/${env.LEADS_DB_ID.replace(/-/g, '')}`;
        const msgText = [
          `*MyPrivacyTOOL*`,
          ``,
          `:tada: New CRM lead`,
          `${hktTime.fullDate} > ${hktTime.time} HKT`,
          `Total Leads: ${totalLeads}`,
          ``,
          `Name: ${slackEsc(name) || '(not given)'}`,
          `Email: ${slackEsc(email)}`,
          phone ? `Phone: ${slackEsc(phone)}` : null,
          ``,
          `IP: ${ip || '—'} | ${city || '—'}, ${country || '—'}`,
          `Browser: ${browser || '—'} | OS: ${os || '—'} | Device: ${device || '—'}`,
          ``,
          `Other Info: ${slackEsc(otherInfo)}`,
          `Where they came from ${slackEsc(source)}`,
          `Campaign ${slackEsc(utm_campaign) || '—'}`,
          ``,
          `<${notionDbUrl}|Open Notion Leads DB>`,
        ].filter(l => l !== null).join('\n');

        side.push(
          fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: channelId, text: msgText, unfurl_links: false, unfurl_media: false })
          }).catch(() => {})
        );
      }

      // 4. HubSpot CRM sync (MPC-7500: enriched with Hunter + a readiness score before the write)
      if (env.HUBSPOT_TOKEN) {
        const nameParts = (name || '').trim().split(/\s+/);
        const hsProps = {
          email,
          firstname: nameParts[0] || '',
          lastname:  nameParts.slice(1).join(' ') || '',
          hs_lead_status: 'NEW',
        };
        if (phone) hsProps.phone = phone;
        if (consented) {
          hsProps.consent_given_at = new Date().toISOString().slice(0, 10); // HubSpot date property: YYYY-MM-DD (UTC)
          hsProps.consent_source = consentSource;
        }

        side.push((async () => {
          // Fail-soft: an enrichment problem never blocks the contact write; the 5-minute cron sweep retries 'pending'.
          let scored = null;
          try {
            scored = await enrichAndScore(env, email, country);
            Object.assign(hsProps, scored.props);
          } catch (err) { console.error('Lead scoring error:', String(err)); }
          const hsHeaders = { 'Authorization': `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
          let r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST', headers: hsHeaders, body: JSON.stringify({ properties: hsProps })
          });
          // Safety net: if the mpt_lead_* custom properties are not created in HubSpot yet, HubSpot rejects the whole
          // write with 400 PROPERTY_DOESNT_EXIST. Retry without them so contact sync never regresses.
          if (r.status === 400 && scored && /mpt_lead_/.test(await r.clone().text())) {
            console.error('HubSpot missing mpt_lead_* properties; writing contact without score');
            for (const k of Object.keys(hsProps)) if (k.startsWith('mpt_lead_')) delete hsProps[k];
            r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
              method: 'POST', headers: hsHeaders, body: JSON.stringify({ properties: hsProps })
            });
          }
          if (r.status === 409) {
            const existing = await r.json();
            const vid = existing?.message?.match(/ID: (\d+)/)?.[1];
            if (vid) {
              await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${vid}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ properties: hsProps })
              });
            }
          }
          if (scored) await alertHighPriority(env, { email, name, ...scored.result, props: scored.props });
        })().catch(() => {}));
      }

      // 5. Confirmation email via Resend
      // MPC-6677: when the scan-report Worker owns confirmations, skip this one (no duplicate senders).
      if (env.RESEND_API_KEY && env.CONFIRMATION_OWNER !== 'scan-report') {
        const emailHtml = buildConfirmationEmail(htmlEsc(firstName), source);
        side.push(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'MyPrivacyTOOL <hello@myprivacytool.io>',
              to: [email],
              subject: `${firstName.replace(/[\r\n]/g, ' ')}, your privacy scan is being prepared`,
              html: emailHtml,
            })
          }).catch(() => {})
        );
      }

      ctx.waitUntil(Promise.all(side));

      return new Response(JSON.stringify({ success: true, ...(baseline ? { baseline } : {}) }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      console.error('mpt-leads error:', String(e));
      const bad = e instanceof SyntaxError || e instanceof TypeError;   // unparsable JSON / form body
      return new Response(JSON.stringify({ error: bad ? 'Invalid request' : 'Internal error' }), {
        status: bad ? 400 : 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};

// MPC-7500: High Priority (score > 80) alert. Slack always (existing bot); email via Resend only when
// ALERT_EMAIL is set. The HubSpot workflow (docs/lead-scoring-mpc-7500.md) is the system of record for alerts;
// this is the in-Worker path that fires within seconds. Never throws.
async function alertHighPriority(env, lead) {
  if (!(lead.score > HIGH_PRIORITY_THRESHOLD)) return;
  const text = [
    `:fire: *High Priority lead* (score ${lead.score}/100)`,
    `Name: ${slackEsc(lead.name) || '(not given)'}`,
    `Email: ${slackEsc(lead.email)}`,
    lead.props?.jobtitle ? `Role: ${slackEsc(lead.props.jobtitle)}${lead.props.company ? ' @ ' + slackEsc(lead.props.company) : ''}` : null,
    `Breakdown: domain ${lead.parts.domain} / role ${lead.parts.role} / geo ${lead.parts.geo}`,
  ].filter(Boolean).join('\n');
  const sends = [];
  if (env.SLACK_BOT_TOKEN) {
    sends.push(fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID || 'C0AR4TB6Y77', text, unfurl_links: false }),
    }));
  }
  if (env.RESEND_API_KEY && env.ALERT_EMAIL) {
    sends.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MyPrivacyTOOL <hello@myprivacytool.io>',
        to: [env.ALERT_EMAIL],
        subject: `High Priority lead (${lead.score}): ${String(lead.email).replace(/[\r\n]/g, ' ')}`,
        html: `<pre>${htmlEsc(text.replace(/[*:]fire:/g, ''))}</pre>`,
      }),
    }));
  }
  await Promise.allSettled(sends);
}

// MPC-7500: cron sweep (every 5 min). Retries contacts created in the last 24h whose enrichment failed
// ('pending'), so every B2B signup is enriched within ~5 minutes even if Hunter had a blip. Bounded and fail-soft.
const SWEEP_LIMIT = 25;
async function sweepPending(env) {
  if (!env.HUBSPOT_TOKEN || !env.HUNTER_API_KEY) return { retried: 0 };
  const hs = { 'Authorization': `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST', headers: hs,
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'mpt_lead_enrich_status', operator: 'EQ', value: 'pending' },
        { propertyName: 'createdate', operator: 'GTE', value: String(Date.now() - 24 * 3600 * 1000) },
      ] }],
      properties: ['email', 'firstname', 'lastname'], limit: SWEEP_LIMIT,
    }),
  });
  if (!res.ok) { console.error('Sweep search failed:', res.status); return { retried: 0 }; }
  const { results = [] } = await res.json();
  let retried = 0;
  for (const c of results) {
    const email = c.properties?.email;
    if (!email) continue;
    try {
      const { result, props } = await enrichAndScore(env, email, '');
      const up = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${c.id}`, {
        method: 'PATCH', headers: hs, body: JSON.stringify({ properties: props }),
      });
      if (up.ok) {
        retried++;
        if (props.mpt_lead_enrich_status === 'scored') {
          await alertHighPriority(env, { email, name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' '), ...result, props });
        }
      }
    } catch (err) { console.error('Sweep contact error:', String(err)); }
  }
  return { retried };
}

// MPC-6956: insert one row into public.mpt_user_engagement using the service_role key
// (the table has RLS forced and no anon/authenticated write access). Stores no PII:
// only a random session id and funnel booleans. Never throws.
const DEFAULT_SUPABASE_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';
async function recordEngagement(env, sessionId, flags) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured - skipping engagement write');
    return false;
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/mpt_user_engagement`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ session_id: sessionId, ...flags }),
    });
    if (!res.ok) {
      console.error('Supabase mpt_user_engagement insert failed:', res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase mpt_user_engagement insert error:', String(err));
    return false;
  }
}

// MPC-7173: baseline snapshot. Keyed by SHA-256(lower-cased email); stores only scores, never the email.
// Returns { overall_score, created_at, is_first, delta } (delta = this scan minus baseline) or null.
async function saveBaseline(env, email, riskScore, categoryScores) {
  const score = Number(riskScore);
  if (riskScore === null || riskScore === '' || !Number.isFinite(score) || score < 0 || score > 100) return null;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const overall = Math.round(score);
  const cats = {};
  if (categoryScores && typeof categoryScores === 'object' && !Array.isArray(categoryScores)) {
    for (const [k, v] of Object.entries(categoryScores).slice(0, 20)) {
      const n = Number(v);
      if (/^[a-z_]{1,32}$/.test(k) && Number.isFinite(n) && n >= 0 && n <= 100) cats[k] = Math.round(n);
    }
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email).trim().toLowerCase()));
    const emailHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const base = `${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/mpt_score_baselines`;
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };

    // First scan wins: insert and ignore the conflict if a baseline already exists, then read it back.
    const ins = await fetch(base, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ email_hash: emailHash, overall_score: overall, category_scores: cats }),
    });
    if (!ins.ok) {
      console.error('Supabase mpt_score_baselines insert failed:', ins.status, (await ins.text()).slice(0, 200));
      return null;
    }
    const created = await ins.json();
    if (Array.isArray(created) && created.length) {
      return { overall_score: created[0].overall_score, created_at: created[0].created_at, is_first: true, delta: 0 };
    }
    const sel = await fetch(`${base}?email_hash=eq.${emailHash}&select=overall_score,created_at&limit=1`, { headers });
    if (!sel.ok) {
      console.error('Supabase mpt_score_baselines select failed:', sel.status);
      return null;
    }
    const rows = await sel.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return { overall_score: rows[0].overall_score, created_at: rows[0].created_at, is_first: false, delta: overall - rows[0].overall_score };
  } catch (err) {
    console.error('Supabase mpt_score_baselines error:', String(err));
    return null;
  }
}

// Parse User-Agent string into browser, os, device
function parseUserAgent(ua) {
  const u = ua.toLowerCase();
  let browser = '', os = '', device = 'Desktop';

  // Device first (order matters — mobile before browser)
  if (/ipad/.test(u)) {
    device = 'Tablet';
  } else if (/android(?!.*tablet)/.test(u) && /mobile/.test(u)) {
    device = 'Mobile';
  } else if (/tablet|kindle|silk/.test(u)) {
    device = 'Tablet';
  } else if (/mobile|iphone|ipod|blackberry|windows phone/.test(u)) {
    device = 'Mobile';
  }

  // Browser
  if (/edg\//.test(u))           browser = 'Edge';
  else if (/opr\/|opera/.test(u)) browser = 'Opera';
  else if (/chrome\//.test(u))   browser = 'Chrome';
  else if (/firefox\//.test(u))  browser = 'Firefox';
  else if (/safari\//.test(u) && !/chrome/.test(u)) browser = 'Safari';
  else if (/msie|trident/.test(u)) browser = 'IE';
  else if (ua) browser = 'Other';

  // OS
  if (/windows nt/.test(u))          os = 'Windows';
  else if (/mac os x|macintosh/.test(u) && !/iphone|ipad/.test(u)) os = 'macOS';
  else if (/iphone|ipad|ipod/.test(u)) os = 'iOS';
  else if (/android/.test(u))        os = 'Android';
  else if (/linux/.test(u))          os = 'Linux';
  else if (/cros/.test(u))           os = 'ChromeOS';
  else if (ua)                       os = 'Other';

  return { browser, os, device };
}

function toHKT(utcDate) {
  const HKT_OFFSET = 8 * 60;
  const hkt = new Date(utcDate.getTime() + HKT_OFFSET * 60 * 1000);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayName = days[hkt.getUTCDay()];
  const day = hkt.getUTCDate();
  const month = months[hkt.getUTCMonth()];
  const year = hkt.getUTCFullYear();
  const suffix = ordinal(day);
  const hh = String(hkt.getUTCHours()).padStart(2, '0');
  const mm = String(hkt.getUTCMinutes()).padStart(2, '0');
  const ss = String(hkt.getUTCSeconds()).padStart(2, '0');
  return { fullDate: `${dayName} ${day}${suffix} ${month} ${year}`, time: `${hh}:${mm}:${ss}` };
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function buildOtherInfo(phone, ip, country, city, browser, os, device, utm_content, referrer) {
  const parts = [];
  if (utm_content) parts.push(`Content: ${utm_content}`);
  if (referrer) parts.push(`Referrer: ${referrer}`);
  return parts.length ? parts.join(' | ') : '';
}

function inferSource(utm_source, utm_medium, utm_campaign, referrer) {
  const src = (utm_source || '').toLowerCase();
  const med = (utm_medium || '').toLowerCase();
  if (src === 'google' && (med === 'cpc' || med === 'ppc' || med === 'paid')) return ':google: Google Paid Ad';
  if (src === 'google' || (src === '' && med === 'organic')) return ':google: Google Organic';
  if (src === 'reddit')  return ':speech_balloon: Reddit';
  if (src === 'twitter' || src === 'x' || src === 'twitter.com' || src === 'x.com') return ':bird: Twitter / X';
  if (src === 'linkedin' || src === 'linkedin.com') return ':briefcase: LinkedIn';
  if (src === 'facebook' || src === 'fb') return ':facebook: Facebook';
  if (src === 'instagram' || src === 'ig') return ':camera: Instagram';
  if (src === 'email' || med === 'email') return ':email: Email';
  if (src) return `:link: ${utm_source}${utm_medium ? ' / ' + utm_medium : ''}`;
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, '');
      if (host.includes('google')) return ':google: Google (no UTM)';
      if (host.includes('reddit')) return ':speech_balloon: Reddit (no UTM)';
      if (host.includes('twitter') || host.includes('t.co')) return ':bird: Twitter (no UTM)';
      if (host.includes('linkedin')) return ':briefcase: LinkedIn (no UTM)';
      return `:link: ${host}`;
    } catch (_) {}
  }
  return ':door: Direct / Unknown';
}

function buildConfirmationEmail(firstName, source) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#1a1a2e">Hi ${firstName},</h2>
<p>Thanks for signing up — you're on the list.</p>
<p>We're preparing your free privacy exposure scan across 46 data categories including data brokers, social platforms, and AI training datasets.</p>
<p>You'll hear from us shortly with your full report.</p>
<p>In the meantime, if you have any questions, just reply to this email.</p>
<p style="margin-top:30px">Stay private,<br><strong>The MyPrivacyTOOL Team</strong></p>
<hr style="margin-top:40px;border:none;border-top:1px solid #eee">
<p style="font-size:12px;color:#999">MyPrivacyTOOL · myprivacytool.io</p>
</body></html>`;
}
