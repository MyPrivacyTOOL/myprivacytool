# Supabase migrations (MPC-9896, Option B baseline)

Decided by Chris 2026-11-17 and confirmed 2026-11-18, option A of the 2026-11-27 question: the LIVE database is the truth.

## What is where
- `supabase/migrations/` is what `supabase db push` reads (workflow `deploy-supabase.yml`, manual only).
  - `20261127060000_mpc_9896_option_b_baseline.sql`: the whole live structure (schemas public, ledger, visit_log) as one file, for building a NEW empty database. It is **never executed on live**: live history records this version as already applied.
  - 97 empty placeholder files, one per version already applied on live. They exist only so the CLI sees the same history as live. Do not add statements to them.
  - Every migration after the baseline is a normal file with a version **later than the newest live version** (`supabase migration list` shows it). A file older than the newest applied version is refused by `db push` (out of order).
- `supabase/migrations_archive/`: the old migration chain (98 files). Kept for reference and as input of the SQL tests (`supabase/tests/run.sh`). **Not applied by deploys.** Comments elsewhere that name `supabase/migrations/<old file>` mean this folder.

## How to add a migration
1. Create `supabase/migrations/<14-digit UTC timestamp>_<name>.sql` with a timestamp later than the newest live version.
2. Merge. Run `deploy-supabase.yml` with `confirm=DEPLOY` and `dry_run=true` to see it listed, then without `dry_run` to apply it.
3. If someone applied a change to live by hand (connector), it appears in live history with its own version: add an empty placeholder with that version and name, and record the change in the next baseline refresh.

## Rebuilding the baseline
Run the `supabase-schema-snapshot` workflow, compare with the baseline, and replay on an empty Postgres 17 (kit and last proof in the private repo, `docs/data/mpt-supabase/`). The baseline is not byte-identical to live: constraint and policy expressions print differently, comments on `public.scans` sit at shifted column numbers, and live stores explicit owner-only ACLs where a fresh build stores none. All were read down to the rows and have the same meaning.
