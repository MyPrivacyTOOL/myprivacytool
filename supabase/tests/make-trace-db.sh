#!/usr/bin/env bash
# CK-8492: builds a THROWAWAY database (ck8492_trace) with every repo migration applied, for the synthetic learning-events trace
# (workers/webhook-receiver/learningEvents.trace.vitest.ts). Same refusal rule as run.sh: never a Supabase-hosted database.
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/make-trace-db.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a disposable Postgres server}"
case "$DATABASE_URL" in *supabase.co*|*supabase.com*|*pooler.supabase*) echo "refusing a Supabase-hosted database"; exit 2;; esac
base="${DATABASE_URL%%\?*}"; TRACE_URL="${base%/*}/ck8492_trace"
psql -X -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "drop database if exists ck8492_trace" -c "create database ck8492_trace"
psql -X -q -v ON_ERROR_STOP=1 "$TRACE_URL" -f supabase/tests/bootstrap.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$TRACE_URL" -f supabase/sql/mpt-operational-rls.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$TRACE_URL" -f supabase/sql/mpt-score-baselines.sql >/dev/null
for f in $(ls supabase/migrations/*.sql | sort); do psql -X -q -v ON_ERROR_STOP=1 "$TRACE_URL" -f "$f" >/dev/null; done
echo "$TRACE_URL"
