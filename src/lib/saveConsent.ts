// MPC-7470 (decision D12): the wording of the separate tick box at the contact step, and its version.
// The label is shown word for word; the version is sent with the request and stored with the consent record.
// If the label changes, give it a new version here AND add that version to SAVE_CONSENT_VERSIONS in workers/scan-report/lib/webScan.js
// (the Worker rejects a version it does not know).
export const SAVE_CONSENT_LABEL =
  "Save my scan result with my email, including technical details from my browser such as my IP address, so my report can show it.";
export const SAVE_CONSENT_VERSION = "2026-10-12-v1";

// One line under the scan results (only while saving is on).
export const SCAN_SCREEN_LINE =
  "Your scan result stays in your browser. We save it only if you ask for your report, and only with your email.";
// One line at the contact step, next to the tick box (only while saving is on and a scan is in this browser).
export const CONTACT_STEP_LINE =
  "We save your scan result only if you tick the box above and send your email. Without your email, nothing from your scan is saved.";
