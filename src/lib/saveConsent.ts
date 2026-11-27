// MPC-7470 (decision D12): the wording of the separate tick box at the contact step, and its version.
// The label is shown word for word; the version is sent with the request and stored with the consent record.
// If the label changes, give it a new version here AND add that version to SAVE_CONSENT_VERSIONS in workers/scan-report/lib/webScan.js
// (the Worker rejects a version it does not know).
export const SAVE_CONSENT_LABEL =
  "Save my scan result with my email, including technical details from my browser such as my IP address, so my report can show it.";
export const SAVE_CONSENT_VERSION = "2026-10-12-v1";

// MPC-9817: the same tick box, in one step, when accounts are on: "Keep my scan / create my free account". It is a NEW wording, so it has its own version
// (also in SAVE_CONSENT_VERSIONS and ACCOUNT_CONSENT_VERSIONS in the Worker, which creates the account only after the click-to-confirm email proves the inbox).
// It tells the person plainly that the saved result includes browser details such as the IP address (unchanged from the box above) and that the account has no password.
// Used only while VITE_ACCOUNTS_ENABLED is exactly "true"; otherwise the original box above is shown, word for word.
export const ACCOUNT_CONSENT_LABEL =
  "Keep my scan and create my free account with this email. My scan result, including technical details from my browser such as my IP address, is kept in my account until I delete it. There is no password: I sign in with an email link.";
export const ACCOUNT_CONSENT_VERSION = "2026-11-08-v1";
export const accountsFlagOn = (): boolean => import.meta.env.VITE_ACCOUNTS_ENABLED === "true";
export const activeSaveLabel = (): string => (accountsFlagOn() ? ACCOUNT_CONSENT_LABEL : SAVE_CONSENT_LABEL);
export const activeSaveVersion = (): string => (accountsFlagOn() ? ACCOUNT_CONSENT_VERSION : SAVE_CONSENT_VERSION);

// MPC-7494: the SEPARATE, optional, unticked box for being recognised on a later visit. It is its own consent, not part of the save box above, and it can be
// ticked only together with the save box. Wording from docs/policy-wording-mpc-7491.md; needs Chris's written approval. Shown word for word; the version
// travels with the request. A new wording needs a new version here AND in RECOGNISE_CONSENT_VERSIONS in workers/scan-report/lib/webScan.js.
export const RECOGNISE_CONSENT_LABEL =
  "Next time I visit, tell me if you recognise this device from its technical details, without a cookie. You will be shown when it happens, which details were used, and I can delete it any time.";
export const RECOGNISE_CONSENT_VERSION = "2026-10-12-v1";

// One line under the scan results (only while saving is on).
export const SCAN_SCREEN_LINE =
  "Your scan result stays in your browser. We save it only if you ask for your report, and only with your email.";
// One line at the contact step, next to the tick box (only while saving is on and a scan is in this browser).
export const CONTACT_STEP_LINE =
  "We save your scan result only if you tick the box above and send your email. Without your email, nothing from your scan is saved.";
