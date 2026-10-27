import { test as base, expect } from "@playwright/test";

// Read-only guard: GET/HEAD/OPTIONS pass; everything else is aborted, except Cloudflare's own challenge and
// RUM beacons which the page posts on load. Aborted writes are counted so a test can prove nothing was sent.
const ALLOWED_WRITES = /^https:\/\/(challenges\.cloudflare\.com\/|www\.myprivacytool\.io\/cdn-cgi\/rum)/;
export const test = base.extend<{ blockedWrites: string[] }>({
  blockedWrites: [async ({ context }, provide) => {
    const blocked: string[] = [];
    await context.route("**/*", (route) => {
      const r = route.request();
      if (["GET", "HEAD", "OPTIONS"].includes(r.method()) || ALLOWED_WRITES.test(r.url())) return route.fallback();
      blocked.push(`${r.method()} ${r.url()}`);
      return route.abort();
    });
    await provide(blocked);
  }, { auto: true }],
});
export { expect };
