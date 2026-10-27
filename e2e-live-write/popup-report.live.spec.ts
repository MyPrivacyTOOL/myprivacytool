// MPC-7471-F3: LIVE test of the post-scan popup against PRODUCTION. It sends ONE real report request (stored rows, a first email and a report to the test address).
//
//   LIVE_TEST_EMAIL=testingnt69+52@gmail.com \
//   LIVE_TEST_CONFIRM=I_APPROVE_ONE_REAL_SUBMISSION \
//   npx playwright test -c playwright.live-write.config.ts
//
// Guards: it does nothing unless both variables are set; the address must be a "+tag" address (a synthetic test inbox, never a bare real address); retries are off.
// The page is driven like a visitor. Nothing is stubbed. What the browser saw is written to LIVE_TEST_OUT (default test-results/live-write-evidence.json) as evidence:
// the address, the request_id it sent, the Worker's answer, the scan number shown. The STORED rows and the emails are checked separately (database read, mailbox).
// After the submit it re-sends the SAME request (same request_id) once from the page, to prove the replay returns the same scan number without a second email.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EMAIL = process.env.LIVE_TEST_EMAIL ?? "";
const CONFIRMED = process.env.LIVE_TEST_CONFIRM === "I_APPROVE_ONE_REAL_SUBMISSION";
const OUT = process.env.LIVE_TEST_OUT ?? "test-results/live-write-evidence.json";
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.skip(!CONFIRMED || !EMAIL, "live write test: set LIVE_TEST_EMAIL and LIVE_TEST_CONFIRM=I_APPROVE_ONE_REAL_SUBMISSION to run");
test.skip(!/^[^@+\s]+\+[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL), "live write test: the address must be a +tag test address");

test("production popup: one real submission, saved scan, same scan number, replay returns it again", async ({ page }) => {
  const evidence: Record<string, unknown> = { started_at: new Date().toISOString(), site: process.env.LIVE_SITE ?? "https://myprivacytool.io", email: EMAIL };
  const posts: { body: Record<string, unknown>; status: number; answer: Record<string, unknown> | null }[] = [];

  // Start as a visitor who already chose "Essential only", so our own cookie banner never covers the form (same as e2e/fixtures.ts).
  await page.addInitScript(() => { try { localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: false, at: "2026-01-01T00:00:00.000Z" })); } catch { /* ignore */ } });
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !/\/api\/scan$/.test(new URL(res.url()).pathname)) return;
    let answer: Record<string, unknown> | null = null;
    try { answer = await res.json(); } catch { /* not JSON */ }
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(req.postData() ?? "{}"); } catch { /* ignore */ }
    posts.push({ body: { ...body, scan: body.scan ? `[${(body.scan as unknown[]).length} hexagons]` : undefined, "cf-turnstile-response": body["cf-turnstile-response"] ? "[token]" : undefined }, status: res.status(), answer });
  });

  // 1. finish a real scan
  await page.goto("/?view=grid");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 60_000 });
  const pending = page.locator('[role="button"][aria-label$="Tap to confirm"]');
  for (let i = 0; i < 600; i++) {
    const [done, total] = ((await counter.textContent()) ?? "0/0").split("/").map(Number);
    if (done >= total && total >= 46) break;
    if (await pending.count()) await pending.first().click({ force: true });
    else await page.waitForTimeout(300);
  }
  const email = page.getByPlaceholder("your@email.com");
  await expect(email).toBeVisible({ timeout: 60_000 });

  // 2. the popup, as a visitor sees it
  await email.fill(EMAIL);
  await page.getByLabel(/email me my results and occasional privacy tips/i).check();
  const saveBox = page.getByLabel(/save my scan result with my email/i);
  await expect(saveBox, "the save box must be offered in production (VITE_SAVE_WEB_SCANS on)").toBeVisible();
  await expect(saveBox).not.toBeChecked();
  await saveBox.check();
  evidence.popup_text_before = (await page.getByTestId("scan-complete-dialog").innerText()).slice(0, 1500);
  await page.screenshot({ path: "test-results/live-1-popup-before.png" });

  // 3. ONE real submit. Turnstile may need a moment: the popup says so and asks again, so wait for the button and try a bounded number of times.
  const send = page.getByRole("button", { name: /send my report/i });
  let sent = false;
  for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
    await send.click();
    const outcome = await Promise.race([
      page.getByText(/your report is on its way|already have a report request/i).waitFor({ timeout: 45_000 }).then(() => "ok" as const),
      page.getByRole("alert").waitFor({ timeout: 45_000 }).then(() => "alert" as const),
    ]).catch(() => "none" as const);
    if (outcome === "ok") sent = true;
    else {
      evidence[`attempt_${attempt}_alert`] = (await page.getByRole("alert").first().textContent().catch(() => null)) ?? outcome;
      if (posts.length > 0) break;           // the Worker was reached: never send a second submission blindly
      await page.waitForTimeout(5_000);       // only "Verifying you are human": nothing was sent yet, try again
    }
  }
  evidence.confirmation_text = (await page.getByRole("status").first().innerText().catch(() => "")).slice(0, 800);
  await page.screenshot({ path: "test-results/live-2-popup-after.png" });
  evidence.posts = posts;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  expect(sent, "the popup must reach its success screen (see the evidence file for the alert text)").toBe(true);

  // 4. what the visitor was told
  expect(posts, "exactly one request to /api/scan so far").toHaveLength(1);
  const first = posts[0];
  expect(first.status).toBe(200);
  expect(first.answer).toMatchObject({ success: true, duplicate: false, scan_saved: true });
  const scanNumber = String(first.answer?.scan_number ?? "");
  expect(scanNumber).toMatch(SCAN_NUMBER_RE);
  const shown = (await page.getByTestId("scan-number").first().textContent())?.trim();
  expect(shown).toBe(scanNumber);
  await expect(page.getByTestId("scan-number-notice").first()).toContainText(/quote this number if you want this scan deleted/i);
  expect(String(first.body.request_id ?? "")).toMatch(/^[0-9a-f-]{36}$/i);
  evidence.scan_number = scanNumber;
  evidence.request_id = first.body.request_id;

  // 5. replay: the SAME request again (same request_id, no scan attached, no second email expected); it must hand back the same scan number
  const replay = await page.evaluate(async ({ email: addr, requestId }) => {
    const res = await fetch("https://mpt-scan-report.myprivacytool.workers.dev/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: addr, consent: true, consent_source: "web_scan_summary", request_id: requestId }) });
    return { status: res.status, answer: await res.json().catch(() => null) };
  }, { email: EMAIL, requestId: String(first.body.request_id) });
  evidence.replay = replay;
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  expect(replay.status).toBe(200);
  expect(replay.answer).toMatchObject({ success: true, duplicate: true, replay: true, scan_saved: true, scan_number: scanNumber });
});
