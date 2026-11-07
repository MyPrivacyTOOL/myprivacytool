// MPC-9836 (Chris, Decision 6, 2026-11-07): every claim for a feature that is not yet LIVE keeps its full wording but
// carries a visible status marker. THIS FILE IS THE ONLY PLACE STATUS IS SET. Flip a feature to "live" (one line) the
// day its LIVE test passes and its markers disappear everywhere. Spine: Notion "MPT > Build Spine — claims → features → tasks (v1)".

export type FeatureState = "live" | "in_build" | "planned";

export type FeatureId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7a" | "F7b" | "F8" | "F9" | "F10";

export const FEATURE_STATUS: Record<FeatureId, FeatureState> = {
  // F1 Broker lookup. LIVE test: a submitted scan lists >=5 real brokers (listed / not listed / not checked) with evidence link and opt-out guide.
  F1: "in_build",   // MPC-9813: confirm gate + "show us your listing" check shipped; stays in_build until the LIVE test passes (needs MPC-9814: /start wording, /ai-access-check)
  // F2 Paid Exposure Report. LIVE test: a signed-in Basic+ account opens the full report; Free sees the free report with an upgrade prompt.
  F2: "planned",
  // F3 Accounts and Stripe billing. LIVE test: sign in, pay in Stripe Checkout, plan active in account settings, cancel and refund per Terms section 6.
  F3: "planned",
  // F4 Removal requests. LIVE test: an authorised account submits a removal to one broker and a re-check moves it to confirmed / still-listed.
  F4: "planned",
  // F5 Dark-web and breach monitoring. LIVE test: a paid, verified account sees breaches in the report and gets an alert email on a new breach.
  F5: "planned",
  // F6 Business and team scanning. LIVE test: an admin invites 3 employees, two authorise scans, admin sees a team summary with broker results.
  F6: "planned",
  // F7a Alice / channel wording. LIVE test: confirmation email and FAQ say the same about replies; each /start channel is true as worded.
  F7a: "in_build",
  // F7b Alice conversation. LIVE test: a reply to a real report email gets an Alice answer in the same thread; each channel round-trips a test message.
  F7b: "planned",
  // F8 Legal pages and policy accuracy. LIVE test: every sentence in Privacy 2.3, Cookies and Terms 6 is true of the code; /accessibility and /gdpr-rights render and are in the footer.
  F8: "in_build",
  // F9 Hexagon catalogue and Journey. LIVE test: no "46" claim anywhere; "54 run in the scan, 368 in the catalogue" everywhere; /footprint/ carries a Sample-data marker; Journey badges are true.
  F9: "live",       // MPC-9832: LIVE test passed on the deployed site 2026-11-07 (no 46 claim, one count sentence on 4 pages, /footprint/ Sample-data marker from MPC-9831, 8 true Journey badges)
  // F10 Report delivery and storage. LIVE test: /start states what arrives and when, matching a real scan submitted from the live site.
  F10: "in_build",
};

// MPC-9832: the eight /journey steps. One line per step; flip to "live" the day that step works end to end for a visitor.
// States come from the code, not the page copy (evidence per step is in the MPC-9832 pull request):
//   1 Know           live      the free scan runs in the browser and renders the hexagons
//   2 Baseline       in_build  "Is this you?" confirmation exists (MPC-9813); no dated snapshot or Identity Baseline is stored
//   3 Erase          in_build  /opt-out-guides is live (manual opt-out); removal requests are not built (F4)
//   4 Clean baseline planned   no timestamped clean baseline; monitoring is sample data only (F5)
//   5 Go agentic     planned   /ai-access-check is a waitlist form, no agent inventory exists
//   6 Agent footprint planned  nothing in the code (F6)
//   7 Agent passport planned   nothing in the code (F6)
//   8 Agent trust    planned   nothing in the code (F6)
export type JourneyStepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const JOURNEY_STEPS: Record<JourneyStepId, FeatureState> = {
  1: "live",
  2: "in_build",
  3: "in_build",
  4: "planned",
  5: "planned",
  6: "planned",
  7: "planned",
  8: "planned",
};
