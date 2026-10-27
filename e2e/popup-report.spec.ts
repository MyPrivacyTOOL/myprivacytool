// MPC-7471-F3: the post-scan popup uses the report pipeline. The production build (built with VITE_SAVE_WEB_SCANS=true) is driven through a real finished
// scan; its POST /api/scan goes to the REAL Worker code (workers/scan-report/index.js) running in this test process with an in-memory Supabase/Resend/HubSpot
// behind it. Nothing leaves the machine: every outbound URL the Worker calls is answered here, and the test fails if it calls an unexpected host.
// Synthetic users only (example.com). The assertions read the PERSISTED rows and the captured email bodies, not what the page says.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import worker from "../workers/scan-report/index.js";

const ORIGIN = "https://myprivacytool.io";   // the Worker only accepts the production origins
const SCAN_NUMBER_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const KNOWN_HOSTS = ["stub.supabase.test", "api.resend.com", "api.hubapi.com", "cloudflare-dns.com", "haveibeenpwned.com", "gravatar.com", "libravatar.org", "rdap.org"];

type Row = Record<string, unknown>;
function backends() {
  const tables: Record<string, Row[]> = { users: [], leads: [], scans: [], signals: [], hexagon_scores: [], email_suppressions: [], web_scans: [], web_scan_contacts: [], web_scan_events: [], web_scan_returns: [] };
  const mails: { to: string[]; subject: string; text: string; html: string }[] = [];
  const stray: string[] = [];
  let n = 0;
  const res = (status: number, body?: unknown) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body });
  const fetchImpl = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const host = new URL(url).host;
    if (!KNOWN_HOSTS.some((h) => host.endsWith(h))) { stray.push(host); return res(500, "blocked"); }
    if (host === "api.resend.com") { mails.push(JSON.parse(String(init.body))); return res(200, { id: `msg_${++n}` }); }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/);
    if (!m) return res(200, host.includes("cloudflare-dns") ? { Status: 0, Answer: [] } : {});
    const [, table, qs] = m;
    const q = new URLSearchParams(qs ?? "");
    const rows = (tables[table] ??= []);
    if (init.method === "POST") {
      const added = ([] as Row[]).concat(JSON.parse(String(init.body))).map((r) => ({ id: table === "scans" || table === "web_scans" ? crypto.randomUUID() : `id${++n}`, created_at: new Date().toISOString(), ...r }));
      const x = added[0];
      if (table === "scans" && x.request_id && rows.some((r) => r.request_id === x.request_id)) return res(409, { code: "23505" });
      if (table === "users" && rows.some((r) => r.email === x.email)) return res(409, "dup");
      if (table === "leads" && rows.some((r) => r.email === x.email)) return res(409, "dup");
      if (table === "web_scan_contacts" && !tables.web_scans.some((w) => w.id === x.web_scan_id)) return res(409, { code: "23503" });
      if (table === "web_scan_events" && rows.some((r) => r.web_scan_id === x.web_scan_id && r.step === x.step)) return res(409, { code: "23505" });
      rows.push(...added);
      return res(201, added);
    }
    if (init.method === "PATCH") return res(200, rows);
    if (init.method === "DELETE") return res(204);
    let found = rows;
    const eq = (k: string) => q.get(k)?.replace(/^eq\./, "");
    if (eq("email")) found = found.filter((r) => r.email === decodeURIComponent(eq("email")!));
    if (eq("user_id")) found = found.filter((r) => r.user_id === eq("user_id"));
    if (eq("request_id")) found = found.filter((r) => r.request_id === eq("request_id"));
    if (eq("contact_id")) found = found.filter((r) => r.contact_id === decodeURIComponent(eq("contact_id")!));
    if (eq("id")) found = found.filter((r) => r.id === eq("id"));
    return res(200, found);
  };
  return { tables, mails, stray, fetchImpl };
}

async function wireWorker(page: Page, opts: { loseFirstAnswer?: boolean; refuseFirst?: number } = {}) {
  const be = backends();
  const seen: { status: number; body: Record<string, unknown> | null; sent: Record<string, unknown> }[] = [];
  let calls = 0;
  await page.route(/mpt-scan-report\.[^/]+\/api\/scan$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    calls += 1;
    if (calls <= (opts.refuseFirst ?? 0)) return route.fulfill({ status: 429, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "Too many requests" }) });
    const realFetch = globalThis.fetch;
    const pending: Promise<unknown>[] = [];
    globalThis.fetch = be.fetchImpl as unknown as typeof fetch;
    try {
      const workerReq = new Request("https://mpt-scan-report.example.workers.dev/api/scan", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: req.postData() ?? "" });
      const env = { SUPABASE_URL: "https://stub.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "stub", RESEND_API_KEY: "stub", HUBSPOT_TOKEN: "stub", UNSUBSCRIBE_SECRET: "stub-secret", WEB_SCAN_SAVE_ENABLED: "true", REPORT_REQUEST_ID_ENABLED: "true", RECIPIENT_ALLOWLIST: "", EMAIL_DOMAIN_CHECK: "false" };
      const out = await worker.fetch(workerReq, env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
      await Promise.all(pending);
      const text = await out.text();
      seen.push({ status: out.status, body: text ? JSON.parse(text) : null, sent: JSON.parse(req.postData() ?? "{}") });
      if (opts.loseFirstAnswer && calls === 1) return route.abort("timedout");   // the Worker DID save; the visitor never hears
      return route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: text });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  return { be, seen };
}

// Finishes a real scan on the home page (same loop as ga4-scan-completed.spec.ts) and waits for the popup.
async function finishScan(page: Page) {
  await page.goto("/?view=grid");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  for (let i = 0; i < 400; i++) {
    const [done, total] = ((await counter.textContent()) ?? "0/0").split("/").map(Number);
    if (done >= total && total >= 46) break;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300);
  }
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible({ timeout: 30_000 });
}

const fill = async (page: Page, email: string, { save }: { save: boolean }) => {
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByLabel(/email me my results and occasional privacy tips/i).check();
  const saveBox = page.getByLabel(/save my scan result with my email/i);
  await expect(saveBox).not.toBeChecked();                     // unticked by default
  if (save) await saveBox.check();
};

test.describe("post-scan popup -> report pipeline (stubbed API, real Worker code)", () => {
  test.skip(({ isMobile }) => isMobile, "slow full-scan flow; desktop project is enough");
  test.setTimeout(180_000);

  test("save ticked: one saved scan, linked to the contact, one report request; the SAME scan number in the popup and the first email", async ({ page }, info) => {
    const { be, seen } = await wireWorker(page);
    const email = "e2e-popup-f3+save@example.com";
    await finishScan(page);
    await page.screenshot({ path: info.outputPath("1-popup-before-submit.png") });
    await fill(page, email, { save: true });
    await page.getByRole("button", { name: /send my report/i }).click();
    await expect(page.getByText("Your report is on its way.")).toBeVisible();
    const shown = (await page.getByTestId("scan-number").first().textContent())?.trim() ?? "";
    await page.screenshot({ path: info.outputPath("2-popup-saved-confirmation.png") });

    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe(200);
    expect(seen[0].sent).toMatchObject({ consent: true, consent_source: "web_scan_summary", save_consent: true });
    const t = be.tables;
    expect([t.users.length, t.leads.length, t.scans.length, t.web_scans.length, t.web_scan_contacts.length]).toEqual([1, 1, 1, 1, 1]);
    expect(t.web_scan_contacts[0]).toMatchObject({ channel: "email", contact_id: t.scans[0].id, web_scan_id: t.web_scans[0].id });
    expect(t.web_scan_contacts[0].save_consent_version).toBe("2026-10-12-v1");
    expect(t.scans[0].request_id).toBe(seen[0].sent.request_id);
    expect(shown).toBe(t.web_scans[0].id);                     // the popup shows the stored scan's id, not one made in the browser
    expect(be.mails).toHaveLength(1);
    expect(be.mails[0].text).toContain(`Your scan number: ${shown}.`);
    expect(be.mails[0].to).toEqual([email]);
    expect(be.stray).toEqual([]);                              // nothing was sent anywhere that is not a stub
  });

  test("save not ticked: the report is requested, nothing optional is stored, no number is promised", async ({ page }, info) => {
    const { be, seen } = await wireWorker(page);
    await finishScan(page);
    await fill(page, "e2e-popup-f3+nosave@example.com", { save: false });
    await page.getByRole("button", { name: /send my report/i }).click();
    await expect(page.getByText("Your report is on its way.")).toBeVisible();
    await expect(page.getByTestId("scan-not-saved")).toContainText(/not saved/i);
    await page.screenshot({ path: info.outputPath("3-popup-not-saved-confirmation.png") });
    expect(seen[0].sent).not.toHaveProperty("scan");
    expect(seen[0].sent).not.toHaveProperty("save_consent");
    const t = be.tables;
    expect([t.users.length, t.leads.length, t.scans.length, t.web_scans.length, t.web_scan_contacts.length, t.web_scan_events.length]).toEqual([1, 1, 1, 0, 0, 0]);
    expect(be.mails).toHaveLength(1);
    expect(be.mails[0].text + be.mails[0].html).not.toMatch(/Your scan number/);
    expect(be.stray).toEqual([]);
  });

  test("the answer is lost after the Worker saved: the retry is the same request, the number comes back and nothing is duplicated", async ({ page }, info) => {
    const { be, seen } = await wireWorker(page, { loseFirstAnswer: true });
    await finishScan(page);
    await fill(page, "e2e-popup-f3+timeout@example.com", { save: true });
    const button = page.getByRole("button", { name: /send my report/i });
    await button.click();
    await expect(page.getByRole("alert")).toContainText(/could not request your report/i);
    await expect(page.getByText("Your report is on its way.")).toHaveCount(0);   // no false success
    await page.screenshot({ path: info.outputPath("4-popup-failure-message.png") });
    await expect(page.getByPlaceholder("your@email.com")).toHaveValue("e2e-popup-f3+timeout@example.com");
    await button.click();
    await expect(page.getByText(/already have a report request/i)).toBeVisible();
    const shown = (await page.getByTestId("scan-number").first().textContent())?.trim() ?? "";

    expect(seen).toHaveLength(2);
    expect(seen[1].sent.request_id).toBe(seen[0].sent.request_id);
    expect(seen[1].body).toMatchObject({ duplicate: true, replay: true, scan_saved: true });
    const t = be.tables;
    expect([t.users.length, t.leads.length, t.scans.length, t.web_scans.length, t.web_scan_contacts.length]).toEqual([1, 1, 1, 1, 1]);
    expect(shown).toBe(t.web_scans[0].id);
    expect(be.mails).toHaveLength(1);                          // one first email, not two
    expect(be.stray).toEqual([]);
  });

  test("rate limited: honest wait message, address kept, the next press succeeds", async ({ page }) => {
    const { be, seen } = await wireWorker(page, { refuseFirst: 1 });
    await finishScan(page);
    await fill(page, "e2e-popup-f3+rate@example.com", { save: false });
    const button = page.getByRole("button", { name: /send my report/i });
    await button.click();
    await expect(page.getByRole("alert")).toContainText(/wait a minute/i);
    await button.click();
    await expect(page.getByText("Your report is on its way.")).toBeVisible();
    expect(seen).toHaveLength(1);                               // the refused attempt never reached the Worker
    expect(be.tables.scans).toHaveLength(1);
    expect(be.mails).toHaveLength(1);
  });
});
