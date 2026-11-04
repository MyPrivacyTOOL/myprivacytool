# Site and launch decisions, batch 2 (owner, 2026-10-29)

The owner answered **Y to all ten** proposals.

| # | Decision | Effect |
| --- | --- | --- |
| 1 | Keep maroon, amber and pale teal for risk on the `/hexagon/` pages, with the H, M or L letter always shown. `/footprint/` tiles keep their own meaning colours; risk never uses the red that means "detected". | No change. |
| 2 | Show all 368 hexagons to everyone on `/footprint/` and `/hexagon/`; unbuilt ones are labelled "Not checked by MPT yet". Do not hide channels by visitor. | No change. |
| 3 | Leave the "Paid" access label on the 10 mapped X rows. X's Account Activity API is being deprecated and has paid tiers, so "free" is not claimed without confirmation. | No change. |
| 4 | The Full Discovery list stays a menu, not an approved spec. Approved: the risk tiers, the 101 built, and the batch 1 scope decisions. | No change. |
| 5 | The look of `/hexagon/`, `/hexagon/webrtc-leak/` and `/footprint/` is approved as it is. | Any later visual change is a new request. |
| 6 | All extras stay outside every score and count; no new score version now. Revisit after the Telegram test has run. | No change. |
| 7 | The generated "what it could be used for" text may stay live. The 14 share-list pages are rewritten by hand and tagged "Text reviewed 2026-10-29". | Done: `scripts/hexagon-reviewed-copy.mjs`. |
| 8 | Marketing starts with three posts: `webrtc-leak`, `name-in-your-address`, `at-username` (the three MPT really checks today). The other 11 wait until their channels run. | Share list order. |
| 9 | The next piece of work is the Telegram end-to-end test (`docs/extras-go-live.md`), using the owner's test account. | Needs the account id. |
| 10 | Merge the two docs PRs (#658 runbook and share list, #660 scope decisions) when their checks are green. | Both were green; the merge call was blocked by a permission check and has not been done. |

## What the review of decision 7 found
The generated text is picked by keyword and was wrong for several of the 14: it mentioned SIM-swap fraud for a voice note, a voice call and a fax header, stalking visits for an email address, and "contacting or impersonating the person" for facts that do not support it. The reviewed text says only what each fact supports, adds specific things to do, and a test keeps SIM-swap to the two pages about a phone number that can be a login. The other 354 pages still use the generated text; the owner's rule is that nothing is posted about a page until that page has been read.
