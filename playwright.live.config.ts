import { defineConfig, devices } from "@playwright/test";

// MPC-8538: read-only checks against the LIVE site (no local server). Run nightly by
// .github/workflows/e2e-live-drift.yml. Every non-GET request is aborted in e2e-live/guard.ts, so this can
// never create a lead, subscriber, report request or payment.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({
  testDir: "./e2e-live",
  retries: 2,
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report-live" }]] : "list",
  use: {
    baseURL: process.env.LIVE_SITE ?? "https://www.myprivacytool.io",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "live-desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
});
