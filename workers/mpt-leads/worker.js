export default {
  async fetch(request, env, ctx) {
    const allow = ['https://myprivacytool.io', 'https://www.myprivacytool.io'];
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = allow.includes(origin) ? origin : allow[0];

    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    try {
      let name = '', email = '', phone = '';
      let utm_source = '', utm_medium = '', utm_campaign = '', utm_content = '', referrer = '';
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const b = await request.json();
        name = b.name || ''; email = b.email || ''; phone = b.phone || '';
        utm_source = b.utm_source || ''; utm_medium = b.utm_medium || '';
        utm_campaign = b.utm_campaign || ''; utm_content = b.utm_content || '';
        referrer = b.referrer || '';
      } else {
        const fd = await request.formData();
        name = fd.get('name') || ''; email = fd.get('email') || ''; phone = fd.get('phone') || '';
        utm_source = fd.get('utm_source') || ''; utm_medium = fd.get('utm_medium') || '';
        utm_campaign = fd.get('utm_campaign') || ''; utm_content = fd.get('utm_content') || '';
        referrer = fd.get('referrer') || '';
      }

      if (!email) {
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

      const firstName = name ? name.split(' ')[0] : 'there';

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
        console.error('Notion error:', e);
        return new Response(JSON.stringify({ error: 'Save failed', detail: e }), {
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
          `Name: ${name || '(not given)'}`,
          `Email: ${email}`,
          phone ? `Phone: ${phone}` : null,
          ``,
          `IP: ${ip || '—'} | ${city || '—'}, ${country || '—'}`,
          `Browser: ${browser || '—'} | OS: ${os || '—'} | Device: ${device || '—'}`,
          ``,
          `Other Info: ${otherInfo}`,
          `Where they came from ${source}`,
          `Campaign ${utm_campaign || '—'}`,
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

      // 4. HubSpot CRM sync
      if (env.HUBSPOT_TOKEN) {
        const nameParts = (name || '').trim().split(/\s+/);
        const hsProps = {
          email,
          firstname: nameParts[0] || '',
          lastname:  nameParts.slice(1).join(' ') || '',
          hs_lead_status: 'NEW',
        };
        if (phone) hsProps.phone = phone;

        side.push(
          fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: hsProps })
          }).then(async r => {
            if (r.status === 409) {
              const existing = await r.json();
              const vid = existing?.message?.match(/ID: (\d+)/)?.[1];
              if (vid) {
                return fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${vid}`, {
                  method: 'PATCH',
                  headers: { 'Authorization': `Bearer ${env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ properties: hsProps })
                });
              }
            }
          }).catch(() => {})
        );
      }

      // 5. Confirmation email via Resend
      if (env.RESEND_API_KEY) {
        const emailHtml = buildConfirmationEmail(firstName, source);
        side.push(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'MyPrivacyTOOL <hello@myprivacytool.io>',
              to: [email],
              subject: `${firstName}, your privacy scan is being prepared`,
              html: emailHtml,
            })
          }).catch(() => {})
        );
      }

      ctx.waitUntil(Promise.all(side));

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};

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
