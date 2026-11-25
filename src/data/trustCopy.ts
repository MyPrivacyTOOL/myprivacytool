// MPC-11242 (F8 pass 2, from MPC-9907): the one sentence that tells a visitor how their scan data is handled.
// The home page and /thank-you both render this constant, so they cannot drift apart (they did: /thank-you said
// "results aren't stored on our servers", which is not true once someone saves their scan).
// Facts behind it: scans are kept 12 months only if the visitor ticks save-my-scan; deleted on request by scan number;
// analytics only after consent (see index.html consent gate, MPC-9888).
export const STORAGE_NOTE =
  "The scan runs in your browser. We save a scan only if you tick “save my scan”; we then keep it for 12 months, and you can have it deleted at any time by quoting your scan number. We only store what you choose to submit, such as your email address, and we use analytics only with your consent.";

// MPC-9907 (F8 pass 2, items 1 and 2): what the results page says about where the scan ran. The old text said "100% Local" and "Nothing is
// transmitted", which was false: the IP and location lookup goes to our own server (stores nothing), the network leak check asks an outside
// service for the visitor's public address once Scan me is pressed, and Scan me itself sends a consent record. The scan RESULT stays in the
// browser unless the visitor emails the fix guide or ticks the save box. The two quoted phrases are pinned by FinalSummaryPanel.tile.test.tsx.
export const RESULT_PRIVACY_NOTE =
  "The scan ran in your browser and shows its result only to you. The result is not sent to us unless you choose to email yourself the fix guide or save your scan with your email. Your IP address and location came from a lookup on our own servers that stores nothing, and the network leak check asked an outside service for your public address. We store your scan result only if you tick the save box with your email.";
