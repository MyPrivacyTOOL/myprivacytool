// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { verifyUploaded, reasonsFrom } from './verifyReport';
import { handleDownload, handleVerify, type SignedReportEnv } from '../../shared/signed-report/handlers';

const seed = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const env: SignedReportEnv = { REPORT_SIGNING_ENABLED: '1', REPORT_SIGNING_KEY: seed };
const post = (b: unknown) => new Request('https://x.test/', { method: 'POST', body: JSON.stringify(b) });
const open = { level2Passed: async () => true, now: new Date('2026-10-26T00:00:00Z') };

// Routes the page's fetch to the real server handler, so these tests exercise the real sign -> verify round trip.
const fetchVia = (keys: string): typeof fetch => (async (_u: string, init: RequestInit) =>
  handleVerify(new Request('https://x.test/api/verify-report', { method: 'POST', body: String(init.body) }), { REPORT_SIGNING_PUBLIC_KEYS: keys })) as unknown as typeof fetch;

const file = (name: string, content: string | Uint8Array) => new File([content], name);

async function signedJson() {
  const res = await handleDownload(post({ report: { report_id: 'r1', score: 90 } }), env, open);
  return await res.json();
}
async function signedPdf() {
  const pdf = new TextEncoder().encode('%PDF-1.4 hello');
  const res = await handleDownload(post({ pdf_base64: btoa(String.fromCharCode(...pdf)) }), env, open);
  const { signature } = await res.json();
  return { pdf, sigFile: { file: 'r.pdf', signature } };
}

describe('verifyUploaded', () => {
  it('verifies a genuine signed JSON file', async () => {
    const s = await signedJson();
    const v = await verifyUploaded([file('r.signed.json', JSON.stringify(s))], fetchVia(s.signature.public_key));
    expect(v).toMatchObject({ kind: 'verified', signedAt: '2026-10-26T00:00:00.000Z' });
  });
  it('rejects a changed report and says why', async () => {
    const s = await signedJson();
    s.report.score = 100;
    const v = await verifyUploaded([file('r.signed.json', JSON.stringify(s))], fetchVia(s.signature.public_key));
    expect(v.kind).toBe('not_verified');
    if (v.kind === 'not_verified') expect(v.reasons[0]).toMatch(/does not match/);
  });
  it('does not bless a valid signature from an unpublished key', async () => {
    const s = await signedJson();
    const v = await verifyUploaded([file('r.signed.json', JSON.stringify(s))], fetchVia('some-other-key'));
    expect(v.kind).toBe('not_verified');
    if (v.kind === 'not_verified') expect(v.reasons.join(' ')).toMatch(/not made with a key MyPrivacyTOOL has published/);
  });
  it('verifies a PDF with its signature file, and rejects an edited PDF', async () => {
    const { pdf, sigFile } = await signedPdf();
    const keys = sigFile.signature.public_key;
    const ok = await verifyUploaded([file('r.pdf', pdf), file('r.pdf.sig.json', JSON.stringify(sigFile))], fetchVia(keys));
    expect(ok.kind).toBe('verified');
    const bad = await verifyUploaded([file('r.pdf', new TextEncoder().encode('%PDF-1.4 edited')), file('r.pdf.sig.json', JSON.stringify(sigFile))], fetchVia(keys));
    expect(bad.kind).toBe('not_verified');
    if (bad.kind === 'not_verified') expect(bad.reasons.join(' ')).toMatch(/not the one the signature was made for/);
  });
  it('asks for what is missing instead of guessing', async () => {
    const { pdf, sigFile } = await signedPdf();
    const f = fetchVia('k');
    expect((await verifyUploaded([], f)).kind).toBe('need_more');
    expect((await verifyUploaded([file('r.pdf', pdf)], f)).kind).toBe('need_more');
    expect((await verifyUploaded([file('r.pdf.sig.json', JSON.stringify(sigFile))], f)).kind).toBe('need_more');
  });
  it('handles junk, oversize files and an unreachable checker without leaking details', async () => {
    const f = fetchVia('k');
    expect((await verifyUploaded([file('x.json', 'not json')], f)).kind).toBe('error');
    expect((await verifyUploaded([file('x.json', '{"hello":1}')], f)).kind).toBe('error');
    expect((await verifyUploaded([file('x.json', 'a'.repeat(950_000))], f)).kind).toBe('error');
    const s = await signedJson();
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const v = await verifyUploaded([file('r.signed.json', JSON.stringify(s))], down);
    expect(v).toEqual({ kind: 'error', message: 'We could not reach the checker. Try again in a moment.' });
    const five = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    expect((await verifyUploaded([file('r.signed.json', JSON.stringify(s))], five)).kind).toBe('error');
  });
  it('always gives at least one reason for a refusal', () => {
    expect(reasonsFrom({}).length).toBe(1);
  });
});
