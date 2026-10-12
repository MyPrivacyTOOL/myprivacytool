# Policy wording for edge logging and device recognition (MPC-7491)

Status: edge logging wording is in `src/pages/Privacy.tsx` (sections 2.3 and 6) in this PR. **Not approved until Chris approves in writing on MPC-7491.**
Device recognition wording below is **NOT LIVE YET**. It is held here and must not be added to the site until MPC-7494 ships and Chris approves the screen.

## Retention proposal (Chris decides)

**30 days for the IP address of person and unknown visits.** One line: long enough to investigate abuse or a deletion request and to re-sort a visit when the rules improve, short enough that a raw IP address is not kept as a standing record of someone's browsing. Set in one place: `public.edge_visit_retention.ip_days`.
Bot and AI rows are kept in full.

## Decision for Chris: misjudged people

A person whose browser hides its details can be sorted as a bot (rule R6) and would then keep their IP address in full. The wording offers deletion on request. Alternatives: cut the IP of R6 rows too, or keep as proposed. This PR keeps it as proposed (the rules are MPC-7490's).

## NOT LIVE YET: open device recognition (goes live with MPC-7494)

> **Recognising your device.** If you choose to, we can tell you when we recognise the device you are using from the technical details its browser shows us, without using a cookie. We do this in the open: when it happens we show you that we recognised you, which details we used and how, and what you can do about it, including asking us to delete it. We do not recognise your device in the background. If you do nothing, we do not link a visit to you. Recognising a device is only used with your consent, and you can withdraw it at any time by contacting us or deleting your scan number record.

Open points before it ships (MPC-7494 / Chris): whether recognition is opt-in at the first visit or offered after a scan; retention of the stored device details; which section of the policy carries it.

## Conflicts to note on other tasks (not resolved here)

- MPC-7397 (touch ledger): the edge log becomes a source of touches; linking an edge visit to a person would make the IP personal data kept beyond 30 days. Needs the F-D1 rule applied there.
- MPC-6798 (legal review): confirm 30 days, the "unknown is a person" rule, and whether the wording needs a stated legal basis (legitimate interest) for HK, UK and EU readers.
