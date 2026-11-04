import { defineConfig, devices } from "@playwright/test";

// MPC-7300: E2E for the critical conversion flows. Runs against the PRODUCTION BUILD served by `vite preview`
// (CI builds first with VITE_HUBSPOT_CONTACT_FORM_ID=e2e-contact-form). All third-party calls (HubSpot,
// Supabase, the mpt-leads Worker, analytics) are intercepted in e2e/fixtures.ts, so the suite is hermetic:
// no real signups are created and no secrets are needed.
const PORT = 4173;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; // optional: use a preinstalled Chromium

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
