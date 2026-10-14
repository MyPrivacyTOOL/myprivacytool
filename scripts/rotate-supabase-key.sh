#!/usr/bin/env bash
# MPC-7821 / MPC-7385-F5: install a rotated Supabase secret key everywhere it is used.
#
# Run this locally as the person who generated the key (needs `npx wrangler` logged in to
# Cloudflare and, optionally, `gh` logged in to GitHub). The key is read from a hidden prompt
# (or from SUPABASE_NEW_KEY in your shell) and is never printed, logged or written to disk.
# Do not paste the key into chat, Notion or a repo; an agent never needs to see it.
#
#   scripts/rotate-supabase-key.sh            # install on the 5 manual Workers + GitHub secret
#   scripts/rotate-supabase-key.sh --dry-run  # list what would be updated, touch nothing
set -euo pipefail

WORKERS=(mpt-leads mpt-metrics-collector github-channel oauth-poc webhook-receiver)
REPO="MyPrivacyTOOL/myprivacytool"
GH_SECRET="SCAN_REPORT_SUPABASE_SERVICE_ROLE_KEY"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--dry-run" ]]; then
  for w in "${WORKERS[@]}"; do echo "would run: wrangler secret put SUPABASE_SERVICE_ROLE_KEY (workers/$w)"; done
  echo "would run: gh secret set $GH_SECRET --repo $REPO"
  exit 0
fi

if [[ -z "${SUPABASE_NEW_KEY:-}" ]]; then
  read -rsp "New Supabase secret key (hidden): " SUPABASE_NEW_KEY
  echo
fi
[[ -n "$SUPABASE_NEW_KEY" ]] || { echo "empty key, aborting" >&2; exit 1; }

failed=()
for w in "${WORKERS[@]}"; do
  echo "== $w"
  if ! (cd "$ROOT/workers/$w" && printf '%s' "$SUPABASE_NEW_KEY" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY >/dev/null); then
    failed+=("$w")
  fi
done

if command -v gh >/dev/null; then
  printf '%s' "$SUPABASE_NEW_KEY" | gh secret set "$GH_SECRET" --repo "$REPO" || failed+=("github:$GH_SECRET")
else
  echo "gh not installed: set $GH_SECRET by hand in GitHub -> Settings -> Secrets -> Actions" >&2
fi
unset SUPABASE_NEW_KEY

echo
for w in "${WORKERS[@]}"; do
  echo "== $w"; (cd "$ROOT/workers/$w" && npx wrangler secret list | grep -A2 SUPABASE_SERVICE_ROLE_KEY || echo "  NOT FOUND")
done

if ((${#failed[@]})); then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
cat <<'EOF'

Done. Still to do by hand (the script cannot):
  1. Re-run "Deploy scan-report Worker" (log must say: set SUPABASE_SERVICE_ROLE_KEY).
  2. Update the Cloudflare Pages secret SUPABASE_SERVICE_ROLE_KEY and redeploy the site.
  3. Update /root/.env on the droplet if an agent reads it from there (root:chrisops 640, restart agent-router).
  4. Check Supabase API logs for legacy JWT callers, then revoke the old key.
EOF
