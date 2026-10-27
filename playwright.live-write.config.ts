import { defineConfig, devices } from "@playwright/test";

// MPC-7471-F3: a WRITING live test. It submits ONE real request on the production site with a synthetic test address and reads back what the browser saw.
// Unlike playwright.live.config.ts (read-only, nightly), this is never run by any workflow: it needs LIVE_TEST_EMAIL and LIVE_TEST_CONFIRM (see the spec).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  testDir: "./e2e-live-write",
  retries: 0,                 // a retry would be a second real submission
  workers: 1,
  timeout: 300_000,
  reporter: "list",
  use: {
    // LIVE_BROWSER_CHANNEL=chrome runs the test in the installed Google Chrome instead of the bundled Chromium (Cloudflare Turnstile is stricter with the latter).
    ...(process.env.LIVE_BROWSER_CHANNEL ? { channel: process.env.LIVE_BROWSER_CHANNEL } : {}),
    baseURL: process.env.LIVE_SITE ?? "https://myprivacytool.io",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "live-write-desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
});
