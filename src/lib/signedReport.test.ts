import { describe, it, expect } from 'vitest';
import { requestSignedJson, requestPdfSignature, bytesToBase64, signedReportMessage, SignedReportError } from './signedReport';

const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const signed = { report: { a: 1 }, signature: { value: 'v', public_key: 'k', signed_at: 't', issuer: 'MyPrivacyTOOL' } };

describe('signed report client', () => {
  it('posts the report and returns the signed file', async () => {
    let seen: { url: string; body: string } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, body: String(init.body) }; return new Response(JSON.stringify(signed)); }) as unknown as typeof fetch;
    expect(await requestSignedJson({ a: 1 }, f)).toEqual(signed);
    expect(seen?.url).toBe('/api/report-download');
    expect(JSON.parse(seen!.body)).toEqual({ report: { a: 1 } });
  });
  it('sends a PDF as base64 and returns the detached signature', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ signature: { sha256: 'h', value: 'v', public_key: 'k', signed_at: 't', issuer: 'x' } })); }) as unknown as typeof fetch;
    const sig = await requestPdfSignature(Uint8Array.from([37, 80, 68, 70]), f);
    expect(sig.sha256).toBe('h');
    expect(JSON.parse(body)).toEqual({ pdf_base64: 'JVBERg==' });
  });
  it('maps server answers to plain codes, never leaking the server text', async () => {
    const code = async (f: typeof fetch) => { try { await requestSignedJson({}, f); return 'none'; } catch (e) { return (e as SignedReportError).code; } };
    expect(await code(reply(403, { error: 'level2_required' }))).toBe('level2_required');
    expect(await code(reply(503, { error: 'signing_unavailable' }))).toBe('unavailable');
    expect(await code(reply(413))).toBe('too_large');
    expect(await code(reply(500))).toBe('failed');
    expect(await code((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('unavailable');
    expect(await code(reply(200, { nope: 1 }))).toBe('failed');
    for (const c of ['level2_required', 'unavailable', 'too_large', 'failed'] as const) expect(signedReportMessage(c)).not.toMatch(/\d{3}|error|503|403/i);
  });
  it('encodes a large buffer without overflowing the stack', () => {
    const big = new Uint8Array(500_000).fill(65);
    expect(atob(bytesToBase64(big)).length).toBe(500_000);
  });
});
