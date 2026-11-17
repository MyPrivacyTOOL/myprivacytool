#!/usr/bin/env bash
# MPC-9896 option A: align supabase_migrations.schema_migrations with supabase/migrations WITHOUT changing any schema.
# Only history rows change. Dry run unless --apply. Needs `supabase link` done and SUPABASE_DB_PASSWORD in the environment (never printed).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
apply=0; [ "${1:-}" = "--apply" ] && apply=1
run() { if [ "$apply" = 1 ]; then supabase migration repair "$@" --password "$SUPABASE_DB_PASSWORD"; else echo "DRY-RUN: supabase migration repair $*"; fi; }
# repo files whose objects already exist live under a different version: record them as applied
while read -r v; do [ -n "$v" ] && run --status applied "$v"; done < "$here/history-mark-applied.txt"
# live-only versions (applied by hand through the connector, no matching repo file): remove them from history
while read -r v; do [ -n "$v" ] && run --status reverted "$v"; done < "$here/history-mark-reverted.txt"
echo "Done. Next: supabase db push --dry-run must list ONLY the intentionally pending files in docs/mpc-9896-migration-history-repair.md"
