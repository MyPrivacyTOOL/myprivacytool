# MPC-9804 (EXT-17): entry-page hierarchy, literal instructions, action outcomes

STEP 0 on main 136b24b + the live site, 2026-11-18. Stacked on PR #827 (MPC-9806), which also edits /scan and /start.
Live audit: desktop 1280x800 and mobile 390x844 screenshots of /, /start, /scan, /scan/live, /report (GET only).

| # | Item | At HEAD / live | After this PR |
|---|------|----------------|---------------|
| 1 | Visual audit | DONE (10 screenshots). Findings: (a) on /, a full-screen device reveal ("Linux PC / We know because / See everything we found") covers the headline, consent block and intro for a first-time visitor; (b) the cookie banner covers the lower fifth of every page on first visit; (c) /scan/live is a one-paragraph "Open the button in your email" page; (d) /scan primary action (email box, Check My Exposure) is clear | (a) not changed: product decision, MPC follow-up |
| 2 | UX-045 literal product sentence above the hexagon instructions | STILL OPEN: the intro began with "MyPrivacyTOOL: Each hexagon is a data point..." (or "Click the ones that are correct") | One sentence first: "MyPrivacyTOOL shows you what any website can learn about you from your browser and device, and what you can do about it." The reveal overlay still sits on top for first-time visitors (finding 1a) |
| 3 | UX-043 /scan vs /start vs F1 behaviour | STILL OPEN: /scan said "Check your exposure to see where your information may be listed"; /start said no broker search | /scan: "We do not search broker sites for you yet. If you show us a page that lists you, we check it, and our step-by-step guides show how to have it removed." (matches F1: a pasted page only). The coverage note from #827 sits below |
| 4 | COPY-020 /start "Join the list" vs report promise | ALREADY DONE: Start.tsx:161 says joining signs you up for updates only, does not run a scan or send a report, and points to /scan for the report (the 5-minute promise belongs to the scan path) | none |
| 5 | COPY-021 "Get clean" headline (Q12, Chris 2026-11-18) | STILL OPEN on / (teaser) and /journey (H1 and title) | "See what's out there about you, and what an AI agent could find." on both; no certification wording; tested |
| 6 | UX-020 plain structured results view beside the hexagons | STILL OPEN: no table or list of results on the home page (the emailed report has one) | not built: follow-up task |

Flag-off DOM snapshots (home, scan) updated; the diff was checked to contain only the changes above.
Screenshots: /tmp/claude-0/-home-user/1cbe026f-174b-52bc-bc0f-ded24d2d0200/scratchpad/shots (session scratch, not kept in the repo).
