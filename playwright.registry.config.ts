import { defineConfig, devices } from "@playwright/test";

// MPC-9884 layer 2: the registry crawl runs against the production build (dist/) served by `vite preview`, in its own job so a crawl failure is named.
// Separate from playwright.config.ts (testDir ./e2e) so `npm run test:e2e` does not run it twice.
const PORT = 4174;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e-registry",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices["Desktop Chrome"], launchOptions: { executablePath } },
  webServer: { command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
