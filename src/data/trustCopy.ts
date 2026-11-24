// MPC-11242 (F8 pass 2, from MPC-9907): the one sentence that tells a visitor how their scan data is handled.
// The home page and /thank-you both render this constant, so they cannot drift apart (they did: /thank-you said
// "results aren't stored on our servers", which is not true once someone saves their scan).
// Facts behind it: scans are kept 12 months only if the visitor ticks save-my-scan; deleted on request by scan number;
// analytics only after consent (see index.html consent gate, MPC-9888).
export const STORAGE_NOTE =
  "The scan runs in your browser. We save a scan only if you tick “save my scan”; we then keep it for 12 months, and you can have it deleted at any time by quoting your scan number. We only store what you choose to submit, such as your email address, and we use analytics only with your consent.";
