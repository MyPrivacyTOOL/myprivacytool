// MPC-8751: one-off setup of delivery tracking at Resend, run from the "Setup Resend delivery tracking" workflow (manual dispatch only).
//   inspect : read-only. Lists whether the webhook exists and the domain's tracking flags. Changes nothing.
//   apply   : creates the webhook if it does not exist (never a second one), reads its signing secret into SECRET_OUT (file, mode 0600, never printed),
//             and sets the sending domain to click tracking ON, open tracking OFF (open tracking is a pixel; we do not use pixels).
//   verify  : needs RESEND_WEBHOOK_SECRET. Posts an UNSIGNED request (must be 401: endpoint on, signature enforced) and a correctly SIGNED click event
//             for a message id that does not exist (must be 200: verified, matched to nothing, nothing stored). A click is used because it needs only the per-send
//             function (MPC-7556); delivered/bounced/complained events also need the CK-8503 receipts function and answer 500 until that migration is applied.
// No address, key or secret is printed. Exit 1 on any failed expectation.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { signReceipt } from '../workers/scan-report/lib/receipts.js';

export const EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.clicked'];
const API = 'https://api.resend.com';

export async function run(env, { fetchImpl = fetch, log = console.log, writeFile = writeFileSync } = {}) {
  const mode = env.MODE || 'inspect';
  const worker = (env.WORKER_URL || 'https://mpt-scan-report.myprivacytool.workers.dev').replace(/\/$/, '');
  const endpoint = `${worker}/api/resend-webhook`;
  const domainName = env.DOMAIN || 'myprivacytool.io';
  const out = { ok: true, problems: [] };
  const fail = (m) => { out.ok = false; out.problems.push(m); log(`FAIL ${m}`); };
  if (!['inspect', 'apply', 'verify'].includes(mode)) { fail(`unknown MODE ${mode}`); return out; }

  if (mode === 'verify') {
    if (!env.RESEND_WEBHOOK_SECRET) { fail('verify needs RESEND_WEBHOOK_SECRET'); return out; }
    const body = JSON.stringify({ type: 'email.clicked', created_at: new Date().toISOString(), data: { email_id: `setup-check-${Date.now()}` } });
    const unsigned = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    log(unsigned.status === 401 ? 'PASS unsigned request refused (401): endpoint is on and enforces the signature' : `FAIL unsigned request answered ${unsigned.status}, expected 401`);
    if (unsigned.status !== 401) out.ok = false;
    const id = `msg_setup_${Date.now()}`, ts = String(Math.floor(Date.now() / 1000));
    const signed = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': await signReceipt(env.RESEND_WEBHOOK_SECRET, id, ts, body) }, body });
    log(signed.status === 200 ? 'PASS correctly signed test event accepted (200), matched to no send, nothing stored' : `FAIL signed test event answered ${signed.status}, expected 200`);
    if (signed.status !== 200) out.ok = false;
    return out;
  }

  const key = env.RESEND_API_KEY;
  if (!key) { fail('RESEND_API_KEY missing'); return out; }
  const h = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const call = async (method, path, body) => {
    const r = await fetchImpl(`${API}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  };

  const hooks = await call('GET', '/webhooks');
  if (hooks.status !== 200) { fail(`GET /webhooks answered ${hooks.status} (${hooks.json?.name || 'error'}): the API key may be sending-only; a full-access key is needed to manage webhooks`); return out; }
  const mine = (hooks.json.data || []).find((w) => w.endpoint === endpoint);
  log(`webhook for our endpoint: ${mine ? `exists (${(mine.events || []).length} events, status ${mine.status || 'n/a'})` : 'not created'}`);

  const doms = await call('GET', '/domains');
  const dom = doms.status === 200 ? (doms.json.data || []).find((d) => d.name === domainName) : null;
  if (doms.status !== 200) fail(`GET /domains answered ${doms.status}`);
  else if (!dom) fail(`sending domain ${domainName} not found among: ${(doms.json.data || []).map((d) => d.name).join(', ') || 'none'}`);
  else log(`domain ${domainName}: click_tracking=${dom.click_tracking ?? 'unknown'}, open_tracking=${dom.open_tracking ?? 'unknown'}`);
  if (mode === 'inspect' || !out.ok) return out;

  let id = mine?.id;
  if (!mine) {
    const c = await call('POST', '/webhooks', { endpoint, events: EVENTS });
    if (c.status >= 300 || !c.json.id) { fail(`create webhook answered ${c.status}`); return out; }
    id = c.json.id; log('created webhook');
  }
  const g = await call('GET', `/webhooks/${id}`);
  const secret = g.json?.signing_secret;
  if (!secret) { fail('signing secret not returned by Resend'); return out; }
  writeFile(env.SECRET_OUT || '.resend-webhook-secret', secret, { mode: 0o600 });
  log('signing secret written to the secret file (not printed)');

  const p = await call('PATCH', `/domains/${dom.id}`, { click_tracking: true, open_tracking: false });
  if (p.status >= 300) fail(`PATCH domain tracking answered ${p.status}`); else log('domain tracking set: click ON, open OFF');
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await run(process.env);
  process.exit(r.ok ? 0 : 1);
}
