// MPC-7471-F3: LIVE test of the post-scan popup against PRODUCTION. It sends ONE real report request (stored rows, a first email and a report to the test address).
//
//   LIVE_TEST_EMAIL=testingnt69+52@gmail.com \
//   LIVE_TEST_CONFIRM=I_APPROVE_ONE_REAL_SUBMISSION \
//   npx playwright test -c playwright.live-write.config.ts
//
// Guards: it does nothing unless both variables are set; the address must be a "+tag" address (a synthetic test inbox, never a bare real address); retries are off.
// The page is driven like a visitor. Nothing is stubbed. What the browser saw is written to LIVE_TEST_OUT (default test-results/live-write-evidence.json) as evidence:
// the address, the request_id it sent, the Worker's answer, the scan number shown. The STORED rows and the emails are checked separately (database read, mailbox).
// The first answer is dropped on purpose (a lost answer after a successful save); the popup's own retry sends the SAME request_id and must get the original scan number back, with no second email.
// Turnstile is NOT bypassed: run it in a real, headed browser (npm run test:e2e:live-write -- --headed).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EMAIL = process.env.LIVE_TEST_EMAIL ?? "";
const CONFIRMED = process.env.LIVE_TEST_CONFIRM === "I_APPROVE_ONE_REAL_SUBMISSION";
const OUT = process.env.LIVE_TEST_OUT ?? "test-results/live-write-evidence.json";
const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.skip(!CONFIRMED || !EMAIL, "live write test: set LIVE_TEST_EMAIL and LIVE_TEST_CONFIRM=I_APPROVE_ONE_REAL_SUBMISSION to run");
test.skip(!/^[^@+\s]+\+[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL), "live write test: the address must be a +tag test address");

test("production popup: one real submission, lost answer, retry returns the same scan number", async ({ page }) => {
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

  // 1. finish a real scan. Tap every tile that is not yet confirmed (not only those labelled "Tap to confirm": tiles whose check could not finish have other labels),
  // and stop early with a full report if the scan stalls, instead of waiting out the test timeout.
  await page.goto("/?view=grid");
  const counter = page.getByTestId("confirmation-counter");
  await expect(counter).toBeVisible({ timeout: 60_000 });
  const unconfirmed = page.locator('[role="listitem"] [role="button"][aria-label]:not([aria-label$="Confirmed"])');
  const email = page.getByPlaceholder("your@email.com");
  let lastDone = -1, idle = 0;
  for (let i = 0; i < 900; i++) {
    if (await email.isVisible().catch(() => false)) break;                       // the popup is open: the scan is complete
    const [done, total] = ((await counter.textContent()) ?? "0/0").split("/").map(Number);
    if (done !== lastDone) { lastDone = done; idle = 0; } else idle++;
    if (await unconfirmed.count()) { await unconfirmed.first().click({ force: true }).catch(() => undefined); await page.waitForTimeout(120); }
    else await page.waitForTimeout(400);
    if (idle > 60) {                                                              // about 30 s with no progress: report and stop
      evidence.scan_stalled = {
        counter: `${done}/${total}`,
        unconfirmed_tiles: await unconfirmed.evaluateAll((els) => els.slice(0, 40).map((e) => e.getAttribute("aria-label"))),
        text_near_top: (await page.locator("body").innerText()).slice(0, 600),
      };
      break;
    }
  }
  if (evidence.scan_stalled) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: "test-results/live-0-scan-stalled.png", fullPage: true });
  }
  await expect(email, "the popup must open once the scan completes (see scan_stalled in the evidence file)").toBeVisible({ timeout: 30_000 });

  // 2. the popup, as a visitor sees it
  await email.fill(EMAIL);
  await page.getByLabel(/email me my results and occasional privacy tips/i).check();
  const saveBox = page.getByLabel(/save my scan result with my email/i);
  await expect(saveBox, "the save box must be offered in production (VITE_SAVE_WEB_SCANS on)").toBeVisible();
  await expect(saveBox).not.toBeChecked();
  await saveBox.check();
  evidence.popup_text_before = (await page.getByTestId("scan-complete-dialog").innerText()).slice(0, 1500);
  await page.screenshot({ path: "test-results/live-1-popup-before.png" });

  // 3. ONE real submission, with a lost answer. The FIRST request is sent to the real Worker (so it saves and sends), but its answer is dropped before the page sees it,
  // like a timeout after a successful write. The popup then shows its failure message; pressing the button again sends the SAME request_id with a fresh Turnstile token,
  // and the Worker must answer with the original outcome (a replay) instead of creating anything twice. Turnstile is never bypassed: this needs a real browser that earns a token.
  const turnstileFacts = () => page.evaluate(() => ({
    api: typeof (window as unknown as { turnstile?: unknown }).turnstile,
    iframes: document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').length,
    tokenInputLengths: [...document.querySelectorAll('input[name="cf-turnstile-response"]')].map((i) => (i as HTMLInputElement).value.length),
    userAgent: navigator.userAgent,
    webdriver: (navigator as Navigator & { webdriver?: boolean }).webdriver ?? null,
  }));
  evidence.turnstile_before_send = await turnstileFacts();
  let lost: { status: number; answer: Record<string, unknown> | null } | null = null;
  let requestCount = 0;
  await page.route(/\/api\/scan$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    requestCount += 1;
    if (requestCount === 1) {
      let sentBody: Record<string, unknown> = {};
      try { sentBody = JSON.parse(req.postData() ?? "{}"); } catch { /* ignore */ }
      evidence.first_request_token_length = typeof sentBody["cf-turnstile-response"] === "string" ? (sentBody["cf-turnstile-response"] as string).length : 0;   // the length only, never the token
      const real = await route.fetch();
      let answer: Record<string, unknown> | null = null;
      try { answer = await real.json(); } catch { /* not JSON */ }
      lost = { status: real.status(), answer };
      return route.abort("timedout");
    }
    return route.continue();
  });

  const send = page.getByRole("button", { name: /send my report/i });
  // press until the first request has really gone out (Turnstile may need a moment: the popup says so and nothing is sent yet)
  for (let attempt = 1; attempt <= 6 && requestCount < 1; attempt++) {
    await send.click();
    await page.waitForTimeout(8_000);
    if (requestCount < 1) evidence[`wait_${attempt}`] = (await page.getByRole("alert").first().textContent().catch(() => null)) ?? "no alert";
  }
  expect(requestCount, "a first request must reach the Worker (Turnstile token needed; see evidence)").toBe(1);
  evidence.first_request_answer_lost = lost;
  await expect(page.getByRole("alert")).toContainText(/could not request your report/i, { timeout: 30_000 });
  await expect(page.getByText(/your report is on its way/i)).toHaveCount(0);   // no false success after a lost answer
  await page.screenshot({ path: "test-results/live-2-popup-failure.png" });

  // the retry: same request_id, fresh token
  let replayed = false;
  for (let attempt = 1; attempt <= 6 && !replayed; attempt++) {
    await send.click();
    const outcome = await Promise.race([
      page.getByText(/already have a report request/i).waitFor({ timeout: 40_000 }).then(() => "ok" as const),
      page.getByText(/verifying you are human/i).waitFor({ timeout: 40_000 }).then(() => "wait" as const),
    ]).catch(() => "none" as const);
    if (outcome === "ok") replayed = true;
    else if (requestCount > 1) break;           // a second request went out and the page did not show the replay: stop, never send a third
    else await page.waitForTimeout(6_000);
  }
  evidence.requests_sent = requestCount;
  evidence.confirmation_text = (await page.getByRole("status").first().innerText().catch(() => "")).slice(0, 800);
  await page.screenshot({ path: "test-results/live-3-popup-after-retry.png" });
  evidence.posts = posts;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  expect(replayed, "the retry must end on the replay confirmation (see the evidence file)").toBe(true);

  // 4. what the Worker really did, and what the visitor was then told
  expect(requestCount).toBe(2);
  const first = lost as unknown as { status: number; answer: Record<string, unknown> | null };
  expect(first.status).toBe(200);
  expect(first.answer).toMatchObject({ success: true, duplicate: false, scan_saved: true });
  const scanNumber = String(first.answer?.scan_number ?? "");
  expect(scanNumber).toMatch(SCAN_NUMBER_RE);
  expect(posts).toHaveLength(1);                // only the retry produced a response the page saw
  expect(posts[0].status).toBe(200);
  expect(posts[0].answer).toMatchObject({ success: true, duplicate: true, replay: true, scan_saved: true, scan_number: scanNumber });
  expect(String(posts[0].body.request_id ?? "")).toMatch(/^[0-9a-f-]{36}$/i);
  const shown = (await page.getByTestId("scan-number").first().textContent())?.trim();
  expect(shown).toBe(scanNumber);
  await expect(page.getByTestId("scan-number-notice").first()).toContainText(/quote this number if you want this scan deleted/i);
  evidence.scan_number = scanNumber;
  evidence.request_id = posts[0].body.request_id;
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
});
