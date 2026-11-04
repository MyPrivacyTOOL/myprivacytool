import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "./fixtures";

// MPC-8538: two layers on top of the hermetic `net` fixture in ./fixtures.ts.
//
// 1. `visitor` (HAR replay). The scan's visitor lookups (api.myprivacytool.io/whoami and /api/hk-geo) are
//    replayed from HAR files recorded from production by scripts/e2e/record-visitor-har.mjs, so the scan is
//    exercised with a real-shaped response instead of the "Unknown" fallback it always got when `net` aborts it.
//      "none"     - default; behaves exactly like ./fixtures (lookups aborted)
//      "recorded" - e2e/hars/visitor-recorded.har (production response, IP scrubbed)
//      "hk"       - e2e/hars/visitor-hk.har (same shape, Hong Kong values)
//
// 2. `sim` (network simulation). Page routes registered here win over both the HAR and `net`; unmatched
//    requests fall through. Use it for failure modes HTTP status mocks can't express: dropped connections,
//    hangs, latency, offline.
//
// Precedence (last registered wins): sim > visitor HAR > net catch-all.

const HARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "hars");
export const HAR = {
  recorded: path.join(HARS, "visitor-recorded.har"),
  hk: path.join(HARS, "visitor-hk.har"),
} as const;
export const WHOAMI = /^https:\/\/api\.myprivacytool\.io\/whoami/;
export const HK_GEO = /\/api\/hk-geo(\?|$)/;
export const HUBSPOT = /^https:\/\/api\.hsforms\.com\//;
export const SUPABASE_SUBSCRIBERS = /\.supabase\.co\/rest\/v1\/subscribers/;

type Matcher = string | RegExp;
type AbortCode = "failed" | "timedout" | "connectionrefused" | "internetdisconnected";

export interface Sim {
  /** Drop the connection (the browser sees a network error, not an HTTP status). */
  abort(url: Matcher, code?: AbortCode): Promise<void>;
  /** Never answer until `release()` is called: lets a test observe the in-flight UI. */
  hang(url: Matcher): Promise<{ release: () => void }>;
  /** Add latency, then let the request continue to the HAR / `net` mock. */
  delay(url: Matcher, ms: number): Promise<void>;
  /** Fixed JSON response. */
  json(url: Matcher, body: unknown, status?: number): Promise<void>;
  /** Count requests that reach the network layer (useful for double-submit checks). */
  count(url: Matcher): () => number;
  offline(on?: boolean): Promise<void>;
}

export const test = base.extend<{ visitor: "none" | "recorded" | "hk"; har: void; sim: Sim }>({
  visitor: ["none", { option: true }],

  har: [async ({ page, visitor, net: _net }, provide) => {
    // depends on `net` so its catch-all is registered first and the HAR route takes precedence over it
    if (visitor !== "none") {
      await page.routeFromHAR(HAR[visitor], { url: WHOAMI, notFound: "fallback" });
      await page.routeFromHAR(HAR[visitor], { url: HK_GEO, notFound: "fallback" });
    }
    await provide();
  }, { auto: true }],

  sim: async ({ page, context, har: _har }, provide) => {
    const preflight = { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } };
    const pending: Array<() => void> = [];
    await provide({
      abort: (url, code = "failed") => page.route(url, (r) => (r.request().method() === "OPTIONS" ? r.fulfill(preflight) : r.abort(code))),
      hang: async (url) => {
        let release!: () => void;
        const gate = new Promise<void>((res) => { release = res; pending.push(res); });
        await page.route(url, async (r) => {
          if (r.request().method() === "OPTIONS") return r.fulfill(preflight);
          await gate;
          await r.fallback().catch(() => {});
        });
        return { release };
      },
      delay: (url, ms) => page.route(url, async (r) => { await new Promise((res) => setTimeout(res, ms)); await r.fallback().catch(() => {}); }),
      json: (url, body, status = 200) => page.route(url, (r) =>
        r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) })),
      count: (url) => {
        let n = 0;
        const re = typeof url === "string" ? null : url;
        page.on("request", (req) => { if (req.method() !== "OPTIONS" && (re ? re.test(req.url()) : req.url().includes(url as string))) n++; });
        return () => n;
      },
      offline: (on = true) => context.setOffline(on),
    });
    pending.forEach((r) => r()); // never leave a hung route behind
  },
});

export { expect };

export { consoleErrors } from "./fixtures";
