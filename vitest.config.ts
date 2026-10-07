import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// MPC-7300: one Vitest run covers the React app (jsdom) and the Cloudflare Workers (node env set per file
// with a `@vitest-environment node` docblock). The pre-existing `node --test` suites for the Workers stay
// in place and run separately in CI (npm run test:workers:node).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src"), "@mpt/utils": path.resolve(__dirname, "./shared/utils/index.ts") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "shared/**/*.test.ts", "workers/**/*.vitest.{js,mjs,ts}", "scripts/**/*.vitest.{js,mjs,ts}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Critical paths only: lead capture, OAuth, HubSpot client, the three conversion forms and the
      // deploy-safety scripts. Everything else is reported elsewhere, not gated.
      include: [
        "workers/mpt-leads/worker.js",
        "workers/oauth-poc/*.js",
        "src/lib/hubspot.ts",
        "src/pages/Contact.tsx",
        "src/pages/Start.tsx",
        "src/pages/Newsletter.tsx",
        "src/components/EmailCaptureModal.tsx",
        "src/components/ConsentCheckbox.tsx",
        "scripts/ci/*.mjs",
      ],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
