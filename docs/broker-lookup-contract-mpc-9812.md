# Broker lookup: checker contract and source shortlist (MPC-9812)

Status: **DESIGN. No code is changed by this document.** Build is MPC-9813, display is MPC-9814.
Decisions: Chris Ransford, 2026-11-07 (build spine, section 6, items 2 and 5; Tier & Service Matrix MPC-9834).
Claims this makes true when built: ledger C04, C05, C42 (and C24a for the broker part).

## 1. Rules that govern the contract

1. **Pricing principle.** If MPT pays a third party for a check, it is a paid-tier service; if it costs MPT nothing, it is free. So there are two *source classes* behind **one contract**:
   - `free` sources run in every scan (Free and up).
   - `licensed` sources (a paid broker-data API) run only for Basic ($7.99) and above.
2. **Full report from Basic.** Free users see free-source results in full; Basic and up see licensed results in full. There is no redacted or headline-only rendering. A source that did not run for the plan is `not_checked`, with a reason.
3. **Three states, always.** Every broker in the registry gets exactly one of `listed`, `not_listed`, `not_checked`. `not_checked` is a normal result, never an error, and always says why.
4. **Always honest, sometimes guessing, never lying.** Every result carries a `source` and, if it claims anything, a `confidence`. A fuzzy match is labelled a guess in the user's words.
5. **Mirror, not tracker.** Only identifiers the submitter typed about themselves are used (section 5). Nothing is looked up in the background, and nothing for anyone else.
6. **Cost cap per scan, not per account.** The licensed source stops when the scan's cap is reached; the remainder is `not_checked`.

## 2. What exists today (why this shape)

- `workers/scan-report/lib/brokers.js`: `BROKERS` has 5 entries (Spokeo, Whitepages, BeenVerified, MyLife, Intelius); `CHECKERS = {}`; `checkBrokers(email, env)` returns every broker as `not_checked` with a fixed reason. Only 3 of the 5 have an opt-out guide.
- The form collects an **email address only**. People-search sites search by name and place, so email alone can never drive them. Any real check needs new, optional, self-declared inputs (section 3).
- `processScan` writes one `signals` row per broker (`category: 'broker'`, `check_status` currently always `not_checked`) and passes `brokers` to `buildMirrorReport` and `buildReportEmail`.
- `email.js` only renders the broker section when an email-name hexagon was found (`brokersRelevant`) and says "We have not searched these sites". That text and condition must change in MPC-9814.
- `src/data/optOutGuides.json` has 12 guides; people-search/directory ones: spokeo, whitepages, truthfinder, fastpeoplesearch, beenverified (US); australia-white-pages-listing, truecaller-unlist-number (APAC). The HK/SG/AU DNC registers and the HK PDPO s35G opt-out are *registers or rights*, not brokers: they stay as guides but are not checkers.
- `workers/social-listeners/src/records-check.ts` (MPC-8689, off by default) already implements the safest free method: the person supplies the exact page address, we fetch that one page and look for their own text locally, and block/timeout is `not_checked`, never `clear`. F1's free class reuses this rule set.
- Hexagon `brokers.people_search_listing` exists with status `new`. F1 keeps broker results **outside the exposure score** until Chris approves a new score version.

## 3. Contract

### 3.1 Input (`BrokerLookupInput`)

| Field | Required | Source | Note |
|---|---|---|---|
| `scan_id` | yes | scan row | |
| `plan` | yes | `free` / `basic` / `pro` / `executive` (today always `free` until F3) | selects source classes and cost cap |
| `email` | yes | scan | must be a *confirmed* address (section 5, gate G1) |
| `full_name` | for name-driven sources | new optional field, typed by submitter | the name as it would be listed |
| `city`, `region`, `country` | for name-driven sources | new optional field, typed by submitter | `country` in HK/SG/AU/US |
| `phone` | for phone-driven sources | new optional field, typed by submitter | E.164 |
| `listing_urls` | optional | submitter pastes their own listing page, per broker | free class, "check this page" method |

A missing required input gives `not_checked` / `input_missing` for that source, never a guess.

### 3.2 Output (`BrokerResult`, one per registry broker, always the full list)

```
key, name, region                  // from the registry
state: 'listed' | 'not_listed' | 'not_checked'
match: 'exact' | 'probable' | 'possible' | null     // null unless listed
confidence: 'high' | 'medium' | 'low' | null        // null when not_checked
is_guess: boolean                  // true when match is 'possible' (state stays 'listed' only if the user must verify)
source: { class: 'free' | 'licensed', provider, method, checked_at } | null
evidence_url: string | null        // listed: the page or record; not_listed: the search page we used; not_checked: null
not_checked_reason: 'not_in_free_coverage' | 'source_unavailable' | 'rate_limited' | 'input_missing' | 'cost_cap_reached' | null
guide: { slug, optOutUrl, timeNeeded, processingTime, steps } | null   // always attached when a guide exists
```

`not_checked_reason` covers Chris's three reasons (`not_in_free_coverage`, `source_unavailable`, `rate_limited`) plus two honest additions the build needs: `input_missing` and `cost_cap_reached`. Flagged for confirmation (section 8).

### 3.3 When each state may be returned

- `listed`: the source returned a record or page for the submitted identifiers. `exact` = name + place both match; `probable` = name matches and the place is nearby or partial; `possible` = name only. A `possible` match is shown as "possible match, we are guessing, check the link".
- `not_listed`: **only** when the source answered normally and returned zero matches for the submitted identifiers (page loaded and search ran; or the licensed API returned its documented "no record" answer). Wording in the report: "No match for the details you gave, on <date>". It never means "you are not on the internet".
- `not_checked`: everything else, including bot protection, challenge pages, timeouts, partial pages, unsupported country, or a source that is not part of the plan. **A block or failure is never `not_listed`.**

### 3.4 Interface

```
checkBrokers(input: BrokerLookupInput, env, ctx): Promise<BrokerResult[]>
```
Replaces `checkBrokers(email, env)`. Never throws. Returns the full registry list in registry order. Sources are registered in a `SOURCES` map keyed by broker key, each `{ class, run(input, env, fetchImpl) -> partial result, cost_cents, rate }`. Pure functions with injected `fetchImpl` so it is testable like `hibp.js`.

### 3.5 Limits and failure behaviour

| Item | Rule |
|---|---|
| Per-source timeout | 8 s (same as records-check) |
| Whole broker step budget | 25 s; sources run with a concurrency of 3; remainder `source_unavailable` |
| Rate limits | per-source `min_interval_ms`, paced like `hibp.js`; a 429 is retried once with `Retry-After`, then `rate_limited` |
| Re-run | `rate_limited` sources are retried on the next 5-minute run, at most 2 times. After that the report is **sent** with `rate_limited` shown. Unlike HIBP, brokers never hold the report. |
| Cost cap | `BROKER_COST_CAP_CENTS` env, per scan, applied to licensed sources only, checked before each paid call. Free plan cap is 0 by definition. Value set after vendor pricing (section 8). |
| Idempotency | a retry of the same scan reuses results already stored for that `scan_id`; a paid source is never called twice for one scan |
| Failure | any exception becomes `not_checked` / `source_unavailable` for that broker only |
| Storage | one `signals` row per broker: `listed` to `check_status: found`, `not_listed` to `clear`, `not_checked` to `not_checked`; vendor payloads are **not** stored, only the result fields above; kept and deleted with the scan (12 months) |

## 4. Source classes and shortlist

**Method key.** `U` = user-supplied page address, we read that one page locally (free). `P` = automated public search page (free, only if the site's terms allow). `L` = licensed broker-data API (paid class). `—` = no lawful automated method found.

**Honesty limit of this document.** The terms of each site could not be read from the design environment (outbound access is restricted, and a search for them returned nothing authoritative). Nothing below is claimed as "permitted" from memory. `P` is therefore **not cleared for any broker**; it stays `needs terms review` until MPC-9813's first step reads each site's current terms and records the URL and date. The existing `brokers.js` comment records the same position (terms prohibit automated lookups, bot protection present).

| # | Broker | Region | Guide | Free class (every scan) | Licensed class (Basic+) | Inputs | Cleared for T2 |
|---|---|---|---|---|---|---|---|
| 1 | Spokeo | US | yes | `U`; `P` needs terms review | `L` if vendor covers it | name, state | `U` yes; `L` pending vendor |
| 2 | Whitepages (US) | US | yes | `U`; `P` needs terms review | `L`: Whitepages publishes a commercial API (price not public) | name, city/state | `U` yes; `L` pending vendor |
| 3 | BeenVerified | US | yes | `U`; `P` needs terms review | `L` if covered | name, state | `U` yes; `L` pending vendor |
| 4 | TruthFinder | US | yes | `U`; `P` needs terms review | `L` if covered | name, state | `U` yes; `L` pending vendor |
| 5 | FastPeopleSearch | US | yes | `U`; `P` needs terms review | none known | name, city/state | `U` yes |
| 6 | MyLife | US | **no (write one)** | `U`; `P` needs terms review | none known | name, city | `U` after guide is written |
| 7 | Intelius | US | **no (write one)** | `U`; `P` needs terms review | none known | name, state | `U` after guide is written |
| 8 | White Pages Australia (Thryv) | AU | yes | `U`; `P` needs terms review | none known | name, suburb | `U` yes |
| 9 | Truecaller | APAC (number directory) | yes | `U` is not meaningful (lookup needs sign-in); otherwise `—` | none known | phone | **No: stay `not_checked`, guide only** |

**Gaps stated plainly.**
- **HK and SG: no people-search broker was identified as a lawful automated target.** The HK/SG guides are registers and legal rights (DNC, PDPO s35G), not brokers. HK and SG users get honest `not_checked` / `not_in_free_coverage` for every US broker plus the guides. This is the correct result, not a bug, and the report must say so.
- **A licensed API reports on its own database, not on the brokers.** A "found" from a data vendor means "this vendor holds a record that matches", which is evidence of *that vendor's* listing. It may be shown as a broker's `listed` only where the vendor's data **is** that broker's data or is documented as covering it. Otherwise it appears as its own line ("Licensed data source: <vendor>") with `source.provider` named, and the other brokers stay `not_checked`. Vendor selection (sub-task of MPC-9813) must therefore start from "which vendor covers which of rows 1 to 7", with the answer written in the vendor's own documentation, not assumed.
- Candidate vendors named for that review (not endorsed, prices unverified): Whitepages commercial API (no published price), People Data Labs (third-party sources quote roughly $0.20 to $0.28 per matched person; PDL's own documentation says one credit per match). Treat both figures as unconfirmed until quoted.

## 5. Proof-of-possession and privacy gates

- **G1 Confirmed ownership.** Broker lookups run only after the submitter has confirmed the email address (confirmation link clicked). *Open check for MPC-9813:* the repo shows a confirmation email being sent (`confirmation_sent_at`) but I did not find a click-to-confirm gate. If there is none, F1 needs one, because anyone can type someone else's email today.
- **G2 Self-declared inputs.** Name, place and phone are typed by the same submitter in the same session, with the sentence "Only enter details about yourself." No import from other sources, no enrichment of missing fields, no looking up of relatives.
- **G3 Others.** Family members: only through the F3 family model with that person's own consent. Business: each employee authorises their own scan (matches F6). Never a bulk upload of names.
- **G4 Data minimisation.** Send a source only the fields it needs. Never send the email to a broker or vendor unless that source cannot work without it.
- **G5 Disclosure.** A licensed vendor is a **new third party receiving a name and place**. It must appear in Privacy, the DPA and the "who receives your data" FAQ *before* the licensed class is switched on. Handed to MPC-9828 and MPC-9829.
- **G6 Opt-out always.** Every broker row shows its opt-out guide whether listed, not listed or not checked (the existing `steps`, `time_needed`, `processing_time` fields).

## 6. Rendering rules (for MPC-9814)

- On-screen and emailed report show the **same** list of all 9 (or the cleared subset) brokers, in registry order, each with state, source line, confidence, evidence link and guide. No hiding behind `brokersRelevant`.
- Wording, per state (draft): *Listed* "We found a listing that matches what you told us (<exact/probable>). Evidence: <link>. Remove it: <guide>." / *Possible* "We are guessing: a listing that may be you. Check it: <link>." / *Not listed* "No match for the details you gave, checked <date> from <source>." / *Not checked* "Not checked: <reason in words>. You can check yourself: <search/guide>."
- `/start` line "No data broker search is included yet." is replaced by the F1 LIVE sentence once MPC-9813 ships; `/ai-access-check` shows the same broker section (C42).
- Free report shows the free-source results in full; a Basic+ report shows free and licensed results in full. A free user is told, in one plain line, that licensed coverage is part of Basic. This is an upgrade statement, not a redaction.

## 7. Test the LIVE claim (inputs for MPC-9813/9814)

1. Submit a scan with name and place on the live site; on-screen result and emailed report list at least 5 real brokers, each `listed` / `not_listed` / `not_checked`, each with an evidence link (or a stated reason) and its opt-out guide.
2. Unit tests with injected `fetchImpl`: block page is `not_checked` (never `not_listed`); 429 is `rate_limited`; missing name is `input_missing`; cost cap stops the second paid call; a thrown error affects one broker only; plan `free` never calls a licensed source.
3. A synthetic-fixture test that the signals row mapping is `found` / `clear` / `not_checked` and that a retry does not duplicate rows or paid calls.

## 8. Needs Chris (blockers for MPC-9813, none block this contract)

1. **Terms review of the US people-search sites** (`P` method). Recommendation: do not build `P` at all; use `U` for the free class and `L` for coverage. Simpler, lower legal risk, and still satisfies the three-state rule.
2. **Licensed vendor and per-scan cost cap.** Needs quotes; recommended first step is two written quotes (Whitepages commercial API, People Data Labs) and a statement of which brokers each covers. Suggested cap logic: well under one scan's share of Basic revenue ($7.99 / 5 scans = about $1.60).
3. **New optional fields** (name, place, phone) on `/start` and the email-confirmation gate G1 (see section 5).
4. **Two additional reason codes** `input_missing` and `cost_cap_reached`.
5. **HK/SG honesty line**: confirm the "no lawful automated broker for HK/SG" wording is acceptable on a page that markets HK/SG coverage (`/enterprise` mentions HK, SG, AU removal workflows).
6. **Subprocessor disclosure** timing (G5) relative to MPC-9828.
