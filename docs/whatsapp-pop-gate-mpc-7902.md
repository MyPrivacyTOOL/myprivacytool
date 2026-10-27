# MPC-7902 — WhatsApp proof-of-possession gate

**Status: implemented and synthetically verified. NOT live. WhatsApp go-live stays blocked until the approvals at the bottom exist.**
Merging this change does not approve go-live. The flag is OFF by default.

## Rule

No external / OSINT lookup runs on a phone number unless a web session is bound, server-side, to the `wa_id` that sent an authenticated
inbound WhatsApp message containing a one-time code that session asked for. Flag OFF means *no phone-number scan on web*; it never
restores a direct scan.

## Interim storage (read this first)

MPC-7898 (ledger) is a design only; MPC-7899 (handshake writer) is not accepted. The ledger tables do not exist. Per the decision to build
on an interim proof source, proofs live in the **existing** `mpt_conversation_state` table (RLS forced, service_role only, 24 h hard life).
No new table, no "User Engagement" table. When the ledger ships, `pop_sess:*` becomes a ledger row (person-key + `data_point`,
source `taken`, provenance whatsapp/inbound, confidence 100) and `pop_rev:*` becomes the revocation state. `checkPossession()` is the single
function to repoint.

## Lifecycle

| Step | Where | What happens |
|---|---|---|
| 1 | `POST /api/pop/challenge` `{target?, consent:true}` | Server mints a 256-bit session token and a code `MPT-XXXX-XXXX` (30-symbol alphabet, ~39 bits, CSPRNG, rejection-sampled). Stores `pop_ch:<HMAC(code)>` with the session hash, optional declared target, consent version. 10 min. Returns the token, the code, the approved prompt, and a `wa.me` link **only if** `WHATSAPP_BOT_NUMBER` is configured. Opening the link sends nothing. |
| 2 | Person sends the code from WhatsApp | Meta-signed webhook (`verifyMeta`, fail closed). Only `messages[0]` counts; delivery receipts (`statuses`) are ignored. |
| 3 | `redeemFromInbound` | Claim the provider message id (atomic insert, dedup) → check per-sender wrong-code lockout → **atomic `DELETE … RETURNING`** of the challenge (single use; one winner under concurrency) → sender must equal the declared target, else the code is burned and nothing is revealed → **write the proof (`pop_sess:<HMAC(token)>`, 60 min) and confirm the write** → only then reply "Verified". |
| 4 | `checkPossession` at `start-deep-dive` | Read from durable state every time: flag on, secret present, token well-formed, proof exists and unexpired, not revoked (`pop_rev.at >= bound_at`), consent version matches and accepted, target equals the bound `wa_id`. Any store error → 503. Everything else → 403 with the verification prompt. Only then is a provider constructed. |
| 5 | STOP / DELETE inbound | Writes `pop_rev:<HMAC(wa_id)>` (24 h). Every proof bound at or before that moment is dead. A fresh handshake afterwards works. |

## Enforcement-point inventory

Paths that can start a phone-number check, found by inspection:

| Path | Result |
|---|---|
| `POST /api/scan/start-deep-dive` (the only caller of `runOsintScan` → RapidAPI / spam / breach providers) | **Gated** by `checkPossession`; also still needs `X-Webhook-Secret`. `runOsintScan` independently refuses without an inbound timestamp, which now comes from the proof, not from the caller. |
| `POST /api/v1/scan` (mirror-risk, `type: phone`) | Not a phone check today: `osintLookup` returns `not_checked` for phone and makes no external call. **Must be gated before phone support is ever added there.** |
| Other `/api/scan/*` routes | Operate on an existing `scan_id`; call no provider. |
| Queues / cron | None exist for phone checks. Any future queued job must call `checkPossession` when it runs, not when it is enqueued. |
| `scan-report`, partner-api, core-brain | Reference phone for other purposes; no phone-number OSINT provider call. |

## Threat model and residual limits

| Threat | Control | Residual |
|---|---|---|
| Forged webhook | `verifyMeta` HMAC (existing, fail closed) | Depends on `META_APP_SECRET` secrecy. |
| Replay of an inbound event | Atomic message-id claim; challenge deleted on use | None known. |
| Guessing / enumeration | ~39-bit code, 10 min life, per-sender lockout (5 wrong / 15 min → 1 h), HMAC at rest, creation rate limit | Lockout is per sender; a botnet of real WhatsApp accounts is bounded by live-challenge count / 2^39. Lockout counter is read-then-write (not atomic): worst case a few extra guesses. |
| Session fixation | Client cannot supply token, code or wa_id (tested) | — |
| Cross-session / challenge swapping | Code is bound to the session hash that asked for it | See social engineering below. |
| **Social engineering (the real gap)** | Declared-target check; the bot's reply tells the sender what was authorised and offers STOP | **Residual, needs a decision.** An attacker can start a session naming a victim's number, then trick the victim into sending the attacker's code. The attacker session is then bound to the victim's number and the findings go to the attacker. Possession proof cannot tell "I sent this code" from "I was talked into sending this code". Recommended: a second explicit confirmation reply from the number (e.g. YES) before binding, or deliver results only to a WhatsApp-side link. Not built because it changes the specified flow. |
| Stolen bearer token | Short life (60 min), HMAC at rest, revocable by STOP, never in URLs/logs | **Transferable.** The token is a bearer secret. Signing does not make it non-transferable, and no fingerprinting was added. |
| `wa_id` format drift | Mismatch fails closed | Some countries' `wa_id` differs from the dialled number (e.g. Mexico, Brazil, Argentina). Those users will be refused until a normalisation contract is approved. |
| Store outage / partial write | Strict reads/writes; 503/failure, no proof, no provider call | Challenge is spent; the person starts again. |
| Revocation window | Tombstone 24 h > proof 60 min | Revocation relies on the same store being readable (fails closed otherwise). |
| Consent | Explicit `consent:true` at challenge, version recorded, re-checked at execution | **Interim.** Consent/retention/revocation contract is not accepted (MPC-7904 owns STOP/DELETE). Wording `pop-consent-v1` and the bot reply texts are **not yet approved copy**. |

Possession proof is not blanket consent, identity proof, or permission for any other action. Provider, consent, release and budget gates
still apply and are not bypassed.

## Operating it

* Flag: `PHONE_SCAN_WEB_ENABLED` must be exactly `"1"`. Unset / anything else = OFF.
* Secrets: `POP_HMAC_SECRET` (≥32 chars, random). Optional var `WHATSAPP_BOT_NUMBER` (digits only). Existing: `META_APP_SECRET`, `DEEP_DIVE_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
* **Behaviour change on deploy:** `start-deep-dive` now returns 403 unless a bound session is supplied, and 403 `phone_scan_disabled` while the flag is OFF. Any existing caller that posts only `{wa_id}` stops working by design.
* Rollback: set the flag to anything but `"1"` (instant, fail closed) or revert the PR. Neither restores an unverified scan.
* No migration. No schema change.

## Tests

`npx vitest run workers/webhook-receiver src/lib/possessionApi.test.ts` — security suite `workers/webhook-receiver/pop.vitest.ts`
(33 cases). Every provider and the store are mocked; any unrecognised URL throws. The store fake implements expiry, ignore-duplicates
inserts and `DELETE … RETURNING` and yields between operations so a read-then-delete implementation would fail the concurrency test.
Mutation checks (remove target check, revocation check, consent check, flag check, make redemption non-atomic) each fail the suite.

## Go-live gates still open (not done, not claimed)

1. Decision on the social-engineering residual above.
2. Approved copy for the challenge page, consent text and bot replies; the real bot number set via `WHATSAPP_BOT_NUMBER`.
3. MPC-7898 ledger build + MPC-7899 acceptance, then repoint `checkPossession` to the ledger.
4. MPC-7904 consent / STOP / DELETE contract; MPC-7906 kill switches.
5. Security review of this change.
6. Live check with an explicitly authorised test number; deploy/merge approval (merging may auto-deploy — treat as a production action).
7. A web page that mounts the challenge UI (`src/lib/possessionApi.ts` is the client; no phone form exists yet).
