// CK-8503 (G7): a refused or failed channel send is now visible (status only) instead of silent. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendJson } from './send.js';

afterEach(() => vi.restoreAllMocks());
const SECRET_URL = 'https://api.telegram.org/botSECRET-TOKEN-123/sendMessage';

describe('sendJson', () => {
  it('posts JSON and reports ok on a 2xx', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendJson('whatsapp', 'https://x/y', { A: 'b' }, { hello: 'world' }, f)).toEqual({ ok: true, status: 200 });
    expect(f).toHaveBeenCalledWith('https://x/y', { method: 'POST', headers: { A: 'b' }, body: '{"hello":"world"}' });
  });

  it('a refused send is reported as not ok and logged by channel and status only', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await sendJson('telegram', SECRET_URL, {}, { chat_id: '42', text: 'private findings' }, async () => ({ ok: false, status: 403 }));
    expect(r).toEqual({ ok: false, status: 403 });
    const logged = err.mock.calls.flat().join(' ');
    expect(logged).toBe('send_failed channel=telegram status=403');
    expect(logged).not.toMatch(/SECRET-TOKEN|private findings|42/);
  });

  it('a network error is reported as not ok, does not throw, and logs no URL or message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await sendJson('messenger', SECRET_URL, {}, { text: 'private findings' }, async () => { throw Object.assign(new Error('boom SECRET-TOKEN-123'), { name: 'TypeError' }); });
    expect(r).toEqual({ ok: false, status: 0 });
    const logged = err.mock.calls.flat().join(' ');
    expect(logged).toBe('send_failed channel=messenger error=TypeError');
    expect(logged).not.toMatch(/SECRET-TOKEN|private findings/);
  });
});
