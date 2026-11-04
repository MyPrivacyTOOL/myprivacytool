// MPC-7535: a /scan submission must be ACCEPTED BY THE WORKER, not just thank the visitor. The production build is driven in a real browser;
// its POST /api/scan is handed to the real Worker code (workers/scan-report/index.js) running in this test process with an in-memory
// Supabase/Resend/HubSpot behind it, from the production origin. The test fails if the build sends nothing (e.g. a blank API URL), if the
// Worker refuses what the build sends (400/403/413/429/500), or if the thank-you screen appears without a report request existing.
import { test, expect } from "./fixtures";
import worker from "../workers/scan-report/index.js";

const EMAIL = "e2e-scan-report+mpc7535@example.com";
const ORIGIN = "https://myprivacytool.io";   // the Worker only accepts the production origins; the preview server's own origin would be refused

type Row = Record<string, unknown>;
function fakeBackends() {
  const tables: Record<string, Row[]> = { users: [], leads: [], scans: [], email_suppressions: [], web_scans: [], web_scan_contacts: [], web_scan_events: [], web_scan_returns: [] };
  let n = 0;
  const res = (status: number, body?: unknown) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body });
  const fetchImpl = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const rpc = url.match(/rest\/v1\/rpc\/(\w+)/);
    if (rpc) {   // CK-8503: the Worker asks the database to create the report request atomically (public.mpt_request_scan); same rules as the SQL function
      if (rpc[1] !== "mpt_request_scan") return res(404, { code: "PGRST202" });   // any other function: like PostgREST, "not found"
      const a = JSON.parse(String(init.body)) as { p_user_id: string; p_email: string; p_request_id?: string | null };
      const since = Date.now() - 24 * 3600 * 1000;
      const hit = (tables.scans ?? []).find((r) => r.user_id === a.p_user_id && Date.parse(String(r.created_at)) >= since);
      if (hit) return res(200, [{ scan_id: hit.id, duplicate: true, request_id: hit.request_id ?? null }]);
      const row: Row = { id: `id${++n}`, created_at: new Date().toISOString(), user_id: a.p_user_id, email_scanned: a.p_email, source: "web_scan", report_status: "pending", report_attempts: 0, ...(a.p_request_id ? { request_id: a.p_request_id } : {}) };
      tables.scans.push(row);
      return res(200, [{ scan_id: row.id, duplicate: false, request_id: a.p_request_id ?? null }]);
    }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/);
    if (!m) return res(200, {});   // Resend, HubSpot, DNS, Gravatar...
    const [, table, qs] = m;
    const q = new URLSearchParams(qs ?? "");
    const rows = (tables[table] ??= []);
    if (init.method === "POST") {
      const added = ([] as Row[]).concat(JSON.parse(String(init.body))).map((r) => ({ id: `id${++n}`, created_at: new Date().toISOString(), ...r }));
      rows.push(...added);
      return res(201, added);
    }
    if (init.method === "PATCH") return res(200, rows);
    let found = rows;
    const email = q.get("email")?.replace(/^eq\./, "");
    if (email) found = found.filter((r) => r.email === decodeURIComponent(email));
    const userId = q.get("user_id")?.replace(/^eq\./, "");
    if (userId) found = found.filter((r) => r.user_id === userId);
    return res(200, found);
  };
  return { tables, fetchImpl };
}

test.describe("/scan report request reaches the Worker", () => {
  async function wireWorker(page: import("@playwright/test").Page, opts: { failFirst?: number } = {}) {
    const be = fakeBackends();
    const seen: { status: number; body: unknown }[] = [];
    let calls = 0;
    await page.route(/mpt-scan-report\.[^/]+\/api\/scan$/, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      calls += 1;
      if (calls <= (opts.failFirst ?? 0)) {
        seen.push({ status: 429, body: { error: "Too many requests" } });
        return route.fulfill({ status: 429, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "Too many requests" }) });
      }
      const realFetch = globalThis.fetch;
      const pending: Promise<unknown>[] = [];
      globalThis.fetch = be.fetchImpl as unknown as typeof fetch;
      try {
        const workerReq = new Request("https://mpt-scan-report.example.workers.dev/api/scan", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: req.postData() ?? "" });
        const env = { SUPABASE_URL: "https://stub.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "stub", RESEND_API_KEY: "stub", RECIPIENT_ALLOWLIST: "" };
        const out = await worker.fetch(workerReq, env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
        await Promise.all(pending);
        const text = await out.text();
        seen.push({ status: out.status, body: text ? JSON.parse(text) : null });
        return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: text });
      } finally {
        globalThis.fetch = realFetch;
      }
    });
    return { be, seen };
  }

  async function submit(page: import("@playwright/test").Page) {
    await page.goto("/scan");
    await page.getByLabel("Email address").first().fill(EMAIL);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /check my exposure/i }).first().click();
  }

  test("the build's request is accepted (200) and creates the user, lead and report request", async ({ page, net }) => {
    const { be, seen } = await wireWorker(page);
    await submit(page);
    await expect(page.getByRole("status")).toContainText(/we have your email/i);
    expect(seen).toHaveLength(1);                                   // the build DID send a report request
    expect(seen[0].status).toBe(200);                               // and the Worker accepted it
    expect(seen[0].body).toMatchObject({ success: true });
    expect(be.tables.users).toHaveLength(1);
    expect(be.tables.leads).toHaveLength(1);
    expect(be.tables.scans).toHaveLength(1);                        // the report request itself
    expect(net.captured.hubspot).toHaveLength(1);
  });

  test("a refused request shows an honest message, keeps the email, and a retry then succeeds", async ({ page, net }) => {
    const { be, seen } = await wireWorker(page, { failFirst: 1 });
    await submit(page);
    await expect(page.getByRole("alert")).toContainText(/wait a minute/i);
    await expect(page.getByRole("status")).toHaveCount(0);          // no thank-you screen promising a report
    await expect(page.getByLabel("Email address").first()).toHaveValue(EMAIL);
    expect(be.tables.scans).toHaveLength(0);
    await page.getByRole("button", { name: /check my exposure/i }).first().click();
    await expect(page.getByRole("status")).toContainText(/we have your email/i);
    expect(seen.map((s) => s.status)).toEqual([429, 200]);
    expect(be.tables.scans).toHaveLength(1);
    expect(net.captured.hubspot).toHaveLength(1);                   // the lead went once, not twice
  });
});
