# E2E: HAR replay, network simulation and live drift checks

MPC-8538. This extends the hermetic Playwright suite (MPC-7300, `e2e/fixtures.ts`). Nothing in the existing specs changes.

## Why

| Gap in the existing suite | What this adds |
|---|---|
| `fixtures.ts` aborts `api.myprivacytool.io/whoami`, so every test sees the "Unknown" fallback. The location guess ("You are probably in or near …") was never rendered in a test. | The production `whoami` and `hk-geo` responses are **recorded into HAR files** and replayed, so the scan runs with real-shaped data. A Hong Kong variant tests the HK path without the manual override. |
| HTTP status mocks (500, 429, 409) can't express dropped connections, hangs, timeouts, latency or offline. | The `sim` fixture adds abort, hang/release, delay, JSON, request counting and offline. |
| The hand-written mocks can drift from production without anyone noticing. | A nightly **read-only live job** checks that production still matches the recordings: field names, types and CORS. |
| No coverage for chunk-load failure. | Tests that reproduce a **known bug**: a blank page after a deploy or a dropped connection (see below). |

## Files

```
e2e/net-sim.ts                  visitor HAR option + sim fixture (extends ./fixtures)
e2e/visitor-har.spec.ts         scan with recorded / HK / broken visitor lookup
e2e/network-resilience.spec.ts  forms under abort / timeout / hang / slow; chunk-load bug
e2e/hars/visitor-recorded.har   production response, IP scrubbed to 203.0.113.10
e2e/hars/visitor-hk.har         same shape, Hong Kong values (derived; CI runners are never in HK)
scripts/e2e/record-visitor-har.mjs
e2e-live/                       read-only checks against https://www.myprivacytool.io
playwright.live.config.ts
.github/workflows/e2e-live-drift.yml
```

## Running

```bash
npm run build && npm run test:e2e        # all hermetic specs, old and new (CI job "E2E")
npx playwright test e2e/visitor-har.spec.ts e2e/network-resilience.spec.ts
npm run test:e2e:live                    # read-only, against production
npm run e2e:record-har                   # refresh e2e/hars/ from production
```

Using it in a spec:

```ts
import { test, expect, WHOAMI, HUBSPOT } from "./net-sim";
test.use({ visitor: "recorded" });       // "none" (default) | "recorded" | "hk"

test("…", async ({ page, sim, net }) => {
  await sim.abort(HUBSPOT, "timedout");   // or "failed" | "connectionrefused" | "internetdisconnected"
  const gate = await sim.hang(HUBSPOT);   // in-flight UI; gate.release() to continue
  await sim.delay(WHOAMI, 4000);
  await sim.json(WHOAMI, { city: null }, 200);
  const sent = sim.count(HUBSPOT);        // sent() -> number of real requests
});
```

Precedence: `sim` routes beat the HAR, and the HAR beats the `net` catch-all. Unmatched requests fall through.

Note: `context.setOffline()` does not stop requests that a route fulfils, so `net`'s HubSpot/Supabase mocks still "succeed" while offline. To simulate an offline submit, use `sim.abort(url, "internetdisconnected")`. Use `sim.offline()` for page and asset loads.

## Recording HARs

`record-visitor-har.mjs` loads `/` and `/HongKongSpam` on production. **Every non-GET request is aborted**, and only `whoami` and `hk-geo` are kept. It then:

- replaces the IP with `203.0.113.10` (RFC 5737 documentation range);
- strips cookies, `cf-ray` and transfer headers;
- re-points `access-control-allow-origin` to `http://127.0.0.1:4173` so the replay works on `vite preview`. The live job checks the real production value.

Re-record after an intentional change to the Worker's `/whoami` response, then review `git diff e2e/hars/`.

## Live drift job

`.github/workflows/e2e-live-drift.yml` runs nightly at 03:17 HKT, and can also be started manually. It checks:

- `whoami` returns 200, its CORS header is `https://www.myprivacytool.io`, and its field names and types match the HAR;
- `hk-geo` returns `{ country: "XX" }`;
- 8 key pages render in Chromium with no uncaught errors and no blocked writes.

### When drift fails

1. Download the `playwright-live-report` artifact and open the trace: `npx playwright show-trace test-results/<dir>/trace.zip`.
2. **Shape changed on purpose** (for example, the Worker added or renamed a field): update `src/lib/deviceDetection.ts` if needed, run `npm run e2e:record-har`, and commit.
3. **Shape changed by accident:** fix or roll back the Worker (`deploy-scan-report.yml` / the Worker repo).
4. **A page error:** production is broken. Use the Pages rollback (docs/ci-cd-testing.md#rollback).

## Known bug (MPC-8539): blank page when a lazy chunk can't load

All routes are `lazy()` (src/App.tsx). There is no error boundary and no `vite:preloadError` handler. If a route chunk fails to load, React unmounts and the visitor sees a **white page**.

The realistic trigger is a deploy. A visitor opened `/contact` before a Cloudflare Pages release, then submits. The lead **is** sent to HubSpot, but `/thank-you` asks for the old `ThankYou-<hash>.js`, which no longer exists, and the screen goes blank. A dropped connection followed by a link click does the same.

Both tests in `network-resilience.spec.ts › lazy route chunk unavailable` are marked `test.fail()`, so CI stays green. Once the app recovers, Playwright reports them as "unexpectedly passed"; remove the annotations then.

Suggested fix (not applied here):
1. In `src/main.tsx`, add `window.addEventListener("vite:preloadError", …)` to reload once, using a `sessionStorage` guard to avoid loops.
2. Wrap `<Suspense>` routes in an error boundary that shows "Something went wrong — reload". Keep the app shell visible.

## Debugging failures

Traces are kept on failure (`trace: "retain-on-failure"`). The CI `E2E` job uploads `playwright-report` and `test-results` on failure.

```bash
npx playwright show-trace test-results/<dir>/trace.zip
npx playwright test e2e/network-resilience.spec.ts --ui
```

In the trace's Network tab, requests answered from the HAR are marked as fulfilled. If `whoami` shows `aborted`, the HAR was not applied. Check `test.use({ visitor })`.
