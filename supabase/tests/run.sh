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
for f in $(ls supabase/migrations/*.sql | sort); do echo "   migration $(basename "$f")"; psql_ "$TEST_URL" -f "$f"; done

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

psql_ "$ADMIN_URL" -c "drop database if exists $TEST_DB"
echo "OK: Supabase integration tests passed ($rows RLS rows + schema assertions)"
