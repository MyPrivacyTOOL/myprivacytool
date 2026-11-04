# Where the agent's "write to Notion" instructions live (MPC-6965 Q11)

Searched 2026-10-06 (read-only) across the MyPrivacyTOOL project tree in Notion. **Result: no Notion page contains literal agent instruction text such as "write each scan to the OSINT Scan Results DB".** The write rule exists as policy text and as the destination databases. The agent's working prompt is most likely in the fleet repo, which this session cannot read. So Q11 is narrowed, not closed.

## Pages and databases, with the action at cutover

| # | Page / database | What it says or is | Action at cutover |
|---|---|---|---|
| 1 | [MPT Technical Architecture — Operational Databases](https://app.notion.com/p/3eb28547eaa7810eb763e735bc3e768f) | "Read vs write rules": **"Write to MPT DBs: everything MPT generates — scans, rate-limit counters, engagement, channel metrics"** and "Notion remains the live store until agents are switched". The only page with an explicit write rule. | **Edit**: replace the write rule with the v2 text (`agent-instructions-v2.md` §Policy text). |
| 2 | [MPT OSINT Scan Results](https://app.notion.com/p/db459759560440219be080dc7d39f3ac) (DB) | Write destination for scans. Fields: Scan, Session ID, Platform, User Handle, Data Points Found, Confidence Score, Timestamp, Expires At. | **Archive after verified cutover** (D6). Do not edit before. |
| 3 | [MPT API Rate Limit Tracking](https://app.notion.com/p/386b6576776b4fa785637786e5cc1152) (DB) | Write destination for counters. | Archive after verified cutover. |
| 4 | [MPT Channel Metrics](https://app.notion.com/p/9cffd646cda9456e9974167b29d750ba) (DB) | Write destination for channel metrics. | Archive after verified cutover. |
| 5 | [MPT User Engagement](https://app.notion.com/p/392c20a422674c28a3fd5482657ae96a) (DB) | Engagement rows. Supabase `mpt_user_engagement` is written by the `mpt-leads` Worker, not by this tool (not in the tool's three-table allowlist). | **Decide separately**; leave as is for this cutover. |
| 6 | [MPT Channel OSINT Targets](https://app.notion.com/p/fa30e94f599740c7a3a85504cd736ff5) (DB) | Read-only reference (viability, endpoints, rate limits). Not a write target. | None. Keep. |
| 7 | [MyPrivacyTOOL project page](https://app.notion.com/p/32728547eaa7814f8c50c123236e6bd0) | Status line: "Scan results, rate limits and channel metrics are still Notion-backed (follow-up task to migrate)". | **Edit** the status line after verification. |
| 8 | [MPT Infrastructure (Ops)](https://app.notion.com/p/3f028547eaa78111a3ccedb229063ed8) §6, §8 | "Agent instructions that still say 'write to Notion' are being cut over under MPC-6965 (Q11)". | **Edit** §6 and §8 after verification. |
| 9 | [MPC-6965 task page](https://app.notion.com/p/3eb28547eaa78161b06bdb0a16b960f2) | Task record and history. | Append result and state word; do not rewrite. |
| 10 | `agents/myprivacytool/*` in `krispyking/openclaw26` (not Notion) | Per MPC-6965: only a generic Notion rate-limit line at `TOOLS.md:42`. | **Inspect from a krispyking-attached session** (`grep -rn -i "notion\|scan results\|rate limit tracking\|channel metrics" agents/myprivacytool`). Any hit is a write instruction to replace. |

## Checked, no write instructions

- [🤖 AI START HERE — MyPrivacyTOOL Project](https://app.notion.com/p/3e928547eaa7813cae96db8639eff69c): reading order and agent roles only.
- [Project — myprivacytool — Agent Workspace](https://app.notion.com/p/32028547eaa781f69ae7f72c20d1d86d): index of sub-pages, empty Plans/Logs/Tasks sections.

## Not checked (could not be reached or too large to read in full)

- The ~100 child pages of the MyPrivacyTOOL project page were only listed by title; none looked like an agent-instruction page. Pages whose title mentions agents or tools: "Website Autonomy — GitHub + Cloudflare Setup & Policies", "STANDING_OBJECTIVES — MyPrivacyTOOL", "MyPrivacyTOOL — Technical Infrastructure & Codebase Reference". Search these for the strings in row 10 before cutover.
- Anything the router injects into the agent's context at run time.

## Open question for the owner

Which of rows 1 and 10 is the agent actually driven by? If row 10 is empty of Notion write lines, the prompt may be composed from rows 1 and 7. Settle this before cutover; the answer decides which pages in `agent-instructions-v2.md` are applied.
