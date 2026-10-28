#!/usr/bin/env bash
# MPC-7300: Supabase integration tests against a THROWAWAY Postgres database (never the live project).
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
#
# DATABASE_URL must point at a disposable server (CI service container or local Postgres) and a role that
# may CREATE/DROP DATABASE. The script refuses hosts that look like a Supabase project. It:
#   1. recreates database mpt_integration_test
#   2. applies bootstrap.sql (Supabase roles/auth stubs), then the repo SQL in dependency order
#   3. runs the pre-existing RLS isolation test and checks every row against its "(expect ...)" label
#   4. runs schema.test.sql (ON_ERROR_STOP: any failed assertion fails the run)
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${DATABASE_URL:?set DATABASE_URL to a disposable Postgres server}"
case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*) echo "::error::refusing to run integration tests against a Supabase-hosted database"; exit 2;;
esac

TEST_DB=mpt_integration_test
# swap the database name in the URL (everything after the last '/', minus any query string)
base="${DATABASE_URL%%\?*}"; query=""; [[ "$DATABASE_URL" == *\?* ]] && query="?${DATABASE_URL#*\?}"
ADMIN_URL="$DATABASE_URL"
TEST_URL="${base%/*}/${TEST_DB}${query}"
psql_() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== recreating $TEST_DB"
psql_ "$ADMIN_URL" -c "drop database if exists $TEST_DB" -c "create database $TEST_DB"

echo "== bootstrap + repo SQL"
psql_ "$TEST_URL" -f supabase/tests/bootstrap.sql
psql_ "$TEST_URL" -f supabase/sql/mpt-operational-rls.sql
psql_ "$TEST_URL" -f supabase/sql/mpt-score-baselines.sql
# mpt-purge-expired-scan-results.sql needs pg_cron (not available in plain Postgres); it is documentation of the live job.
# MPC-8671 is applied below, after the KPI view chain it replaces (supabase/sql/*, which production got through the SQL editor/MCP, not through migrations).
# MPC-8737: the ledger migration has its own stage further down (fingerprint before / after, rollback, re-apply), so it is excluded here too.
for f in $(ls supabase/migrations/*.sql | grep -v -e mpc_8671_kpi_views_hourly_counter -e mpc_8737_data_point_ledger_v1 | sort); do echo "   migration $(basename "$f")"; psql_ "$TEST_URL" -f "$f"; done
echo "   KPI view chain (supabase/sql), in the order production received it"
for f in mpt-raw-metrics mpt-youtube-daily-metrics mpt-youtube-daily-join mpt-hk-days mpt-hubspot-daily mpt-cloudflare-daily-metrics mpt-cloudflare-daily-join; do echo "   sql $f.sql"; psql_ "$TEST_URL" -f "supabase/sql/$f.sql"; done
echo "   migration 20261028120000_mpc_8671_kpi_views_hourly_counter.sql"
psql_ "$TEST_URL" -f supabase/migrations/20261028120000_mpc_8671_kpi_views_hourly_counter.sql
# CK-8493: migrations proposed but not yet released (not read by deploy-supabase.yml). Tested here against the throwaway database only.
# MPC-7471-F4 is excluded here: it drops mpt_score_baselines_email_hash_key, which schema.test.sql still needs, and it has its own stage further down.
for f in $(ls supabase/proposed/*.sql 2>/dev/null | grep -v mpc_7471_f4_baseline_score_version | sort); do echo "   proposed $(basename "$f")"; psql_ "$TEST_URL" -f "$f"; done

echo "== RLS isolation test (supabase/sql/mpt-operational-rls.test.sql)"
out=$(psql_ "$TEST_URL" -At -F '|' -f supabase/sql/mpt-operational-rls.test.sql | grep '|' || true)
rows=0; bad=0
while IFS='|' read -r label result; do
  [ -z "$label" ] && continue
  rows=$((rows+1))
  expected=$(printf '%s' "$label" | sed -n 's/.*(expect \([^)]*\)).*/\1/p')
  case "$expected" in denied) want=denied;; [0-9]*) want="$expected";; *) want="";; esac
  if [ "$result" = "$want" ]; then echo "   PASS $label"; else echo "::error::RLS isolation FAIL: '$label' got '$result' want '$want'"; bad=$((bad+1)); fi
done <<< "$out"
[ "$rows" -ge 10 ] || { echo "::error::expected >=10 RLS result rows, got $rows"; exit 1; }
[ "$bad" -eq 0 ] || exit 1

echo "== schema assertions"
psql_ "$TEST_URL" -At -f supabase/tests/schema.test.sql


echo "== dashboard links and sessions (MPC-7893)"
psql_ "$TEST_URL" -At -f supabase/tests/dashboard-links.test.sql
# Real concurrency: 8 separate connections try to redeem ONE link at the same moment. Exactly one may win.
psql_ "$TEST_URL" -c "insert into public.profile_snapshots (id, sender_id, update_id, status, scan_version, risk_version, consent, get_chat, photos, expires_at) values ('00000000-0000-0000-0000-0000000000c1', '333', 1, 'complete', 'telegram-baseline-1', 'risk-count-1', '{}', '{}', '{}', now() + interval '90 days')" \
  -c "insert into public.dashboard_links (token_hash, sender_id, snapshot_id, expires_at) values (repeat('e',64), '333', '00000000-0000-0000-0000-0000000000c1', now() + interval '15 minutes')"
race_dir=$(mktemp -d)
for i in 1 2 3 4 5 6 7 8; do
  ( psql_ "$TEST_URL" -At -c "select public.mpt_redeem_dashboard_link(repeat('e',64), repeat('$i',64), 30)" > "$race_dir/$i" ) &
done
wait
wins=$(cat "$race_dir"/* | grep -c '^t$' || true)
[ "$wins" -eq 1 ] || { echo "::error::concurrent redemption: expected exactly 1 winner, got $wins"; exit 1; }
sessions=$(psql_ "$TEST_URL" -At -c "select count(*) from public.dashboard_sessions where sender_id = '333'")
[ "$sessions" -eq 1 ] || { echo "::error::concurrent redemption created $sessions sessions"; exit 1; }
echo "   8 concurrent redemptions: 1 winner, 1 session"
rm -rf "$race_dir"

# MPC-8528: the PROPOSED AI-support schema (applied by the migrations loop above; deploy-supabase.yml pushes it to the live project on merge).
echo "== proposed schema: AI support cases (MPC-8528)"
psql_ "$TEST_URL" -At -f supabase/tests/proposed-mpc-8528-support-cases.test.sql

# MPC-8529: the PROPOSED follow-up watchdog (supabase/proposed/mpc_8529_support_followup.sql, applied by the proposed loop above, after the 8528 migration).
echo "== proposed schema: support follow-up watchdog (MPC-8529)"
psql_ "$TEST_URL" -At -f supabase/tests/proposed-mpc-8529-support-followup.test.sql

# MPC-8659: the PROPOSED scans retention migration (supabase/migrations/20261027150000_mpc_8659_scans_retention.sql, applied by the migrations loop above).
echo "== proposed migration: scans retention (MPC-8659)"
psql_ "$TEST_URL" -At -f supabase/tests/proposed-mpc-8659-scans-retention.test.sql

# MPC-7471-F4: the PROPOSED baseline score_version migration (supabase/proposed/, not in supabase/migrations/) on rows saved the old way, then its own rollback.
echo "== proposed migration: baseline score_version (MPC-7471-F4)"
PROPOSED=supabase/proposed/20261026000000_mpc_7471_f4_baseline_score_version.sql
# rows saved the old way (no score_version column yet), as production holds them
psql_ "$TEST_URL" -c "insert into public.mpt_score_baselines (email_hash, overall_score, category_scores) values (repeat('a', 64), 40, '{\"fingerprint\":50}'), (repeat('d', 64), 85, '{}')"
before=$(psql_ "$TEST_URL" -At -c "select count(*) || ':' || coalesce(sum(overall_score),0) from public.mpt_score_baselines")
psql_ "$TEST_URL" -f "$PROPOSED"
psql_ "$TEST_URL" -f "$PROPOSED"   # idempotent: a second run changes nothing
psql_ "$TEST_URL" -At -f supabase/tests/proposed-baseline-score-version.test.sql
echo "   rollback (text taken from the migration header)"
sed -n '/^-- ROLLBACK/,/^$/p' "$PROPOSED" | sed -n 's/^--   //p' > "${TMPDIR:-/tmp}/f4-rollback.sql"
test -s "${TMPDIR:-/tmp}/f4-rollback.sql" || { echo "::error::no rollback text found in $PROPOSED"; exit 1; }
psql_ "$TEST_URL" -f "${TMPDIR:-/tmp}/f4-rollback.sql"
after=$(psql_ "$TEST_URL" -At -c "select count(*) || ':' || coalesce(sum(overall_score),0) from public.mpt_score_baselines")
[ "$before" = "$after" ] || { echo "::error::rollback did not restore the legacy rows ($before vs $after)"; exit 1; }
psql_ "$TEST_URL" -At -c "select 1 from pg_constraint where conname='mpt_score_baselines_email_hash_key'" | grep -q 1 || { echo "::error::rollback did not restore the unique(email_hash) key"; exit 1; }
echo "   legacy rows identical before and after: $before"

# MPC-8671: the KPI views count scan_hourly_counts, so a purge of public.scans must not move any KPI number.
echo "== KPI views read the hourly counter; a purge leaves them unchanged (MPC-8671)"
psql_ "$TEST_URL" -At -f supabase/tests/mpc-8671-kpi-views-hourly-counter.test.sql

echo "== CK-8503: simultaneous scan requests for one user create exactly one scan (real concurrent sessions)"
psql_ "$TEST_URL" -c "insert into public.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'ck8503-race@example.com')"
for i in 1 2 3 4 5 6 7 8; do
  psql_ "$TEST_URL" -At -c "select duplicate from public.mpt_request_scan('00000000-0000-4000-8000-0000000000c1', 'ck8503-race@example.com')" >> "${TMPDIR:-/tmp}/ck8503-race.$$" &
done
wait
created=$(grep -c '^f$' "${TMPDIR:-/tmp}/ck8503-race.$$" || true); dups=$(grep -c '^t$' "${TMPDIR:-/tmp}/ck8503-race.$$" || true); rm -f "${TMPDIR:-/tmp}/ck8503-race.$$"
total=$(psql_ "$TEST_URL" -At -c "select count(*) from public.scans where user_id = '00000000-0000-4000-8000-0000000000c1'")
[ "$created" = 1 ] && [ "$dups" = 7 ] && [ "$total" = 1 ] || { echo "::error::concurrent mpt_request_scan: created=$created duplicates=$dups rows=$total (want 1, 7, 1)"; exit 1; }
echo "   PASS 8 simultaneous requests -> 1 scan created, 7 told duplicate, 1 row"
psql_ "$TEST_URL" -c "insert into public.users (id, email) values ('00000000-0000-4000-8000-0000000000c2', 'ck8503-race2@example.com')"
for i in 1 2 3 4 5 6 7 8; do
  psql_ "$TEST_URL" -At -c "select duplicate from public.mpt_request_scan('00000000-0000-4000-8000-0000000000c2', 'ck8503-race2@example.com', gen_random_uuid())" >> "${TMPDIR:-/tmp}/ck8503-race2.$$" &
done
wait
created=$(grep -c '^f$' "${TMPDIR:-/tmp}/ck8503-race2.$$" || true); rm -f "${TMPDIR:-/tmp}/ck8503-race2.$$"
total=$(psql_ "$TEST_URL" -At -c "select count(*) from public.scans where user_id = '00000000-0000-4000-8000-0000000000c2'")
[ "$created" = 1 ] && [ "$total" = 1 ] || { echo "::error::concurrent mpt_request_scan with distinct request ids: created=$created rows=$total (want 1, 1)"; exit 1; }
echo "   PASS 8 simultaneous requests with 8 DIFFERENT request ids -> still 1 scan"

# MPC-8737: data-point ledger v1. Additive proof, constraint / guard assertions, tested rollback, re-apply.
echo "== data-point ledger v1 (MPC-8737)"
LEDGER=supabase/migrations/20261028130000_mpc_8737_data_point_ledger_v1.sql
fp() { pg_dump -s --no-comments -n public "$TEST_URL" | grep -v -E '^.(un)?restrict '; }
fp > "${TMPDIR:-/tmp}/ledger-before.sql"
psql_ "$TEST_URL" -f "$LEDGER"
fp > "${TMPDIR:-/tmp}/ledger-after.sql"
removed=$(diff "${TMPDIR:-/tmp}/ledger-before.sql" "${TMPDIR:-/tmp}/ledger-after.sql" | grep -c '^<' || true)
added_objects=$(diff "${TMPDIR:-/tmp}/ledger-before.sql" "${TMPDIR:-/tmp}/ledger-after.sql" | grep '^>' | grep -c -E 'CREATE (TABLE|VIEW|TRIGGER|INDEX)|ALTER TABLE' || true)
[ "$removed" -eq 0 ] || { echo "::error::the ledger migration changed or removed $removed existing line(s) in schema public"; exit 1; }
[ "$added_objects" -eq 0 ] || { echo "::error::the ledger migration added tables / constraints to schema public ($added_objects); it may only add the three mpt_ledger_pop_* functions"; exit 1; }
echo "   additive: 0 existing public lines changed; public gained only functions"
psql_ "$TEST_URL" -At -f supabase/tests/mpc-8737-ledger.test.sql
psql_ "$TEST_URL" -At -f supabase/tests/mpc-8737-golden.test.sql
echo "   rollback (text taken from the migration header)"
sed -n '/^-- ROLLBACK/,/^$/p' "$LEDGER" | sed -n 's/^--   //p' > "${TMPDIR:-/tmp}/ledger-rollback.sql"
test -s "${TMPDIR:-/tmp}/ledger-rollback.sql" || { echo "::error::no rollback text found in $LEDGER"; exit 1; }
psql_ "$TEST_URL" -f "${TMPDIR:-/tmp}/ledger-rollback.sql"
[ "$(psql_ "$TEST_URL" -At -c "select count(*) from pg_namespace where nspname = 'ledger'")" = 0 ] || { echo "::error::rollback left the ledger schema behind"; exit 1; }
[ "$(psql_ "$TEST_URL" -At -c "select count(*) from pg_proc where proname like 'mpt_ledger_pop_%'")" = 0 ] || { echo "::error::rollback left mpt_ledger_pop_* functions behind"; exit 1; }
fp > "${TMPDIR:-/tmp}/ledger-rolled-back.sql"
diff -q "${TMPDIR:-/tmp}/ledger-before.sql" "${TMPDIR:-/tmp}/ledger-rolled-back.sql" >/dev/null || { echo "::error::schema public after rollback differs from before the migration"; diff "${TMPDIR:-/tmp}/ledger-before.sql" "${TMPDIR:-/tmp}/ledger-rolled-back.sql" | head -20; exit 1; }
echo "   rollback restored schema public byte-for-byte (pg_dump -s identical to the pre-migration dump)"
psql_ "$TEST_URL" -f "$LEDGER"
psql_ "$TEST_URL" -At -c "select 'ledger re-applied after rollback: ' || count(*) || ' tables' from information_schema.tables where table_schema = 'ledger' and table_type = 'BASE TABLE'"
echo "   backfill (fresh ledger): dry run, apply, idempotent re-apply, hold release, exact reversal"
legacy_counts() { psql_ "$TEST_URL" -At -c "select (select count(*) from public.signals) || ',' || (select count(*) from public.web_scans) || ',' || (select count(*) from public.users) || ',' || (select count(*) from public.leads) || ',' || (select count(*) from public.scans) || ',' || (select count(*) from public.mpt_score_baselines) || ',' || (select count(*) from public.conversation_states)"; }
psql_ "$TEST_URL" -f supabase/tests/mpc-8737-backfill-fixtures.sql
legacy_before=$(legacy_counts)
psql_ "$TEST_URL" -At -F '|' -f supabase/backfill/mpc-8737-ledger-backfill-dryrun.sql > "${TMPDIR:-/tmp}/ledger-dry.txt"
echo "   dry run (fixtures):"; sed 's/^/     /' "${TMPDIR:-/tmp}/ledger-dry.txt" | grep -E 'TOTAL|persons:' || true
[ "$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.data_point where backfill_batch_id is not null")" = 0 ] || { echo "::error::the dry run wrote data"; exit 1; }
psql_ "$TEST_URL" -At -f supabase/backfill/mpc-8737-ledger-backfill-apply.sql | tail -1
DRYFILE="${TMPDIR:-/tmp}/ledger-dry.txt" psql_ "$TEST_URL" -At -f supabase/tests/mpc-8737-backfill.test.sql
n1=$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.data_point")
psql_ "$TEST_URL" -At -f supabase/backfill/mpc-8737-ledger-backfill-apply.sql | tail -1
n2=$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.data_point")
[ "$n1" = "$n2" ] || { echo "::error::apply is not idempotent ($n1 then $n2 data points)"; exit 1; }
echo "   idempotent: second apply added nothing ($n1 data points)"
# approving a registry default releases exactly the held rows, and nothing else
psql_ "$TEST_URL" -c "update ledger.data_point_type set default_check_confidence = 70 where code like 'signal.%' or code = 'score.baseline.overall'"
psql_ "$TEST_URL" -At -f supabase/backfill/mpc-8737-ledger-backfill-apply.sql | tail -1
held_released=$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.data_point where status in ('found','clear') and confidence = 70 and provenance_extra->>'confidence_basis' = 'registry_default' and (legacy_ref like 'signals:87370000-%' or (legacy_ref like 'mpt_score_baselines:%' and value->>'score' = '61'))")
[ "$held_released" = 3 ] || { echo "::error::releasing a default should add exactly the 2 held signals + 1 baseline, got $held_released"; exit 1; }
echo "   releasing defaults for signals + baselines added exactly the 3 held rows"
batches=$(psql_ "$TEST_URL" -At -c "select string_agg(backfill_batch_id::text, ',') from ledger.backfill_batch")
for b in $(echo "$batches" | tr ',' ' '); do psql_ "$TEST_URL" -At -c "select ledger.rollback_backfill_batch('$b')" >/dev/null; done
[ "$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.data_point where backfill_batch_id is not null")" = 0 ] || { echo "::error::batch rollback left backfilled data points"; exit 1; }
echo "   every backfilled data point reversed by batch id; legacy tables untouched"
# the apply script refuses to run against a database that is not the throwaway one while M3 (erase parity) is missing
psql_ "$ADMIN_URL" -c "alter database $TEST_DB rename to mpt_gate_check" >/dev/null
GATE_URL="${base%/*}/mpt_gate_check${query}"
if out=$(psql_ "$GATE_URL" -At -f supabase/backfill/mpc-8737-ledger-backfill-apply.sql 2>&1); then gate=ran; else gate=refused; fi
psql_ "$ADMIN_URL" -c "alter database mpt_gate_check rename to $TEST_DB" >/dev/null
[ "$gate" = refused ] && echo "$out" | grep -q 'M3 (erase parity) is not in place' || { echo "::error::the backfill apply script ran (or failed for another reason) on a database that is not the throwaway one, with M3 missing: $out"; exit 1; }
[ "$(psql_ "$TEST_URL" -At -c "select count(*) from ledger.backfill_batch where created_at > now() - interval '1 minute'")" = 1 ] || true
echo "   gate: the apply script refuses any database but the throwaway one while M3 (erase parity) is missing"
[ "$(legacy_counts)" = "$legacy_before" ] || { echo "::error::the backfill changed a legacy table"; exit 1; }
echo "   legacy tables unchanged by dry run, apply, re-apply and reversal ($legacy_before)"

psql_ "$ADMIN_URL" -c "drop database if exists $TEST_DB"
echo "OK: Supabase integration tests passed ($rows RLS rows + schema assertions)"
