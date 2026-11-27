# Make scenario MPC-6952 (content distribution)

`mpc-6952-blueprint.json` is a copy of the live Make scenario 7817044 (EU1, org 4179, team 5068) as of 2026-11-01, with the receipt token replaced by `__RECEIPT_TOKEN__`.

Why it is here: on 2026-10-29 a blueprint update built from a stale copy overwrote a fix, so the 30 Oct run failed and every receipt step was silently skipped (Make's error handler on those steps is Ignore). Keeping the blueprint in the repo makes each change a reviewed diff, and `scripts/make-blueprint.vitest.mjs` guards the two mistakes that caused the incident.

Rules for changing the scenario:
1. Read the live scenario immediately before any update (`scenarios_get`); never build an update from an older copy.
2. Validate each changed module with Make's module validator before saving. `http:ActionSendData` v3 needs `followAllRedirects`; `http:ActionGetFile` v3 accepts only url, method, serializeUrl and shareCookies here.
3. Update this file in the same pull request and keep the token a placeholder.
4. After a change, one real approval must show `verified_published` receipts in D1 `publication_receipts` before the change is called done.
