import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // MPC-9884 (Open Tracker design 1.4): edit-time half of the registry CI check. Every outbound channel goes through shared/recipients/outbound.*
  // (callRecipient / fetchRecipient / loadRecipientScript / createPeerConnection). The authoritative gate is scripts/registry-ci/check.mjs (TypeScript
  // compiler API, with the ci-allowlist.json ratchet); these rules show the same violations in the editor. Existing call sites are listed in the
  // allowlist and are removed by MPC-9885 (server side) and MPC-9886 (browser side).
  {
    files: ["{src,functions,workers,shared}/**/*.{ts,tsx,js,mjs}"],
    ignores: ["**/*.{test,vitest,spec}.*", "**/{test,tests,__tests__}/**", "shared/recipients/outbound.*", "shared/recipients/fetch-spy.ts", "src/lib/recipientClient.ts"],
    rules: {
      "no-restricted-globals": ["error",
        ...["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "importScripts"].map((name) => ({
          name, message: `Outbound calls go through shared/recipients/outbound (callRecipient, fetchRecipient, loadRecipientScript, createPeerConnection) with a registered key. (MPC-9884)`,
        })),
      ],
      "no-restricted-properties": ["error",
        { property: "sendBeacon", message: "navigator.sendBeacon is an outbound call: use callRecipient with a registered key. (MPC-9884)" },
        ...["globalThis", "window", "self"].map((object) => ({ object, property: "fetch", message: "Use callRecipient / fetchRecipient. (MPC-9884)" })),
      ],
      "no-restricted-syntax": ["error",
        { selector: "ImportExpression > Literal[value=/^https?:/]", message: "Dynamic import() of a remote URL is an outbound call. (MPC-9884)" },
        { selector: "CallExpression[callee.name=/^(callRecipient|fetchRecipient|loadRecipientScript|createPeerConnection|recipientFetch|recipientScript|recipientPeerConnection)$/][arguments.0.type!='Literal']", message: "A recipient wrapper call must pass a string-literal registry key that exists in shared/recipients/recipients.json. (MPC-9884)" },
      ],
    },
  },
);
