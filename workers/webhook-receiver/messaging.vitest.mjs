// @vitest-environment node
// CK-9837: Messenger and WhatsApp first replies (test mode). Stubbed fetch: no network, no secrets.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { decide, welcomeText, messengerEvents, messagingEnabled, graphVersion } from './meta-chat.js';

const SECRET = 'app-secret-xyz';
const TOKEN = 'page-token-SECRET-123';
const WA_TOKEN = 'wa-token-SECRET-456';
const ENV = { META_APP_SECRET: SECRET, META_PAGE_ACCESS_KEY: TOKEN, META_WHATSAPP_KEY: WA_TOKEN, WHATSAPP_PHONE_NUMBER_ID: '999', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'https://db.invalid', MESSAGING_ENABLED: 'true' };

let store, sends, hubspot;
beforeEach(() => {
  store = new Map(); sends = []; hubspot = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://graph.facebook.com')) { sends.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
    if (url.includes('hubapi.com')) { hubspot++; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
    if (url.startsWith('https://db.invalid/rest/v1/mpt_conversation_state')) {
      const u = new URL(url); const key = decodeURIComponent((u.searchParams.get('key') || '').replace(/^eq\./, ''));
      if (init.method === 'POST') { const b = JSON.parse(init.body); store.set(b.key, b.state); return { ok: true, status: 201, json: async () => [], text: async () => '' }; }
      if (init.method === 'DELETE') { const had = store.has(key); const st = store.get(key); store.delete(key); return { ok: true, status: 200, json: async () => (had ? [{ state: st }] : []), text: async () => '' }; }
      return { ok: true, status: 200, json: async () => (store.has(key) ? [{ state: store.get(key) }] : []), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sign = (raw) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
const post = async (path, body, env = ENV, headers) => {
  const raw = JSON.stringify(body);
  return worker.fetch(new Request('https://x' + path, { method: 'POST', body: raw, headers: headers ?? { 'X-Hub-Signature-256': sign(raw) } }), env, { waitUntil() {} });
};
const msgr = (id, text, extra = {}) => ({ entry: [{ messaging: [{ sender: { id }, message: { text, ...extra } }] }] });
const wa = (from, text) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Sam' } }], messages: [{ from, id: 'wamid.1', timestamp: '1', text: { body: text } }] } }] }] });

describe('Messenger', () => {
  it('stays silent and stores nothing while MESSAGING_ENABLED is not "true"', async () => {
    for (const flag of [undefined, '', 'false', 'TRUE', '1']) {
      const r = await post('/webhook/messenger', msgr('u1', 'hi'), { ...ENV, MESSAGING_ENABLED: flag });
      expect(r.status).toBe(200);
    }
    expect(sends).toHaveLength(0); expect(store.size).toBe(0);
  });

  it('first message gets one automated reply with the tracked scan link, as plain text, via a header token, and makes no HubSpot contact', async () => {
    const r = await post('/webhook/messenger', msgr('u1', 'hello'));
    expect(r.status).toBe(200);
    expect(sends).toHaveLength(1);
    const s = sends[0];
    expect(s.url).toBe('https://graph.facebook.com/v23.0/me/messages');
    expect(s.url).not.toContain(TOKEN); expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(s.body).toMatchObject({ messaging_type: 'RESPONSE', recipient: { id: 'u1' } });
    const t = s.body.message.text;
    expect(t).toContain('automated');
    expect(t).toContain('https://www.myprivacytool.io/scan?utm_source=facebook&utm_medium=messenger&utm_campaign=messenger-welcome');
    expect(t).toContain('1 business day');
    expect(t).not.toMatch(/<[a-z/]+>/i);            // no HTML tags: these channels print them literally
    expect(t).not.toMatch(/data brokers|publicly visible|60 seconds/i);   // the old unbacked claims
    expect(hubspot).toBe(0);
  });

  it('a second message gets one acknowledgement and after that no more automatic replies', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello'));
    await post('/webhook/messenger', msgr('u1', 'a question'));
    await post('/webhook/messenger', msgr('u1', 'another'));
    await post('/webhook/messenger', msgr('u1', 'and another'));
    expect(sends).toHaveLength(2);
    expect(sends[1].body.message.text).toContain('A person will reply within 1 business day');
  });

  it('STOP deletes the saved conversation, confirms, and the next message starts fresh', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello'));
    expect(store.has('messenger:u1')).toBe(true);
    await post('/webhook/messenger', msgr('u1', ' stop '));
    expect(store.has('messenger:u1')).toBe(false);
    expect(sends[1].body.message.text).toContain('deleted this conversation');
    expect(sends[1].body.message.text).toContain('privacy@myprivacytool.io');
    await post('/webhook/messenger', msgr('u1', 'hello again'));
    expect(sends[2].body.message.text).toContain('automated');
  });

  it('ignores echoes of our own messages, delivery and read receipts', async () => {
    await post('/webhook/messenger', msgr('PAGE', 'our own reply', { is_echo: true }));
    await post('/webhook/messenger', { entry: [{ messaging: [{ sender: { id: 'u9' }, delivery: { watermark: 1 } }, { sender: { id: 'u9' }, read: { watermark: 2 } }] }] });
    expect(sends).toHaveLength(0); expect(store.size).toBe(0);
  });

  it('answers every sender in a batched webhook, not only the first', async () => {
    await post('/webhook/messenger', { entry: [{ messaging: [{ sender: { id: 'a' }, message: { text: 'hi' } }, { sender: { id: 'b' }, message: { text: 'hi' } }] }, { messaging: [{ sender: { id: 'c' }, message: { text: 'hi' } }] }] });
    expect(sends.map((s) => s.body.recipient.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps authentication unchanged: an unsigned or wrongly signed request is refused and nothing is sent', async () => {
    expect((await post('/webhook/messenger', msgr('u1', 'hi'), ENV, {})).status).toBe(401);
    expect((await post('/webhook/messenger', msgr('u1', 'hi'), ENV, { 'X-Hub-Signature-256': 'sha256=00' })).status).toBe(401);
    expect(sends).toHaveLength(0);
  });

  it('uses META_GRAPH_VERSION when set', async () => {
    await post('/webhook/messenger', msgr('u1', 'hi'), { ...ENV, META_GRAPH_VERSION: 'v99.0' });
    expect(sends[0].url).toBe('https://graph.facebook.com/v99.0/me/messages');
  });
});

describe('WhatsApp', () => {
  it('stays silent while the switch is off', async () => {
    const r = await post('/webhook/whatsapp', wa('85200000000', 'hi'), { ...ENV, MESSAGING_ENABLED: 'false' });
    expect(r.status).toBe(200); expect(sends).toHaveLength(0); expect(store.size).toBe(0);
  });

  it('first message gets the automated reply as plain text, no HubSpot contact; STOP deletes the saved conversation', async () => {
    await post('/webhook/whatsapp', wa('85200000000', 'hello'));
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toBe('https://graph.facebook.com/v23.0/999/messages');
    expect(sends[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '85200000000', type: 'text' });
    const t = sends[0].body.text.body;
    expect(t).toContain('utm_medium=whatsapp'); expect(t).toContain('automated'); expect(t).not.toMatch(/<[a-z/]+>/i);
    expect(hubspot).toBe(0);
    expect(store.has('whatsapp:85200000000')).toBe(true);
    await post('/webhook/whatsapp', wa('85200000000', 'STOP'));
    expect(store.has('whatsapp:85200000000')).toBe(false);
    expect(sends[1].body.text.body).toContain('deleted this conversation');
  });
});

describe('meta-chat helpers', () => {
  it('messagingEnabled is true only for the exact string "true"', () => {
    expect(messagingEnabled({ MESSAGING_ENABLED: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', 'yes', 1, true]) expect(messagingEnabled({ MESSAGING_ENABLED: v })).toBe(false);
    expect(messagingEnabled(undefined)).toBe(false);
  });
  it('graphVersion has a default and an override', () => { expect(graphVersion({})).toBe('v23.0'); expect(graphVersion({ META_GRAPH_VERSION: 'v1.0' })).toBe('v1.0'); });
  it('decide: welcome, then acknowledge, then silent; STOP always deletes', () => {
    expect(decide({ channel: 'messenger', text: 'x', state: null }).next.stage).toBe('welcomed');
    expect(decide({ channel: 'messenger', text: 'x', state: { stage: 'welcomed' } }).next.stage).toBe('acked');
    expect(decide({ channel: 'messenger', text: 'x', state: { stage: 'acked' } }).reply).toBeNull();
    expect(decide({ channel: 'messenger', text: 'DELETE', state: { stage: 'acked' } }).next).toBe('delete');
  });
  it('messengerEvents tolerates malformed bodies', () => { expect(messengerEvents(null)).toEqual([]); expect(messengerEvents({ entry: [{}] })).toEqual([]); expect(welcomeText('messenger')).toContain('automated'); });
});
