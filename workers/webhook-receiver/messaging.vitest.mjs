// @vitest-environment node
// CK-9837: Messenger and WhatsApp consent card, menu card and buttons (test mode). Stubbed fetch: no network, no secrets.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { decide, messengerEvents, messagingEnabled, graphVersion, messengerMessage, whatsappMessage, notifyHandoff, TEXT, BTN, PAYLOAD, NOTICE_VERSION } from './meta-chat.js';

const SECRET = 'app-secret-xyz';
const TOKEN = 'page-token-SECRET-123';
const WA_TOKEN = 'wa-token-SECRET-456';
const ENV = { META_APP_SECRET: SECRET, META_PAGE_ACCESS_KEY: TOKEN, META_WHATSAPP_KEY: WA_TOKEN, WHATSAPP_PHONE_NUMBER_ID: '999', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'https://db.invalid', MESSAGING_ENABLED: 'true' };

let store, sends, hubspot, hooks;
beforeEach(() => {
  store = new Map(); sends = []; hubspot = 0; hooks = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://graph.facebook.com')) { sends.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
    if (url.includes('hubapi.com')) { hubspot++; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
    if (url.startsWith('https://hooks.slack.test')) { hooks.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
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
const tap = (id, payload) => ({ entry: [{ messaging: [{ sender: { id }, postback: { payload, title: 'x' } }] }] });
const wa = (from, text) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Sam' } }], messages: [{ from, id: 'wamid.1', timestamp: '1', text: { body: text } }] } }] }] });
const waTap = (from, id) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.2', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } }] } }] }] });
const messages = () => sends.filter((s) => s.body.message).map((s) => s.body.message);
const card = (m) => m.attachment.payload.elements[0];

describe('Messenger flow', () => {
  it('stays silent and stores nothing while MESSAGING_ENABLED is not exactly "true"', async () => {
    for (const flag of [undefined, '', 'false', 'TRUE', '1']) expect((await post('/webhook/messenger', msgr('u1', 'hi'), { ...ENV, MESSAGING_ENABLED: flag })).status).toBe(200);
    expect(sends).toHaveLength(0); expect(store.size).toBe(0);
  });

  it('first contact: typing indicator, then ONE home card (value first) with image and three buttons; NOTHING is saved; no HubSpot contact', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello'));
    expect(sends[0].body).toMatchObject({ recipient: { id: 'u1' }, sender_action: 'typing_on' });
    expect(messages()).toHaveLength(1);
    const c = card(messages()[0]);
    expect(c.title).toBe("Hi 👋 I'm MyPrivacyTOOL's automated assistant.");
    expect(c.subtitle).toBe('Run the free scan to see your digital footprint.');
    expect(c.image_url).toBe('https://www.myprivacytool.io/og-image.jpg');
    expect(c.buttons.map((b) => b.title)).toEqual(['🔍 Free scan', '💬 Ask a question', '🗑️ Delete my data']);
    expect(c.buttons[0]).toMatchObject({ type: 'web_url', url: 'https://www.myprivacytool.io/scan?utm_source=facebook&utm_medium=messenger&utm_campaign=messenger-welcome' });
    expect(sends.every((x) => x.url === 'https://graph.facebook.com/v23.0/me/messages' && x.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(sends)).not.toContain('/me/messages?');
    expect(hubspot).toBe(0); expect(store.size).toBe(0);
  });

  it('before consent a person is never left in silence and nothing is ever saved: each typed message gets the home card again', async () => {
    for (const t of ['hello', 'scan me', 'anyone there?', 'hello??', 'hi']) await post('/webhook/messenger', msgr('u1', t));
    expect(messages()).toHaveLength(5); expect(messages().every((m) => card(m).title.includes('automated assistant'))).toBe(true);
    expect(store.size).toBe(0); expect(hooks).toHaveLength(0);
  });

  it('"Talk to a person" first asks for agreement (consent card, still nothing saved); "No thanks" sends the approved line and saves nothing', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello')); sends.length = 0;
    await post('/webhook/messenger', tap('u1', PAYLOAD.person));
    const c = card(messages()[0]);
    expect(c.title).toBe('By chatting you agree to our Privacy Policy.');
    expect(c.buttons.map((b) => b.title)).toEqual(['✅ I agree', '❌ No thanks', 'Privacy Policy']);
    expect(c.buttons[2]).toMatchObject({ type: 'web_url', url: 'https://www.myprivacytool.io/privacy' });
    expect(store.size).toBe(0);
    sends.length = 0; await post('/webhook/messenger', tap('u1', PAYLOAD.no));
    expect(messages()).toEqual([{ text: "No problem 👍 We won't message you again." }]); expect(store.size).toBe(0); expect(hooks).toHaveLength(0);
  });

  it('"I agree" saves consent time and policy version, sends the approved line once and flags ONE handoff; later messages get no automatic reply', async () => {
    const env = { ...ENV, HANDOFF_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' };
    await post('/webhook/messenger', msgr('u1', 'hello'), env); await post('/webhook/messenger', tap('u1', PAYLOAD.person), env); sends.length = 0;
    await post('/webhook/messenger', tap('u1', PAYLOAD.yes), env);
    expect(messages()).toEqual([{ text: 'Thanks 🙌 A higher consciousness will reply within 24 hours.' }]);
    const st = store.get('messenger:u1'); expect(st).toMatchObject({ stage: 'human_requested', noticeVersion: NOTICE_VERSION }); expect(typeof st.consentAt).toBe('number');
    expect(hooks).toHaveLength(1); expect(hooks[0].text).toMatch(/messenger \(ref [0-9a-f]{8}\)/); expect(JSON.stringify(hooks)).not.toMatch(/u1|hello/);
    sends.length = 0;
    await post('/webhook/messenger', msgr('u1', 'a question'), env); await post('/webhook/messenger', tap('u1', PAYLOAD.person), env); await post('/webhook/messenger', tap('u1', PAYLOAD.yes), env);
    expect(sends).toHaveLength(0); expect(hooks).toHaveLength(1);
  });

  it('"Delete my data" and typed STOP send the approved line and leave nothing saved, before or after consent', async () => {
    for (const how of ['button', 'text']) for (const consented of [false, true]) {
      store.clear(); sends.length = 0;
      await post('/webhook/messenger', msgr('u1', 'hello'));
      if (consented) { await post('/webhook/messenger', tap('u1', PAYLOAD.person)); await post('/webhook/messenger', tap('u1', PAYLOAD.yes)); }
      sends.length = 0;
      await post('/webhook/messenger', how === 'button' ? tap('u1', PAYLOAD.del) : msgr('u1', ' stop '));
      expect(store.has('messenger:u1')).toBe(false);
      expect(messages()).toEqual([{ text: 'Done ✅ Deleted. Anything else: privacy@myprivacytool.io' }]);
      sends.length = 0; await post('/webhook/messenger', msgr('u1', 'hi again')); expect(card(messages()[0]).title).toContain('automated assistant');
    }
  });

  it('ignores echoes of our own messages, delivery and read receipts; answers every sender in a batch', async () => {
    await post('/webhook/messenger', msgr('PAGE', 'our reply', { is_echo: true }));
    await post('/webhook/messenger', { entry: [{ messaging: [{ sender: { id: 'u9' }, delivery: { watermark: 1 } }, { sender: { id: 'u9' }, read: { watermark: 2 } }] }] });
    expect(sends).toHaveLength(0);
    await post('/webhook/messenger', { entry: [{ messaging: [{ sender: { id: 'a' }, message: { text: 'hi' } }, { sender: { id: 'b' }, message: { text: 'hi' } }] }] });
    expect(messages()).toHaveLength(2);
  });

  it('authentication is unchanged: unsigned or wrongly signed requests are refused and nothing is sent', async () => {
    expect((await post('/webhook/messenger', msgr('u1', 'hi'), ENV, {})).status).toBe(401);
    expect((await post('/webhook/messenger', msgr('u1', 'hi'), ENV, { 'X-Hub-Signature-256': 'sha256=00' })).status).toBe(401);
    expect(sends).toHaveLength(0);
  });

  it('uses META_GRAPH_VERSION and META_CARD_IMAGE_URL when set', async () => {
    await post('/webhook/messenger', msgr('u1', 'hi'), { ...ENV, META_GRAPH_VERSION: 'v99.0', META_CARD_IMAGE_URL: 'https://img.example/a.jpg' });
    expect(sends[0].url).toBe('https://graph.facebook.com/v99.0/me/messages'); expect(card(messages()[0]).image_url).toBe('https://img.example/a.jpg');
  });
});

describe('WhatsApp flow', () => {
  it('stays silent while the switch is off', async () => {
    expect((await post('/webhook/whatsapp', wa('85200000000', 'hi'), { ...ENV, MESSAGING_ENABLED: 'false' })).status).toBe(200);
    expect(sends).toHaveLength(0); expect(store.size).toBe(0);
  });

  it('home message with image header and three reply buttons; scan button sends the preview link then the menu again; nothing saved before consent', async () => {
    await post('/webhook/whatsapp', wa('85200000000', 'hello'));
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toBe('https://graph.facebook.com/v23.0/999/messages');
    const b = sends[0].body;
    expect(b).toMatchObject({ messaging_product: 'whatsapp', to: '85200000000', type: 'interactive' });
    expect(b.interactive.header.image.link).toBe('https://www.myprivacytool.io/og-image.jpg');
    expect(b.interactive.body.text).toContain('automated assistant'); expect(b.interactive.body.text).toContain('digital footprint');
    expect(b.interactive.action.buttons.map((x) => x.reply.id)).toEqual(['SCAN', 'HUMAN', 'DELETE']);
    expect(hubspot).toBe(0); expect(store.size).toBe(0);
    sends.length = 0; await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.scan));
    expect(sends[0].body).toMatchObject({ type: 'text', text: { preview_url: true } }); expect(sends[0].body.text.body).toContain('utm_medium=whatsapp');
    expect(sends[1].body.interactive.body.text).toBe('What would you like to do?'); expect(store.size).toBe(0);
  });

  it('talk to a person asks for agreement with two reply buttons, then agrees; delete removes everything', async () => {
    await post('/webhook/whatsapp', wa('85200000000', 'hello')); sends.length = 0;
    await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.person));
    expect(sends[0].body.interactive.body.text).toContain('By chatting you agree to our Privacy Policy.');
    expect(sends[0].body.interactive.action.buttons.map((x) => x.reply.id)).toEqual(['CONSENT_YES', 'CONSENT_NO']); expect(store.size).toBe(0);
    sends.length = 0; await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.yes));
    expect(sends[0].body.text.body).toBe('Thanks 🙌 A higher consciousness will reply within 24 hours.'); expect(store.get('whatsapp:85200000000')).toMatchObject({ stage: 'human_requested' });
    sends.length = 0; await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.del));
    expect(sends[0].body.text.body).toBe('Done ✅ Deleted. Anything else: privacy@myprivacytool.io'); expect(store.has('whatsapp:85200000000')).toBe(false);
  });
});

describe('meta-chat helpers', () => {
  it('messagingEnabled is true only for the exact string "true"', () => {
    expect(messagingEnabled({ MESSAGING_ENABLED: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', 'yes', 1, true]) expect(messagingEnabled({ MESSAGING_ENABLED: v })).toBe(false);
    expect(messagingEnabled(undefined)).toBe(false);
  });
  it('graphVersion has a default and an override', () => { expect(graphVersion({})).toBe('v23.0'); expect(graphVersion({ META_GRAPH_VERSION: 'v1.0' })).toBe('v1.0'); });
  it('button titles fit the 20-character limit and the approved words are exact', () => {
    for (const t of Object.values(BTN)) expect([...t].length).toBeLessThanOrEqual(20);
    expect(TEXT.person).toBe('Thanks 🙌 A higher consciousness will reply within 24 hours.'); expect(TEXT.declined).toBe("No problem 👍 We won't message you again.");
  });
  it('decide: nothing is saved before consent; only "I agree" saves and hands off; STOP always deletes', () => {
    for (const input of [{ text: 'hi' }, { payload: PAYLOAD.start }, { payload: PAYLOAD.person }, { payload: PAYLOAD.scan }]) expect(decide({ ...input, state: null }).next).toBeNull();
    expect(decide({ payload: PAYLOAD.person, state: null }).handoff).toBe(false);
    expect(decide({ payload: PAYLOAD.yes, state: null })).toMatchObject({ handoff: true, next: { stage: 'human_requested' } });
    expect(decide({ text: 'DELETE', state: { stage: 'human_requested' } }).next).toBe('delete');
    expect(decide({ text: 'hello', state: { stage: 'human_requested' } }).steps).toEqual([]);
  });
  it('messengerEvents tolerates malformed bodies; renderers return the expected shapes', () => {
    expect(messengerEvents(null)).toEqual([]); expect(messengerEvents({ entry: [{}] })).toEqual([]);
    expect(messengerMessage({ kind: 'text', text: 'x' }, {})).toEqual({ text: 'x' }); expect(whatsappMessage({ kind: 'text', text: 'x' }, {})).toEqual({ type: 'text', text: { body: 'x' } });
  });
  it('notifyHandoff without a target only logs; a failing target does not throw', async () => {
    expect(await notifyHandoff({}, 'messenger', 'u1')).toEqual({ notified: false });
    expect(await notifyHandoff({ HANDOFF_SLACK_WEBHOOK_URL: 'https://x' }, 'messenger', 'u1', async () => { throw new Error('down'); })).toEqual({ notified: false });
  });
});
