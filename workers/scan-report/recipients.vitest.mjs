// @vitest-environment node
// MPC-9885: a full submit + report run through the recipient wrapper. Every call must reach a registered recipient, the set of recipients reached is pinned,
// and the one batched scan_recipient_log insert per scan carries item NAMES only, never a value.
import { describe, it, expect } from 'vitest';
import { handleScan, runReportJob } from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { createFetchSpy } from '../../shared/recipients/fetch-spy';

const EMAIL = 'quiet.person@example.org';
const env = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', RESEND_API_KEY: 'resend-key', HUBSPOT_TOKEN: 'hs-token',
  EMAIL_DOMAIN_CHECK: 'false', EMAIL_GITHUB_COMMITS_ENABLED: 'true', EMAIL_EXTRAS_ENABLED: 'true', ALLOW_PARTIAL_REPORT: 'true',
};
const input = { email: EMAIL, consentSource: 'scan_page', ip: '203.0.113.9', utm: { source: 'ads', medium: '', campaign: '', content: '', referrer: '' } };

describe('scan-report recipients', () => {
  it('submit + report: every call is registered, the recipients reached are the expected set, the log holds names only', async () => {
    const F = fake();
    const spy = createFetchSpy({ respond: (url, init) => F.f(url, init) });
    await handleScan(env, null, input, spy.fetch);
    const out = await runReportJob(env, spy.fetch, 5);
    expect(out.sent).toBe(1);

    spy.assertAllRegistered();
    const reached = new Set(spy.calls.map((c) => c.recipient));
    // the spy names a host's FIRST registry owner (a shared host such as *.supabase.co or api.github.com), so the exact keys are pinned from the wrapper's log below
    for (const k of ['hubspot', 'resend', 'cloudflare-doh', 'gravatar', 'rdap']) expect(reached.has(k)).toBe(true);
    expect(reached.has('hibp')).toBe(false);   // switched off, and no key: never contacted
    expect([...reached].every((k) => k !== null)).toBe(true);

    // one batched INSERT per scan (the submit, then the report job)
    const logPosts = F.calls.filter((c) => c.url.includes('/rest/v1/scan_recipient_log'));
    expect(logPosts.length).toBe(2);
    const rows = logPosts.flatMap((c) => JSON.parse(c.body));
    const loggedKeys = new Set(rows.map((r) => r.recipient_key));
    expect([...loggedKeys].sort()).toEqual(['cloudflare-doh', 'github-commit-search', 'gravatar', 'hubspot', 'rdap', 'resend', 'supabase']);
    const scanIds = new Set(rows.map((r) => r.scan_id));
    expect(scanIds.size).toBe(1);
    expect([...scanIds][0]).toBe(F.db.scans[0].id);
    for (const r of rows) {
      expect(Array.isArray(r.items)).toBe(true);
      expect(Object.keys(r).sort()).toEqual(['at', 'code', 'http_status', 'items', 'recipient_key', 'scan_id', 'status']);
    }
    const resendRows = rows.filter((r) => r.recipient_key === 'resend');
    expect(resendRows.some((r) => r.items.includes('email'))).toBe(true);
    // no value anywhere in what was logged: not the address, its local part, its domain, the IP, the keys
    const logged = logPosts.map((c) => c.body).join('\n');
    for (const secret of [EMAIL, 'quiet.person', 'example.org', '203.0.113.9', 'svc-key', 'resend-key', 'hs-token']) expect(logged.includes(secret)).toBe(false);
  });

  it('a log write that fails changes nothing about the scan', async () => {
    const F = fake({ onRequest: (url, o, res) => (url.includes('scan_recipient_log') ? res(500, 'x') : undefined) });
    const spy = createFetchSpy({ respond: (url, init) => F.f(url, init) });
    await handleScan(env, null, input, spy.fetch);
    const out = await runReportJob(env, spy.fetch, 5);
    expect(out.sent).toBe(1);
    expect(F.db.scans[0].report_status).toBe('sent');
  });
});
