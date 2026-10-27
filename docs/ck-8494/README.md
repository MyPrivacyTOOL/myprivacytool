# CK-8494: one verified customer action and re-check (WebRTC Leak, web scan)

Status: MERGED (PR #543, `574554e`) and deployed with the site; follow-up fixes in PR #599 after the independent review. SYNTHETICALLY VERIFIED only. **Production: UNVERIFIED / PENDING.**
Exposure: PR #543 put the journey behind the existing `?hex_v2=2` URL parameter, which any visitor can add on production, so it was dark-launched, not inert. The follow-up gates it behind a **build-only** flag `VITE_RECHECK_JOURNEY` (default off, no URL parameter). CI's build job sets it so the trace spec can run; the Cloudflare Pages production build does not. Turn it on only after the copy review, the MPC-7725 real-people check and CK-8492 evidence.

## Selected finding and why
`webrtc-leak` is the only hexagon that can turn red, that the visitor can act on themselves in their browser, and that the same in-page detector can read again.
The other three red-capable hexagons (canvas, WebGL, audio fingerprints) have no stable "clear" state: a protective browser randomises them, so two readings differ for reasons that say nothing about exposure. They were not chosen.
WhatsApp settings are API-blind and were not considered.

**Choice approval:** the registry says WebRTC cannot tell "nothing visible" from "could not look" (`detection_change_to_make_checkable`). Making it checkable needs a detector change, which this task forbids inventing without approval. Approval to add distinct, versioned WebRTC states was given by the task owner in this session (recorded as the answer "Approve WebRTC detector change"; a dated Notion decision record is to be added in the Strategic Decisions Index).

## What was added (only the missing links)
| Piece | File | Notes |
|---|---|---|
| Distinct outcome + detector version | `src/lib/fingerprintDetection.ts` | additive `state` / `detectorVersion`; all old fields unchanged. Version `webrtc-state-1`. |
| Comparison + saved journey | `src/lib/recheck/webrtcRecheck.ts` | pure `compare`; browser-only storage, 7-day expiry, analytics-choice gated, purged on withdrawal. |
| Panel | `src/components/hexagon/RecheckPanel.tsx` | shown under the existing next-step card. |
| Wiring | `src/components/HexagonGrid.tsx`, `src/lib/deviceDetection.ts`, `src/config/recheckJourney.ts` | one component, one optional field, one build-only flag. |

Reused, not rebuilt (note: there is no server ledger, but a small browser-side record store, `mpt_recheck_v1`, is new): hexagon registry, honest tiles (`hexagonTile.ts`), next-step card and fix step (`hexagonFix.ts`), the analytics cookie gate (`cookieConsent.ts`). **No** new ledger, identity, server route, migration, event type or retention.

## Evidence kept separate
| What | Where in the saved record |
|---|---|
| Original observation | `baseline` (state, detectorVersion, browser family, time). Written once, never replaced. No address is stored. |
| Detector and version | `baseline.detectorVersion`, `rechecks[].observation.detectorVersion` |
| Consent and scope | `consent` (analytics choice date). Record is deleted when the choice is withdrawn. |
| User response | Later or a closed prompt is deliberately not stored (the existing next-step card says Later is not a "no"); the only response kept is the self-report. The independent review flagged this as only partly meeting "preserve user response separately". |
| Self-reported completion | `selfReport.at` (their word, labelled as such) |
| Re-check observation | `rechecks[].observation` |
| Comparability + outcome | `rechecks[].comparison` (`outcome`, `reason`) |

## Outcome rules (one pure function, `compare`)
- improvement: baseline `found`, re-check `none_found`, same detector version, same browser family.
- no change: re-check still `found`.
- inconclusive: re-check `blocked`, `timed_out` or `unsupported`.
- incomparable: no baseline, baseline was not `found`, different version or browser.
- error: the re-check itself failed.

## Observation limits (stated to the user and here)
- One reading, in one browser, on one network, at one moment. A VPN or network change can alter it.
- `none_found` means the gathering finished with at least one candidate and none was public. If the network blocks the STUN lookup, a leak could be missed; the copy does not claim protection.
- Turning WebRTC off entirely usually gives `unsupported` or `blocked`, which is reported as inconclusive, not as improvement. This is deliberately conservative.
- The tile itself is unchanged: the registry still treats "No Leak Detected" as not checked, so after an improvement the tile stays grey and only the panel carries the claim. Changing the registry's status rules is a separate approval.
- The page never changes the visitor's account or settings. The visitor does the step; the copy says "you made the change".

## Tests (actual results, 2026-10-26, local container)
- `vitest run src/lib/recheck src/components/hexagon/RecheckPanel.test.tsx`: 34 passed (22 + 12).
- `vitest run` (whole suite): 152 files, 1593 tests passed.
- `eslint` on touched files: 0 errors (2 existing warnings in files I did not change materially).
- `tsc -p tsconfig.app.json --noEmit`: clean.
- `playwright test e2e/recheck-trace.spec.ts --project=desktop`: 1 passed.

Cases covered: improvement, no change, inconclusive (blocked, timed out, unsupported), incomparable (version, browser, no or non-found baseline), re-check error, missing consent, withdrawal (a later re-grant does not revive an old record), duplicate/replayed self-report, replayed re-check (a press within 3 s of the last counts once, using clock-built reading times), re-check refused without the visitor's word, re-check cap, a closed prompt stores no response and offers no re-check, a reload records nothing by itself (the visitor presses Check again), expired and damaged and deleted state, storage failures, and "no address or identifier in stored data".
Persisted state is read back from the real (jsdom / Chromium) `localStorage`, not from returned objects.
Isolation: no backend is involved at all. The e2e blocks every non-localhost request, and the trace asserts zero lead, database and `/api/learning` requests by watching every request the page makes. Limits: the independent reviewer could not re-run the Playwright trace (no browser in its sandbox) and shares a model family with the author; a human must still re-run `e2e/recheck-trace.spec.ts`. There is nothing to be backed by production.

## Synthetic browser trace
`docs/ck-8494/trace/trace.json` plus `trace/*.png`. Regenerate with `npx playwright test e2e/recheck-trace.spec.ts --project=desktop`.
**SYNTHETIC**: scripted fake `RTCPeerConnection`, fresh browser profile, no backend. It shows the real built UI, the real state rule and the real persisted state at each step: observation, explanation, own-word self-report, an inconclusive re-check, a comparable improvement, no network send, withdrawal deletes everything. It is not live proof.

## Metrics contract (MPC-7911 / CK-8493), nothing built here
No new server events. The saved record is local, so nothing is aggregated today. To count this loop CK-8493 needs a purpose-specific event, which belongs to CK-8492's validated consent/event path. Proposed fields, all already in this record and none sensitive:
`hexagon_id`, `detector_version`, `outcome` (`improvement|no_change|inconclusive|incomparable|error`), `self_reported` (bool), `recheck_count`.
Counting rules to keep: report self-reported completion separately from verified improvement; verified improvement rate = improvement / valid comparable re-checks (outcomes other than `incomparable`, `error`); re-check coverage = comparable re-checks / self-reported attempts. Denominators and exclusions must accompany every figure. No dashboard is created here.

## Copy review package (for MPC-7725's existing real-people process; no participants recruited or contacted)
All strings are in `src/lib/recheck/webrtcRecheck.ts` (`OUTCOME_COPY`) and `src/components/hexagon/RecheckPanel.tsx`. DRAFT wording, English only, needs the owner's review before any switch-on.
1. What was observed: "First reading: a public address was visible to this page (saved in this browser only, not the address itself)."
2. What cannot be observed: one browser, network and moment only; a blocked or unfinished check is never read as "nothing found" (stated in the inconclusive and incomparable texts and the improvement text's scope sentence).
3. Why the step may help: the existing fix step text (`hexagonFix.ts`, already draft): WebRTC can reveal the real address even behind a VPN.
4. What the visitor controls: they decide to do the step, press "Check again", and can press "Forget this check" at any time; without the analytics choice nothing is saved and the panel says it cannot compare.
5. What a re-check can and cannot establish: it shows what this page could see this time; it does not show the address is hidden everywhere.
6. Every outcome has its own text: improvement, no change, "We couldn't tell", "These two readings can't be compared", "The re-check did not work". None mentions a score, a percentage, safety or protection (a test enforces this).
Questions for real people: do they read "improvement" as "I'm now safe"? Do they understand why saving needs the analytics choice? Is "Forget this check" clear? Which outcome text is confusing?
Status: PENDING real-people review under MPC-7725 and owner approval.

## Remaining approvals / gates (none granted by this work)
- CK-8492 is "Not started" with no evidence: consent/event path, release gates and persistence are unproven. Production activation stays blocked.
- Owner review of draft copy; MPC-7725 real-people check.
- Any server-side outcome event, migration, flag activation, merge-to-deploy and the first live end-to-end run.
- Independent reviewer acceptance of the artifact-to-acceptance mapping: PENDING, not self-certified.
- Registry status change so the tile itself can show "clear" after a verified none_found (separate decision).
