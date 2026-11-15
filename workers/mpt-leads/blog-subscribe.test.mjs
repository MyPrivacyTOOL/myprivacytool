// MPC-10616: /blog-subscribe (stubbed fetch, no network). Run: node workers/mpt-leads/blog-subscribe.test.mjs
import worker from './worker.js';
let calls = [], contacts = new Map(), failWrite = false;
const json = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b, text: async () => JSON.stringify(b), clone() { return this; } });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (!url.startsWith('https://api.hubapi.com/crm/v3/objects/contacts')) return json({});
  if (failWrite) return json({ message: 'boom' }, 500);
  const body = JSON.parse(opts.body);
  if (opts.method === 'POST') {
    const e = body.properties.email;
    if (contacts.has(e)) return json({ message: `Contact already exists. Existing ID: ${contacts.get(e).id}` }, 409);
    const c = { id: String(100 + contacts.size), properties: body.properties }; contacts.set(e, c); return json(c, 201);
  }
  const c = [...contacts.values()].find((x) => url.endsWith('/' + x.id)); Object.assign(c.properties, body.properties); return json(c);
};
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { HUBSPOT_TOKEN: 't' };
const post = async (body, e = env, origin = 'https://www.myprivacytool.io') => { calls = [];
  const res = await worker.fetch(new Request('https://x/blog-subscribe', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify(body) }), e, { waitUntil() {} });
  return { status: res.status, json: await res.json() }; };
const good = { email: 'a@b.example', consent: true, path: '/blog' };

let r = await post(good);
check(r.status === 200 && r.json.success && contacts.size === 1, 'valid submit creates one contact');
const p = contacts.get('a@b.example').properties;
check(p.blog_source === 'true' && p.blog_source_path === '/blog' && p.consent_source === 'blog_newsletter' && /^\d{4}-\d\d-\d\d$/.test(p.consent_given_at), 'contact carries blog_source=true, the page path and consent evidence');
check(calls.every((c) => c.url.startsWith('https://api.hubapi.com/')) && calls.length === 1, 'only HubSpot is called');
r = await post(good);
check(r.status === 200 && contacts.size === 1 && calls.length === 2 && calls[1].opts.method === 'PATCH', 'repeat submit updates the same contact, no duplicate');
r = await post({ ...good, email: 'nope' }); check(r.status === 400 && contacts.size === 1, 'invalid email refused, nothing written');
r = await post({ ...good, consent: false }); check(r.status === 400 && /Consent/.test(r.json.error), 'no consent refused');
r = await post({ ...good, email: 'c@d.example', path: '/blog?x=<script>' }); check(contacts.get('c@d.example').properties.blog_source_path === '/blogxscript', 'path is sanitised');
r = await post(good, env, 'https://evil.example'); check(r.status === 403, 'other origin refused');
r = await post(good, {}); check(r.status === 503, 'no token: 503, never a false success');
failWrite = true; r = await post({ ...good, email: 'e@f.example' }); check(r.status === 502, 'HubSpot failure returns 502');
process.exit(ok ? 0 : 1);
