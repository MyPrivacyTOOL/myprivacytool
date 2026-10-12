# Policy wording for edge logging and device recognition (MPC-7491)

Status: edge logging wording is live in `src/pages/Privacy.tsx` (sections 2.3 and 6), approved by Chris 2026-10-12 (PR 260).
Device recognition wording below is **NOT LIVE YET**. It is held here and must not be added to the site until MPC-7494 ships and Chris approves the screen.

## Retention proposal (Chris decides)

**30 days for the IP address of person and unknown visits.** One line: long enough to investigate abuse or a deletion request and to re-sort a visit when the rules improve, short enough that a raw IP address is not kept as a standing record of someone's browsing. Set in one place: `public.edge_visit_retention.ip_days`.
Bot and AI rows are kept in full.

## Decided: misjudged people

A person whose browser hides its details used to be sorted as a bot (R6) and keep their IP in full. Chris approved the fix on 2026-10-12: a browser-looking user agent with the browser headers missing is now `unknown` (rule R9, ruleset 2026-10-12.2), so the IP is cut after 30 days. Rows already stored under R6 keep their class; the raw facts are kept so they can be re-sorted later.

## NOT LIVE YET: open device recognition (goes live with MPC-7494)

> **Recognising your device.** If you choose to, we can tell you when we recognise the device you are using from the technical details its browser shows us, without using a cookie. We do this in the open: when it happens we show you that we recognised you, which details we used and how, and what you can do about it, including asking us to delete it. We do not recognise your device in the background. If you do nothing, we do not link a visit to you. Recognising a device is only used with your consent, and you can withdraw it at any time by contacting us or deleting your scan number record.

Decided by Chris 2026-10-12 (recommendations approved), for MPC-7494 to build:
- Timing: offered after a scan is saved, as a clear "Recognise this device?" choice, not at the first visit.
- Retention: the stored device details are tied to the saved scan (12 months) and deleted with the scan number.
- Policy position: a new section 2.5 beside saved scans (same consent and deletion path).
The screen itself still needs Chris's approval before MPC-7494 ships.

## Conflicts to note on other tasks (not resolved here)

- MPC-7397 (touch ledger): proposed rule, approved by Chris 2026-10-12: an edge visit may be linked to a person only through data the person gave us (scan number or email), never through the IP; once linked it follows the saved-scan consent and deletion rules, not the 30-day cut.
- MPC-6798 (legal review): brief for counsel in `docs/legal-brief-edge-logging-mpc-7491.md`. Confirm 30 days, the "unknown is a person" rule, and whether the wording needs a stated legal basis (legitimate interest) for HK, UK and EU readers.
