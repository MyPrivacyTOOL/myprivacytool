/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { buildTemplatePayload, sendTemplate, validateNotify, NotifyInputError } from './whatsappNotify';

const input = { wa_id: '85212345678', verified_exposure_count: 3, web_dashboard_url: 'https://myprivacytool.io/scan/dive?id=abc', display_name: 'Alex' };
const env = { WHATSAPP_PHONE_NUMBER_ID: '999', META_WHATSAPP_KEY: 'tok' };

describe('whatsappNotify', () => {
  it('formats the template payload with {{1}} name, {{2}} count, {{3}} url', () => {
    expect(buildTemplatePayload(input)).toEqual({
      messaging_product: 'whatsapp', to: '85212345678', type: 'template',
      template: { name: 'mpt_deep_dive_ready', language: { code: 'en' }, components: [{ type: 'body', parameters: [
        { type: 'text', text: 'Alex' }, { type: 'text', text: '3' }, { type: 'text', text: 'https://myprivacytool.io/scan/dive?id=abc' }] }] },
    });
  });
  it('supports zh_HK, falls back to "there", strips newlines from the name', () => {
    const p: any = buildTemplatePayload({ ...input, language: 'zh_HK', display_name: 'A\nB     C' });
    expect(p.template.language.code).toBe('zh_HK');
    expect(p.template.components[0].parameters[0].text).toBe('A B C');
    expect((buildTemplatePayload({ ...input, display_name: '' }) as any).template.components[0].parameters[0].text).toBe('there');
  });
  it.each([
    [{ wa_id: '+8521' }], [{ verified_exposure_count: -1 }], [{ verified_exposure_count: 1.5 }],
    [{ web_dashboard_url: 'https://evil.example/x' }], [{ web_dashboard_url: 'http://myprivacytool.io/x' }],
    [{ web_dashboard_url: 'https://myprivacytool.io@evil.example/x' }], [{ language: 'fr' }],
  ])('rejects bad input %j', (bad) => { expect(() => validateNotify({ ...input, ...bad })).toThrow(NotifyInputError); });

  it('posts to the Graph API with a bearer header and returns messages[0].id', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));
    const r = await sendTemplate(env, input, f as any);
    expect(r).toEqual({ ok: true, message_id: 'wamid.X', http_status: 200, error: null });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://graph.facebook.com/v21.0/999/messages');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(url).not.toContain('tok');
  });
  it('reports a Meta error and a network failure without throwing or leaking the token', async () => {
    const e = await sendTemplate(env, input, (async () => new Response(JSON.stringify({ error: { code: 132001, message: 'Template does not exist' } }), { status: 404 })) as any);
    expect(e).toMatchObject({ ok: false, message_id: null, http_status: 404 }); expect(e.error).toContain('132001');
    const n = await sendTemplate(env, input, (async () => { throw new Error('tok boom'); }) as any);
    expect(n).toMatchObject({ ok: false, error: 'network_error' });
  });
  it('a 200 with no message id is not a success', async () => {
    expect((await sendTemplate(env, input, (async () => new Response('{}', { status: 200 })) as any)).ok).toBe(false);
  });
  it('is a no-op error when WhatsApp is not configured', async () => {
    const f = vi.fn();
    expect((await sendTemplate({}, input, f as any)).error).toBe('whatsapp_not_configured'); expect(f).not.toHaveBeenCalled();
  });
});
