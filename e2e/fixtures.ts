import { test as base, expect, type Page, type Request } from "@playwright/test";

// MPC-7300: hermetic network. Every request that leaves localhost is either recorded + fulfilled with a
// canned response (the three backends we care about) or aborted (analytics, fonts CDNs, anything else).
export interface Captured {
  hubspot: { url: string; body: { fields: { name: string; value: string }[]; context: Record<string, string> } }[];
  supabase: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
  leads: { url: string; body: Record<string, unknown> }[];
}
export interface Mocks { hubspotStatus: number; supabaseStatus: number; leadsStatus: number }

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const parse = (r: Request) => { try { return r.postDataJSON(); } catch { return {}; } };

export const test = base.extend<{ net: { captured: Captured; mocks: Mocks } }>({
  net: async ({ page }, provide) => {
    const captured: Captured = { hubspot: [], supabase: [], leads: [] };
    const mocks: Mocks = { hubspotStatus: 200, supabaseStatus: 201, leadsStatus: 200 };
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
      const req = route.request();
      const url = req.url();
      const preflight = req.method() === "OPTIONS";
      if (preflight) return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
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
  },
});

export { expect };
export const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};
