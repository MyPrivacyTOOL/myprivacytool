# MPC-8452: live thank-you page (as shipped)

Ticket: https://app.notion.com/p/40228547eaa781c4874ed5b7c0e4f2df

This note first proposed three options (A replay the browser scan, B live email checks, C both). The owner approved A on 2026-10-23, but the same week main shipped the server-backed path (B) in #502 and #508, so the A component was dropped (closed PR #498; it stays in that branch's history). **This version describes what is live, and what is still unverified or unapproved.** The earlier proposal is in this file's git history.

## What visitors get

| Step | What happens | Code |
|---|---|---|
| 1. Form | Unchanged `/scan` form. Submit sends the lead to HubSpot and `POST /api/scan` to the report Worker. | `src/pages/Scan.tsx` |
| 2. Thank-you | The existing box stays ("Thanks, we have your email."). If the Worker returned a `liveToken`, the live panel appears under it. No token (Worker off, error): nothing extra, the report email still arrives. | `Scan.tsx` |
| 3. Curtain | Alice's picture (`/footprint/alice-curtain.jpg`) sits behind a cover that slides away over 2.6 s. Reduced motion: the cover is hidden (`motion-reduce:hidden`). | `LiveScanPanel.tsx` |
| 4. Checks arrive | The page polls `GET /api/scan/live?t=<token>` every 3 s (up to 100 polls, about five minutes; a hidden tab asks nothing). Each check the Worker has finished is listed as "Found something", "Nothing found" or "Could not check this one". Results are never taken away once shown. | `LiveScanPanel.tsx`, `src/lib/liveScan.ts`, `workers/scan-report/lib/live.js` |
| 5. Done | Alice: "That is what I can see from the outside. The full picture is on its way to your inbox." | `LiveScanPanel.tsx` |
| 6. Email button | The confirmation and report emails carry a button to `/scan/live#v=<key>`. The key is in the URL fragment (never sent to a server), read into memory and removed from the address bar. Opening it proves inbox ownership, so found checks then show their detail, and the page keeps watching (every 30 s for about an hour). A refresh needs the button again. | `src/pages/ScanLiveView.tsx` |
| 7. Left early | Nothing to do. The report pipeline is unchanged and still emails the report. | Worker |

Alice's lines as shipped (all marked in code as first draft, needing Chris's approval): "Hold on, I am having a look behind the curtain." / "I have found something. I am still looking." / "That is what I can see from the outside. The full picture is on its way to your inbox." / "That is what I can see so far. I will keep watching and add anything new." / "This link has expired. Press the button in your email again, or run a new scan."

## Rules this meets

- **Honesty:** every line is a real check result from the Worker; a failed or timed-out lookup is "Could not check this one", never "Nothing found". No score and no percentage.
- **Privacy:** the first view shows what was checked and whether it found something, never the value. Values show only after the inbox is proven. Nothing about the visitor is in a URL or stored in the browser (token in memory only). No third-party script added.
- **Fallback:** if the visitor leaves, the emailed report arrives as before.
- **Accessibility:** `role="status"` for Alice, a polite live list for results, a screen-reader-only heading, status words (not colour) carry meaning, motion off for reduced-motion.

## Differences from the first proposal

- The live list shows the **email checks the Worker runs**, not a replay of the 54 browser hexagons, and there is no per-hexagon "waiting" grid or summary count. The picture is the existing 160 px curtain image, not a new Alice plate.
- Polling replaces the proposed stagger, so what appears is paced by the Worker.
- Phone layout is a single column list; whether 54 browser hexagons should ever be added is no longer a question for this ticket.

## Not yet verified or approved

1. **Chris's approval** of every line above, the email paragraphs and button wording, the new hexagon labels and the Privacy text. The swarm run and real-people check (PR checklist) have not been done for this ticket.
2. **A run on the production site** on a phone and with reduced motion. A scripted attempt on 2026-10-26 from the build sandbox could not finish: the sandbox blocks HubSpot and Cloudflare Turnstile, and the Worker answered the request with 403 (most likely because no Turnstile token could be sent). Nothing was sent or created by that attempt. Someone needs to do it by hand: submit `/scan` with a `+test` alias, watch steps 3 to 5, press the email button, and repeat with the OS "reduce motion" setting on.
3. **Tier 2 checks** (plain address to a third party) are covered in `docs/osint-list-mpc-8452.md`.
