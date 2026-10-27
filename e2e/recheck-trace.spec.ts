import { test, expect } from "./fixtures";
import { writeFileSync, mkdirSync } from "node:fs";

// CK-8494 -- SYNTHETIC browser trace of the verified-action-and-re-check journey for the WebRTC Leak hexagon.
// SYNTHETIC: a scripted fake RTCPeerConnection stands in for a real browser's network behaviour, the synthetic visitor is a fresh browser
// profile, and every network request leaving localhost is blocked by the fixtures. It is NOT a live run, NOT a real user and NOT production.
// What it does show: the real built UI, the real detector state rule, and the real persisted browser state at each step.
// Run:  npx playwright test e2e/recheck-trace.spec.ts --project=desktop   (writes docs/ck-8494/trace/*)
const OUT = "docs/ck-8494/trace";

test("SYNTHETIC trace: observation, explanation, own action, comparable re-check", async ({ page, net }) => {
  test.skip(test.info().project.name !== "desktop", "one trace is enough");
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const trace: { step: string; evidence: unknown }[] = [];
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("mpt_recheck_v1") ?? "null"));
  const log = async (step: string, evidence: unknown) => { trace.push({ step, evidence }); };

  await page.addInitScript(() => {
    // the synthetic visitor accepted analytics (the gate the saved first reading needs); set once so the later withdrawal step sticks
    if (!sessionStorage.getItem("trace_init")) {
      sessionStorage.setItem("trace_init", "1");
      localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: true, at: "2026-10-26T00:00:00.000Z" }));
      localStorage.setItem("trace_rtc", "leak");
    }
    const PUBLIC = "candidate:1 1 udp 1 203.0.113.7 5000 typ srflx";
    const MDNS = "candidate:2 1 udp 1 3f2a-uuid.local 5000 typ host";
    class FakeRTC {
      onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null;
      createDataChannel() { return {}; }
      async createOffer() { return {}; }
      async setLocalDescription() {
        const mode = localStorage.getItem("trace_rtc");
        setTimeout(() => {
          if (mode === "leak") this.onicecandidate?.({ candidate: { candidate: PUBLIC } });
          if (mode === "leak" || mode === "mdns") this.onicecandidate?.({ candidate: { candidate: MDNS } });
          this.onicecandidate?.({ candidate: null });
        }, 0);
      }
      close() {}
    }
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakeRTC;
  });

  // 1. OBSERVATION + 2. EXPLANATION: walk the next-step cards (Later = no response) until the WebRTC one
  await page.goto("/?hex_v2=2&view=grid");
  await expect(page.getByTestId("next-step")).toBeVisible({ timeout: 40_000 });
  for (let i = 0; i < 8; i++) {
    if (await page.getByRole("heading", { name: "WebRTC Leak" }).count()) break;
    await page.getByTestId("next-step").getByRole("button", { name: "Later" }).click();
  }
  await expect(page.getByRole("heading", { name: "WebRTC Leak" })).toBeVisible();
  await expect(page.getByTestId("recheck-baseline")).toBeVisible();
  const baseline = await saved();
  await log("1-2 observation shown with its explanation; first reading kept in this browser", { baseline: baseline.baseline, selfReport: baseline.selfReport ?? null, consent: baseline.consent });
  await page.screenshot({ path: `${OUT}/1-observation-explanation.png`, fullPage: true });
  expect(baseline.baseline.state).toBe("found");
  expect(baseline.selfReport).toBeUndefined();
  expect(JSON.stringify(baseline)).not.toMatch(/203\.0\.113|\d+\.\d+\.\d+\.\d+/);

  // 3. CONSIDERED RESPONSE: the visitor says they did the step themselves (their word, not proof)
  await page.getByTestId("next-step").getByRole("button", { name: "I've done this" }).click();
  await expect(page.getByTestId("recheck-run")).toBeVisible();
  const told = await saved();
  await log("3 visitor says they did the step (self-report, not verified)", { selfReport: told.selfReport, baselineUnchanged: told.baseline.observedAt === baseline.baseline.observedAt });
  await page.screenshot({ path: `${OUT}/2-self-reported.png`, fullPage: true });
  expect(told.baseline).toEqual(baseline.baseline);

  // 4. ACTION happens outside our page (browser setting). Synthetic: the fake browser now hides the address, but the first look is still blocked
  await page.evaluate(() => localStorage.setItem("trace_rtc", "none"));
  await page.getByTestId("recheck-run").click();
  await expect(page.getByTestId("recheck-outcome")).toHaveAttribute("data-outcome", "inconclusive");
  await log("4a re-check where WebRTC gathered nothing at all: inconclusive, not improvement", (await saved()).rechecks.at(-1));
  await page.screenshot({ path: `${OUT}/3-inconclusive.png`, fullPage: true });

  // 5. COMPARABLE RE-CHECK: the fake browser now gathers a hidden (mDNS) address only
  await page.evaluate(() => localStorage.setItem("trace_rtc", "mdns"));
  await page.getByTestId("recheck-run").click();
  await expect(page.getByTestId("recheck-outcome")).toHaveAttribute("data-outcome", "improvement");
  await expect(page.getByTestId("recheck-outcome")).toContainText("one reading");
  const done = await saved();
  await log("5 comparable re-check: observed improvement, scoped to one reading", { baseline: done.baseline, selfReport: done.selfReport, rechecks: done.rechecks.map((r: { observation: unknown; comparison: unknown }) => ({ observation: r.observation, comparison: r.comparison })) });
  await page.screenshot({ path: `${OUT}/4-improvement.png`, fullPage: true });
  expect(done.baseline).toEqual(baseline.baseline);       // original evidence preserved beside the new result
  expect(done.rechecks).toHaveLength(2);

  // 6. NO LEAK OF THE FINDING: nothing was sent anywhere
  expect(net.captured.leads).toHaveLength(0);
  expect(net.captured.supabase).toHaveLength(0);
  await log("6 network: no lead, database or learning request was made by this journey", { leads: net.captured.leads.length, supabase: net.captured.supabase.length });

  // 7. WITHDRAWAL: the visitor withdraws the analytics choice -> the saved journey is deleted
  await page.evaluate(() => {
    localStorage.setItem("mpt_cookie_consent", JSON.stringify({ v: 1, analytics: false, at: "2026-10-26T01:00:00.000Z" }));
    window.dispatchEvent(new Event("mpt:consent"));
  });
  await expect.poll(saved).toBeNull();
  await log("7 consent withdrawn: saved journey deleted", { saved: await saved() });
  await page.screenshot({ path: `${OUT}/5-withdrawn.png`, fullPage: true });

  writeFileSync(`${OUT}/trace.json`, JSON.stringify({ label: "SYNTHETIC -- scripted fake RTCPeerConnection, fresh browser profile, no backend, not production, not a real user", recordedAt: new Date().toISOString(), steps: trace }, null, 2));
});
