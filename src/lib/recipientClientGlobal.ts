// MPC-9886: the same recipientFetch / recipientScript the React app uses, as a classic script (the ".min.js" name is also what keeps the static scan from re-scanning generated output; its sources are scanned) for the hand-written static pages (public/footprint,
// public/telegram-security-check.html) that have no module system. Built by scripts/build-recipient-client.mjs into public/recipient-client.min.js (not committed).
// A static page calls window.mptRecipients.fetch("<registry key>", url, init, [sent data items]) exactly as TypeScript code calls recipientFetch.
import { recipientFetch, recipientScript } from "./recipientClient";

(window as unknown as { mptRecipients: unknown }).mptRecipients = { fetch: recipientFetch, script: recipientScript };
// index.html and public/telegram-security-check.html load their consent-gated Google tag through this client; they wait for this event if it is not ready yet.
window.dispatchEvent(new Event("mpt:recipients-ready"));
