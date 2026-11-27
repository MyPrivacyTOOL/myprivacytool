# exposure-v2: the email channel's 7 hexagons move into the scored set (MPC-11569)

Status: **built and tested, NOT deployed.** The task carries `Requires_Human_Signoff`. Merging deploys the scan-report Worker and the site, so nothing here is merged until Chris says so.
Scope of this run: email only. Telegram (30) and X (10) are not started.

Code: `shared/hexagon-registry/score-v2.js` (+ `.d.ts`, `score-v2.fixtures.mjs`, `score-v2.test.mjs`). `score.js` (exposure-v1) is not edited and still scores exactly the 54.

## What v2 is
- Scored set = 54 web hexagons + the 7 `EMAIL_HEXAGONS` = **61** (asserted in `score-v2.test.mjs`, `SCORED_TOTAL_V2`). `scanCounts`, `HEXAGON_COUNT` (54) and the Notion hexagon registry are untouched.
- Same maths as v1 (severity from `truth.sensitivity`, exact BigInt arithmetic, half-up, same bands, not-checked is neither clear nor found).
- The seven form one new category, `email`, weight **10 (PROPOSED, needs Chris's approval; it is the only new number)**. v1's nine weights are unchanged. Weights are renormalised over the categories present, so **a scan with no email result scores exactly what v1 scores** (tested over 500 seeded scans). Only coverage differs (same checks over 61).
- A check that is not built can never move the score (`not_built` demotion), so `email-breaches` is in the 61 but only ever lowers coverage.

## The 7 checks: what is genuinely Live
Evidence is a counts-only read of production `signals` (category `email`) on 2026-11-27. No address or value was read. `clear` is a real answer (the source answered and listed nothing); `not_checked` never counts.

| Check | Badge | Needs a forwarded message? | Evidence |
|---|---|---|---|
| email-name | Live | No | 15 scans, 2026-11-07 to 2026-11-27, all `clear` (pure logic in our Worker) |
| email-provider | Live | No | 15 scans, all `found` (DNS answered; informational, always found) |
| email-profile (Gravatar) | Live | No | 15 scans, all `clear` (404) |
| email-libravatar | Live | No | 15 scans, all `clear` (404) |
| email-domain-record (RDAP) | Live | No | 15 scans, all `clear` |
| email-github-commits | Live | No | 3 scans, all `clear`; switch `EMAIL_GITHUB_COMMITS_ENABLED` is on in `wrangler.toml` |
| email-breaches | **In build** | n/a | Never run: not built (MPC-7467), owner decision MPC-8589 option A keeps it not checked, access Paid, **0 production rows** |

Findings to know before signing off:
1. **6 of the 7 are Live, not 7.** The task row said all 7 were built and probed (MPC-11543). They are not: `email-breaches` is not built, and MPC-11543 probed the four email *extras* (alias, address type, tools the domain uses, mail transport protection), not these seven. The evidence above is production data, not that probe.
2. **None of the 7 needs the user to receive and forward a message.** All run on the address typed at first contact. The forward-dependent ones are the "If they email us" items (not built, not in the 7) and the Telegram forward/story/via-bot ids (batch 2). So no email check is held In build for that reason.
3. **The evidence is thin on findings.** Only `email-provider` has ever returned `found`; the other five returned `clear` on every scan (15 scans, 3 for GitHub), and the scans may be mostly our own test traffic. They are observed running and answering, which is what the rule asks, but none has been seen returning a finding in production. Chris can tighten the rule.
4. **Coverage falls for everyone** (see the table): the same web checks over 61 instead of 54. That is a second number that can read as a regression, and it is explained by the same sentence.
5. **`email-provider` is informational and always `found`.** In v2 it adds an exposed item to every email scan's email category (severity 2), which lifts a light scan's score (fixture B: 29 Low to 44 Medium on that one check). That is the weighting proposal, not a bug; it is the main thing to review in the email weight.

## Before / after (same fixture, v1 vs v2)
Fixtures (`score-v2.fixtures.mjs`): **A** a complete web scan (every checkable item found, the five clearable ones clear, the 7 uncheckable not checked); **B** a light web scan (device and language found, clearable storage/security clear, nothing else checked). Email statuses are what production returned. v1 cannot see an email id (`unknown_id`).

| Fixture | Email check (status) | v1 score / band / coverage | v2 score / band / coverage | Why it differs |
|---|---|---|---|---|
| A complete web scan | email-breaches (not_checked) | 83 / high / 47/54 (87%) | 83 / high / 47/61 (77%) | v1: unknown id, ignored. v2: in the 61 but never checked (not built), so score is unchanged and only Z grows |
| A complete web scan | email-name (clear) | 83 / high / 47/54 (87%) | 74 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -9 because the email category joins the weighted mean |
| A complete web scan | email-provider (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-profile (clear) | 83 / high / 47/54 (87%) | 74 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -9 because the email category joins the weighted mean |
| A complete web scan | email-libravatar (clear) | 83 / high / 47/54 (87%) | 74 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -9 because the email category joins the weighted mean |
| A complete web scan | email-domain-record (clear) | 83 / high / 47/54 (87%) | 74 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -9 because the email category joins the weighted mean |
| A complete web scan | email-github-commits (clear) | 83 / high / 47/54 (87%) | 74 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -9 because the email category joins the weighted mean |
| A complete web scan | ALL 7 together | 83 / high / 47/54 (87%) | 76 / high / 53/61 (87%) | v1 ignores all seven; v2 scores six of them, breaches is never checked |
| A complete web scan | no email result | 83 / high / 47/54 (87%) | 83 / high / 47/61 (77%) | no email check ran: same score; coverage falls because Z is 61, not 54 |
| B light web scan | email-breaches (not_checked) | 29 / low / 14/54 (26%) | 29 / low / 14/61 (23%) | v1: unknown id, ignored. v2: in the 61 but never checked (not built), so score is unchanged and only Z grows |
| B light web scan | email-name (clear) | 29 / low / 14/54 (26%) | 22 / low / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -7 because the email category joins the weighted mean |
| B light web scan | email-provider (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-profile (clear) | 29 / low / 14/54 (26%) | 22 / low / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -7 because the email category joins the weighted mean |
| B light web scan | email-libravatar (clear) | 29 / low / 14/54 (26%) | 22 / low / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -7 because the email category joins the weighted mean |
| B light web scan | email-domain-record (clear) | 29 / low / 14/54 (26%) | 22 / low / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -7 because the email category joins the weighted mean |
| B light web scan | email-github-commits (clear) | 29 / low / 14/54 (26%) | 22 / low / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (clear); score -7 because the email category joins the weighted mean |
| B light web scan | ALL 7 together | 29 / low / 14/54 (26%) | 26 / low / 20/61 (33%) | v1 ignores all seven; v2 scores six of them, breaches is never checked |
| B light web scan | no email result | 29 / low / 14/54 (26%) | 29 / low / 14/61 (23%) | no email check ran: same score; coverage falls because Z is 61, not 54 |

If each email check had instead **found** something (shows the direction a finding moves the score):

| Fixture | Email check (status) | v1 score / band / coverage | v2 score / band / coverage | Why it differs |
|---|---|---|---|---|
| A complete web scan | email-name (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-provider (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-profile (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-libravatar (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-domain-record (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | email-github-commits (found) | 83 / high / 47/54 (87%) | 85 / high / 48/61 (79%) | v1: unknown id, ignored. v2: counted in the email category (found); score +2 because the email category joins the weighted mean |
| A complete web scan | ALL 7 together | 83 / high / 47/54 (87%) | 85 / high / 53/61 (87%) | v1 ignores all seven; v2 scores six of them, breaches is never checked |
| A complete web scan | no email result | 83 / high / 47/54 (87%) | 83 / high / 47/61 (77%) | no email check ran: same score; coverage falls because Z is 61, not 54 |
| B light web scan | email-name (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-provider (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-profile (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-libravatar (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-domain-record (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | email-github-commits (found) | 29 / low / 14/54 (26%) | 44 / medium / 15/61 (25%) | v1: unknown id, ignored. v2: counted in the email category (found); score +15 because the email category joins the weighted mean |
| B light web scan | ALL 7 together | 29 / low / 14/54 (26%) | 44 / medium / 20/61 (33%) | v1 ignores all seven; v2 scores six of them, breaches is never checked |
| B light web scan | no email result | 29 / low / 14/54 (26%) | 29 / low / 14/61 (23%) | no email check ran: same score; coverage falls because Z is 61, not 54 |

Regenerate: `node scripts/exposure-v2-before-after.mjs` (add `--if-found` for the second table).

## Badges (catalogue export)
`tileState.js`: Live = the 54 web checks + `LIVE_EMAIL_IDS_V2` (6). `node scripts/build-hexagon-catalogue.mjs` regenerated `public/footprint/hexagons-366.json`: **650 published, unchanged**; badges Live 54 to 60, In build 137 to 131, Planned 459 unchanged. `email-breaches` stays In build.

## The user-facing sentence
> We now check more things than before, so your score can change. You did not become more exposed.

Shipped in: the report JSON (`exposure_v2.explanation`), the live results page (`LiveScanPanel`, once results are in, where the email checks appear), the method page `/how-we-calculate-your-score` (new section), and the release notes (`docs/release-notes/2026-11-27-exposure-v2.md`). The report email body gets no score line (wording not approved, MPC-7471-F4). The in-browser scan page before an email is given holds no email result, so its number cannot change from this release; its coverage stays out of 54 (it reads `scanCounts`, untouched).
Wording is DRAFT until Chris approves it (as for every score sentence in this repo).

## Not done / left for Chris
- Approve the email weight (10) and the sentence.
- Merge and deploy (held: moves every email user's report score; deploys scan-report and the site).
- Telegram 30 and X 10: not started, by instruction.
- Notion row MPC-11569 not edited by this run.
