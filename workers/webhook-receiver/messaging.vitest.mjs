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

  it('first contact: typing indicator, then ONE consent card with the approved words, image and three buttons; nothing else is sent; no HubSpot contact', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello'));
    expect(sends[0].body).toMatchObject({ recipient: { id: 'u1' }, sender_action: 'typing_on' });
    expect(messages()).toHaveLength(1);
    const c = card(messages()[0]);
    expect(c.title).toBe("Hi 👋 I'm MyPrivacyTOOL's automated assistant.");
    expect(c.subtitle).toBe('By chatting you agree to our Privacy Policy.');
    expect(c.image_url).toBe('https://www.myprivacytool.io/og-image.jpg');
    expect(c.buttons.map((b) => b.title)).toEqual(['✅ I agree', '❌ No thanks', 'Privacy Policy']);
    expect(c.buttons[2]).toMatchObject({ type: 'web_url', url: 'https://www.myprivacytool.io/privacy' });
    expect(sends.every((s) => s.url === 'https://graph.facebook.com/v23.0/me/messages' && s.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(sends)).not.toContain(`/me/messages?`);          // token never in a URL
    expect(hubspot).toBe(0);
    expect(store.get('messenger:u1')).toMatchObject({ stage: 'asked' });
  });

  it('"I agree" saves the consent time and the policy version and shows the menu card with the three buttons', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello'));
    sends.length = 0;
    await post('/webhook/messenger', tap('u1', PAYLOAD.yes));
    const st = store.get('messenger:u1');
    expect(st).toMatchObject({ stage: 'consented', noticeVersion: NOTICE_VERSION }); expect(typeof st.consentAt).toBe('number');
    const c = card(messages()[0]);
    expect(c.title).toBe('What would you like to do?');
    expect(c.buttons.map((b) => b.title)).toEqual(['🔍 Free scan', '🙋 Talk to a person', '🗑️ Delete my data']);
    expect(c.buttons[0]).toMatchObject({ type: 'web_url', url: 'https://www.myprivacytool.io/scan?utm_source=facebook&utm_medium=messenger&utm_campaign=messenger-welcome' });
  });

  it('"Talk to a person" sends the approved line once, flags a handoff, and later messages get no automatic reply', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello')); await post('/webhook/messenger', tap('u1', PAYLOAD.yes));
    sends.length = 0; hooks.length = 0;
    const env = { ...ENV, HANDOFF_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' };
    await post('/webhook/messenger', tap('u1', PAYLOAD.person), env);
    expect(messages()).toEqual([{ text: 'Thanks 🙌 A person will reply within 1 business day.' }]);
    expect(hooks).toHaveLength(1); expect(hooks[0].text).toMatch(/messenger \(ref [0-9a-f]{8}\)/);
    expect(JSON.stringify(hooks)).not.toMatch(/u1|hello/);                   // no id, no message text sent to Slack
    sends.length = 0;
    await post('/webhook/messenger', msgr('u1', 'a question'), env); await post('/webhook/messenger', msgr('u1', 'another'), env);
    expect(sends).toHaveLength(0); expect(hooks).toHaveLength(1);
  });

  it('"Delete my data" and typed STOP delete the saved conversation and send the approved line; the next message starts fresh', async () => {
    for (const how of ['button', 'text']) {
      store.clear(); sends.length = 0;
      await post('/webhook/messenger', msgr('u1', 'hello')); await post('/webhook/messenger', tap('u1', PAYLOAD.yes)); sends.length = 0;
      await post('/webhook/messenger', how === 'button' ? tap('u1', PAYLOAD.del) : msgr('u1', ' stop '));
      expect(store.has('messenger:u1')).toBe(false);
      expect(messages()).toEqual([{ text: 'Done ✅ Deleted. Anything else: privacy@myprivacytool.io' }]);
      sends.length = 0; await post('/webhook/messenger', msgr('u1', 'hi again'));
      expect(card(messages()[0]).title).toContain('automated assistant');
    }
  });

  it('"No thanks" sends the approved line and then nothing more, until the person taps Get Started again', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello')); sends.length = 0;
    await post('/webhook/messenger', tap('u1', PAYLOAD.no));
    expect(messages()).toEqual([{ text: "No problem 👍 We won't message you again." }]);
    sends.length = 0; await post('/webhook/messenger', msgr('u1', 'hello?')); expect(sends).toHaveLength(0);
    await post('/webhook/messenger', tap('u1', PAYLOAD.start)); expect(card(messages()[0]).title).toContain('automated assistant');
  });

  it('before the person agrees, typing or tapping a menu button does nothing but repeat the consent card, at most 3 times in all', async () => {
    await post('/webhook/messenger', msgr('u1', 'hello')); sends.length = 0;
    await post('/webhook/messenger', tap('u1', PAYLOAD.person)); await post('/webhook/messenger', msgr('u1', 'scan me'));
    expect(messages().every((m) => card(m).title.includes('automated assistant'))).toBe(true);
    expect(hooks).toHaveLength(0);
    sends.length = 0; await post('/webhook/messenger', msgr('u1', 'again')); expect(sends).toHaveLength(0);
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

  it('first message: one interactive consent message with an image header and two reply buttons; button taps drive the rest', async () => {
    await post('/webhook/whatsapp', wa('85200000000', 'hello'));
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toBe('https://graph.facebook.com/v23.0/999/messages');
    const b = sends[0].body;
    expect(b).toMatchObject({ messaging_product: 'whatsapp', to: '85200000000', type: 'interactive' });
    expect(b.interactive.header.image.link).toBe('https://www.myprivacytool.io/og-image.jpg');
    expect(b.interactive.body.text).toContain('automated assistant'); expect(b.interactive.body.text).toContain('https://www.myprivacytool.io/privacy');
    expect(b.interactive.action.buttons.map((x) => x.reply.id)).toEqual(['CONSENT_YES', 'CONSENT_NO']);
    expect(hubspot).toBe(0);
    sends.length = 0; await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.yes));
    expect(sends[0].body.interactive.action.buttons.map((x) => x.reply.title)).toEqual(['🔍 Free scan', '🙋 Talk to a person', '🗑️ Delete my data']);
    sends.length = 0; await post('/webhook/whatsapp', waTap('85200000000', PAYLOAD.scan));
    expect(sends[0].body).toMatchObject({ type: 'text', text: { preview_url: true } }); expect(sends[0].body.text.body).toContain('utm_medium=whatsapp');
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
    expect(TEXT.person).toBe('Thanks 🙌 A person will reply within 1 business day.'); expect(TEXT.declined).toBe("No problem 👍 We won't message you again.");
  });
  it('decide: nothing happens for buttons before consent; STOP always deletes', () => {
    expect(decide({ payload: PAYLOAD.person, state: { stage: 'asked', askedCount: 1 } }).handoff).toBe(false);
    expect(decide({ text: 'DELETE', state: { stage: 'consented' } }).next).toBe('delete');
    expect(decide({ payload: PAYLOAD.scan, state: { stage: 'human_requested' } }).steps[0].kind).toBe('scanlink');
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
