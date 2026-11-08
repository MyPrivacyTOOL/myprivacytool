// MPC-9886: bundles src/lib/recipientClientGlobal.ts (the recipient wrapper for hand-written static pages) into public/recipient-client.min.js, which Vite then
// copies to dist/. Run by `prebuild`. The output is generated, so it is git-ignored; the registry JSON is inlined, so it can never drift from recipients.json.
import { build } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  root,
  configFile: false,
  logLevel: "warn",
  publicDir: false,
  resolve: { alias: { "@": join(root, "src") } },
  build: {
    outDir: "public",
    emptyOutDir: false,
    copyPublicDir: false,
    minify: true,
    target: "es2019",
    lib: { entry: join(root, "src/lib/recipientClientGlobal.ts"), formats: ["iife"], name: "mptRecipientClient", fileName: () => "recipient-client.min.js" },
  },
});
console.log("[recipient-client] wrote public/recipient-client.min.js");
