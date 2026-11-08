// MPC-9887 (Open Tracker design 2.2 / 2.3): the ONE place the scan-consent settings live. The Worker that stores a consent, the site that renders
// the consent block (MPC-9888) and the deletion job (MPC-9890) all read these two values; nothing else may hard-code them.
//
//   consent_version  names the exact wording the visitor saw. Change it whenever the text (or {N}) changes; a request that carries any other
//                    version is refused, so every stored consent names a text we can show a lawyer (MPC-6798).
//   n_hours          {N} in the consent text: how long after the report is delivered a free user's personal record is deleted.
//                    Chris, 2026-11-08 13:19 HKT (DECIDED 2): 7 days = 168 hours. The text renders "7 days".
//
// A plain TypeScript module, not JSON: Workers are bundled by wrangler 3.x (esbuild without JSON import attributes), see recipients.data.js.
export const CONSENT_CONFIG = {
  consent_version: "2026-11-v1",
  n_hours: 168,
} as const;

export type ConsentConfig = typeof CONSENT_CONFIG;
