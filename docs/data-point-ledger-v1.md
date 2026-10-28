# Data-point ledger v1 (MPC-8737)

Built exactly to the approved design **MPC-7898** (D1-D4, Amendments A1 and A2; sign-off 2026-10-17 16:08 HKT): every fact MyPrivacyTOOL learns about a person,
from any channel, is one append-only row: *what we think is true, how sure we are (0-100), and how we know* (`taken` / `given` / `checked`).

**Status: schema + render guard + PoP repoint built. No channel writes to it yet except the PoP gate. No legacy data is backfilled. No go-live flag changed.**

## What was added (all additive)

| Piece | Where |
|---|---|
| New schema `ledger` (11 tables, 2 views, guard + writer functions) and 3 public RPCs for the PoP gate | `supabase/migrations/20261028130000_mpc_8737_data_point_ledger_v1.sql` (rollback in its header) |
| Render guard, application side (pure functions, fail closed) | `shared/ledger-render-guard/index.ts` |
| Render guard, database side (`ledger.render_claim`, `ledger.render_progress`) | same migration |
| Golden cases run through **both** guards | `shared/ledger-render-guard/golden.json` |
| PoP gate repointed from `mpt_conversation_state` to the ledger | `workers/webhook-receiver/pop.ts`, `ledger-store.ts` |
| Backfill dry run (read-only) and apply (gated, never run by this task) | `supabase/backfill/` |

No existing table, constraint or function was altered or dropped. `supabase/tests/run.sh` proves it: it dumps schema `public` before and after, fails on any
changed or removed line or any added table/constraint, applies the rollback, and requires the post-rollback dump to be byte-identical to the pre-migration one.

## The honesty rules, where they are enforced

| Rule | Enforcement |
|---|---|
| H1 below 80 is a guess | no stored "fact" flag; class computed from `confidence` against `ledger.guess_below()` = 80 |
| H2 not_checked is never a guess | CHECK: `not_checked` / `check_failed` have NULL confidence **and** NULL value; `found` / `clear` must have both |
| H3 not_checked never renders clean | the clean phrase family exists only as the `clean` variant of a verified, checked, `clear` claim on a type with `clean_phrase_allowed` |
| H4 provenance mandatory | CHECK: `checked` needs `source_name`, `given` needs `input_ref` |
| H5 history never rewritten | triggers block UPDATE / DELETE / TRUNCATE on `data_point`, `shown_event`, `render_log`; only `erase_person` / `rollback_backfill_batch` (owner role, SECURITY DEFINER) may delete |
| H6 self-report and check are two rows | `ledger.v_disagreement` lists conflicts; the guard returns a mismatch or "not re-checked" phrase |
| H7 one way to read | no role has any privilege on a ledger table or view; `service_role` may only EXECUTE the guard and writer functions; the schema is not exposed to the REST API |
| H8 one precise claim per point | trigger: `provenance_extra.derived_from` types must share the new type's scope |
| H9 stale is not current | past `expires_at` or the type's `max_age` the guard answers Unknown |
| H10 100 is earned | CHECK: 100 needs `checked`+`exact_lookup` or `taken`+`webhook`; a user answer (`given`) tops out at 99 |

## Using the guard (every channel report generator MUST)

```sql
select * from ledger.render_claim(person, 'type.code', subject, locale, channel);   -- class, phrase_key, params, bar, action_key, data_point_ids, render_id
select * from ledger.render_progress(person, 'mirror_8_hexagon', locale, channel);   -- verified, self_attested_fixes, not_yet_checked (three integers)
```

It returns **phrase keys**, not sentences. Any error, missing person, bad channel or missing type returns `unknown` + `retry` (never an exception to catch around).
An item-less report profile is `report.progress.profile_undefined`, never "complete". `shared/ledger-render-guard` is the same logic for code that already holds rows.

## Person keys (D1)

`ledger.resolve_person(id_type, value, create)` and `ledger.attach_identifier(...)`. `wa_id` is canonical E.164 with a leading `+` (`ledger.normalise_wa_id`).
Only two PROVEN strong identifiers (wa_id, telegram_id, email_hash) merge two people automatically; anything weaker becomes a proposed `identity_link`. A user's
own `identity.link_confirmation` point confirms a link. Unmerging clears one pointer. Telegram ids accept the plain numeric form and the keyed `h1:` hash form
(MPC-7894), which post-dates the design.

## D4: "not me" and the shown event

`ledger.record_answer(...)` writes the user's answer (`confirmed` / `not_me` / `disputed`) as a `given` point at 95 together with a `shown_event`
(confidence shown, latency). `ledger.record_shown(..., no_response)` records silence as loop data only, **never** as a data point.

## Open rulings (not decided here; defaults are the design page's, all reversible)

See the PR description and the task row; the list is kept there so it cannot go stale in two places.

## Risk axis, education before acceptance, 366 registry (MPC-8753)

Design: MPC-7898 Amendment A3 + A3.9 (approved by Chris 2026-10-28). Migration: `supabase/migrations/20261028200000_mpc_8753_ledger_risk_axis.sql`, applied AFTER the v1 migration. Additive; the v1 guard functions keep their exact return types.

- **Two axes.** Identity/confidence is unchanged. Risk is a second axis, stored in two append-only tables (`risk_education_event`, `risk_decision_event`) and DERIVED by `ledger._risk_eval`: unknown (no row) -> educated -> accepted | removed.
- **Per claim and per scan.** The key is (person, type, subject, `scan_key`). A new scan starts at unknown; there is no reopen (A3.9 D7). A changed value, or a changed consequence-text version, voids earlier education and decisions.
- **Applies only to what was found.** Not checked, failed, stale and clear are `not_applicable`; a claim the person marked `not_me` is `not_me` and takes no decision (H17).
- **Education before acceptance (H12/H13).** An `accepted` decision needs an education event for the same claim, scan and value, shown earlier, backed by a `consequence` render in `render_log`. A type with no APPROVED consequence text (`public.localization`, status approved) cannot be educated, so it cannot be accepted. All 366 types start with no text: nothing is acceptable until texts are written and approved.
- **Writers/guard.** `render_consequence`, `record_risk_education`, `record_risk_decision`, `render_claim_risk`, `render_progress_risk` (service_role EXECUTE only). Score = `unaddressed_risk` = unknown + educated, a whole number; the risk buckets partition the profile. Identity confirm taps never move it.
- **366 registry (H18).** `data_point_type` holds the 366 hexagons of `public.hexagon_catalogue` (hexagon_id, channel, arrival, risk_tier, build_state, access_class). Un-dotted web/email ids map to `web.<id>` / `email.<id>` with `-` as `_`, the same convention the v1 backfill uses, so a backfilled row is promoted in place. `report_profile_item` accepts only built, access-ok hexagons.
- **Erase parity.** `ledger.erase_person` now also erases the two risk tables.
- **Tests.** `supabase/tests/mpc-8753-risk-axis.test.sql` (run by `supabase/tests/run.sh`, incl. tested rollback restoring schema `ledger` byte-for-byte) and `shared/ledger-render-guard/risk.vitest.ts`.
