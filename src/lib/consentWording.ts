// MPC-10831 (Chris, 2026-11-23: "keep unsubscribe-only and say so on the form"). Used on the two places that send a report:
// the /scan contact step and the report popup. Follow-ups start for every sent report and stop on "I have fixed this" or
// unsubscribe (docs/report-choices-mpc-9793.md, item 2). There is no marketing consent and no marketing send in the
// scan-report Worker. A separate marketing opt-in is added only when a marketing send exists.
export const REPORT_CONSENT_LABEL =
  "Email me my results and follow-ups about them. I can unsubscribe at any time; that is the only choice we offer, and there is no separate marketing opt-in.";
