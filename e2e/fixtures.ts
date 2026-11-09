import { test as base, expect, type Page, type Request } from "@playwright/test";

// MPC-7300: hermetic network. Every request that leaves localhost is either recorded + fulfilled with a
// canned response (the three backends we care about) or aborted (analytics, fonts CDNs, anything else).
export interface Captured {
  hubspot: { url: string; body: { fields: { name: string; value: string }[]; context: Record<string, string> } }[];
  supabase: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
  leads: { url: string; body: Record<string, unknown> }[];
}
// MPC-9888: the scan consent endpoint (POST/GET /api/consent) and the consent store rows the real Worker code reads while handling /api/scan.
export const E2E_CONSENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const E2E_CONSENT_VERSION = "2026-11-v1";   // keep equal to shared/recipients/consent-config.ts
const consentRow = (scanId = "11111111-1111-4111-8111-111111111111") => ({ id: E2E_CONSENT_ID, scan_id: scanId, consent_version: E2E_CONSENT_VERSION, consent_text_sha256: "0".repeat(64), locale: "en", registry_hash: "0".repeat(64), n_hours: 168, consented_at: "2026-11-08T00:00:00.000Z" });
/** For the in-process fake Supabase backends: answers a select on scan_consents, or null when the URL is something else. */
export function e2eConsentRows(url: string) {
  if (!/rest\/v1\/scan_consents/.test(url)) return null;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([consentRow()]), json: async () => [consentRow()] };
}
export interface Mocks { hubspotStatus: number; supabaseStatus: number; leadsStatus: number }

// `net` is an auto fixture: every test is hermetic even when it does not ask for it (else it would hit the real internet).
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const parse = (r: Request) => { try { return r.postDataJSON(); } catch { return {}; } };

export const test = base.extend<{ net: { captured: Captured; mocks: Mocks } }>({
  net: [async ({ page }, provide) => {
    const captured: Captured = { hubspot: [], supabase: [], leads: [] };
    const mocks: Mocks = { hubspotStatus: 200, supabaseStatus: 201, leadsStatus: 200 };
    // MPC-8450: our own cookie banner sits at the bottom of the page and can cover buttons. Start every test as a visitor who already chose
    // "Essential only", so it never shows (and no analytics script is requested).
    await page.addInitScript(() => {
      try { window.localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: false, at: "2026-01-01T00:00:00.000Z" })); } catch { /* ignore */ }
    });
    // MPC-9888: tests of the post-scan flows start as a visitor who already pressed Scan me. e2e/consent-block.spec.ts clears this to test the cold arrival.
    await page.addInitScript(([id, ver]) => {
      try { if (!window.sessionStorage.getItem("mpt_scan_consent") && !window.location.search.includes("cold")) window.sessionStorage.setItem("mpt_scan_consent", JSON.stringify({ scanId: "11111111-1111-4111-8111-111111111111", consentId: id, version: ver, at: "2026-11-08T00:00:00.000Z" })); } catch { /* ignore */ }
    }, [E2E_CONSENT_ID, E2E_CONSENT_VERSION]);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
      const req = route.request();
      const url = req.url();
      const preflight = req.method() === "OPTIONS";
      if (preflight) return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      if (/\/api\/consent(\?|$)/.test(url)) {
        const body = parse(req) as { scan_id?: string };
        return route.fulfill(json({ consent_id: E2E_CONSENT_ID, scan_id: body.scan_id ?? consentRow().scan_id, consent_version: E2E_CONSENT_VERSION, n_hours: 168, consented_at: consentRow().consented_at, created: true }, req.method() === "POST" ? 201 : 200));
      }
      if (url.startsWith("https://api.hsforms.com/")) {
        captured.hubspot.push({ url, body: parse(req) });
        return route.fulfill(mocks.hubspotStatus === 200 ? json({ inlineMessage: "ok" }) : json({ message: "HubSpot rejected the submission" }, mocks.hubspotStatus));
      }
      if (url.includes(".supabase.co/rest/v1/subscribers")) {
        captured.supabase.push({ url, headers: req.headers(), body: parse(req) });
        return route.fulfill(json(mocks.supabaseStatus === 409 ? { code: "23505" } : {}, mocks.supabaseStatus));
      }
      if (url.includes("mpt-leads")) {
        captured.leads.push({ url, body: parse(req) });
        return route.fulfill(json({ success: true }, mocks.leadsStatus));
      }
      return route.abort(); // analytics, fonts, everything else
    });
    await provide({ captured, mocks });
  }, { auto: true }],
});

export { expect };
export const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};
