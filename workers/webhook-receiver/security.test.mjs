// Run: node workers/webhook-receiver/security.test.mjs  (no network, no secrets)
import { createHmac } from 'node:crypto';
import worker from './index.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
const env = { TELEGRAM_WEBHOOK_SECRET: 'tg', META_APP_SECRET: 'meta', TWILIO_AUTH_TOKEN: 'tw', EMAIL_WEBHOOK_SECRET: 'em', META_VERIFY_KEY: 'vk' };
const run = (path, init, e = env) => worker.fetch(new Request('https://x' + path, init), e, { waitUntil() {} });

// Telegram
let r = await run('/webhook/telegram', { method: 'POST', body: '{}' }); check(r.status === 401, 'telegram: no secret header => 401');
r = await run('/webhook/telegram', { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'nope' } }); check(r.status === 401, 'telegram: wrong secret => 401');
r = await run('/webhook/telegram', { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg' } }); check(r.status === 200, 'telegram: right secret => 200');
r = await run('/webhook/telegram', { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg' } }, {}); check(r.status === 401, 'telegram: secret unset => fails closed');

// Meta
const body = JSON.stringify({ entry: [] });
const sig = 'sha256=' + createHmac('sha256', 'meta').update(body).digest('hex');
for (const p of ['messenger', 'whatsapp', 'instagram']) {
  r = await run('/webhook/' + p, { method: 'POST', body }); check(r.status === 401, `${p}: unsigned => 401`);
  r = await run('/webhook/' + p, { method: 'POST', body, headers: { 'X-Hub-Signature-256': sig } }); check(r.status === 200, `${p}: valid signature => 200`);
}
r = await run('/webhook/messenger?hub.mode=subscribe&hub.verify_token=vk&hub.challenge=abc'); check(r.status === 200 && await r.text() === 'abc', 'meta verify handshake works with right token');
r = await run('/webhook/messenger?hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc'); check(r.status === 403, 'meta verify handshake rejects wrong token');
r = await run('/webhook/messenger?hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=abc', {}, {}); check(r.status === 403, 'meta verify: unset secret never matches');

// Twilio
const url = 'https://x/webhook/sms'; const params = new URLSearchParams({ From: '+15550001', Body: 'Y' });
const tsig = createHmac('sha1', 'tw').update(url + 'Body' + 'Y' + 'From' + '+15550001').digest('base64');
r = await run('/webhook/sms', { method: 'POST', body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); check(r.status === 401, 'sms: unsigned => 401');
r = await run('/webhook/sms', { method: 'POST', body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': tsig } }); check(r.status === 200, 'sms: valid Twilio signature => 200');
check((await r.text()).startsWith('<?xml'), 'sms: TwiML returned');

// Email
r = await run('/webhook/email', { method: 'POST', body: JSON.stringify({ from: 'a@b.co' }) }); check(r.status === 401, 'email: no secret => 401');
r = await run('/webhook/email', { method: 'POST', body: JSON.stringify({ from: 'bad' }), headers: { 'X-Webhook-Secret': 'em' } }); check(r.status === 400, 'email: invalid address => 400');
r = await run('/webhook/email', { method: 'POST', body: JSON.stringify({ from: 'a@b.co' }), headers: { 'X-Webhook-Secret': 'em' } }); check(r.status === 200, 'email: valid => 200');

// Leads CORS
r = await run('/webhook/leads', { method: 'POST', body: '{"email":"a@b.co"}', headers: { Origin: 'https://evil.example' } }); check(r.status === 403 && r.headers.get('access-control-allow-origin') !== '*', 'leads: foreign origin => 403, no wildcard CORS');
r = await run('/webhook/leads', { method: 'OPTIONS', headers: { Origin: 'https://www.myprivacytool.io' } }); check(r.status === 204 && r.headers.get('access-control-allow-origin') === 'https://www.myprivacytool.io', 'leads: preflight echoes allowed origin only');
r = await run('/webhook/leads', { method: 'POST', body: '{"email":"nope"}', headers: { Origin: 'https://myprivacytool.io' } }); check(r.status === 400, 'leads: invalid email => 400');
r = await run('/webhook/leads', { method: 'POST', body: '{"email":"a@b.co"}', headers: { Origin: 'https://myprivacytool.io' } }); check(r.status === 200, 'leads: valid => 200');
process.exit(ok ? 0 : 1);
