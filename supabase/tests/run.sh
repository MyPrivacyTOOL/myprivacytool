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
for f in $(ls supabase/migrations/*.sql | grep -v mpc_8671_kpi_views_hourly_counter | sort); do echo "   migration $(basename "$f")"; psql_ "$TEST_URL" -f "$f"; done
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

# MPC-8673: the PROPOSED Flip Point schema (supabase/migrations/20261028110000_mpc_8673_flip_point_consents.sql, applied by the migrations loop above).
echo "== proposed schema: Flip Point consents (MPC-8673)"
psql_ "$TEST_URL" -At -f supabase/tests/proposed-mpc-8673-flip-point.test.sql

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

psql_ "$ADMIN_URL" -c "drop database if exists $TEST_DB"
echo "OK: Supabase integration tests passed ($rows RLS rows + schema assertions)"
