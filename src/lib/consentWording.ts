// MPC-10831 (Chris, 2026-11-23: "keep unsubscribe-only and say so on the form"). Used on the two places that send a report:
// the /scan contact step and the report popup. Follow-ups start for every sent report and stop on "I have fixed this" or
// unsubscribe (docs/report-choices-mpc-9793.md, item 2). There is no marketing consent and no marketing send in the
// scan-report Worker. A separate marketing opt-in is added only when a marketing send exists.
export const REPORT_CONSENT_LABEL =
  "Email me my results and follow-ups about them. I can unsubscribe at any time; that is the only choice we offer, and there is no separate marketing opt-in.";

// MPC-11120 item 4 (Chris approved 2026-11-25): the other consent boxes said "occasional privacy tips", but no tips or newsletter are sent
// (docs/email-map: no marketing send exists). Each line now says what that form really leads to, ends with the same unsubscribe-only sentence
// as the report and contact boxes (MPC-10831), and offers no marketing opt-in. DRAFT wording, visitor-facing: Chris reviews it (MPC-6798).
const UNSUBSCRIBE_ONLY = "I can unsubscribe at any time; that is the only choice we offer, and there is no separate marketing opt-in.";
export const START_CONSENT_LABEL = `Email me a confirmation and updates about my sign-up. ${UNSUBSCRIBE_ONLY}`;
export const WAITLIST_CONSENT_LABEL = `Email me when this plan is available. ${UNSUBSCRIBE_ONLY}`;
export const BUSINESS_CONSENT_LABEL = `Email me my company audit and follow-up about it. ${UNSUBSCRIBE_ONLY}`;
export const ENTERPRISE_CONSENT_LABEL = `Email me to arrange the demo. ${UNSUBSCRIBE_ONLY}`;
export const AI_CHECK_CONSENT_LABEL = `Email me about the AI Access report. ${UNSUBSCRIBE_ONLY}`;
export const ALICE_CONSENT_LABEL = `Email me when Alice HD is available. ${UNSUBSCRIBE_ONLY}`;
