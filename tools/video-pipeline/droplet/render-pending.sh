#!/usr/bin/env bash
# CK-7728: render every approved video script that has not been rendered yet (or has changed), with Alice's voice.
# Runs unattended on the droplet from a systemd timer (alice-render.timer). NEVER uploads anything: the finished
# files stay in OUT_DIR until a person watches and publishes them.
#
# "Approved" means: the script file is on the main branch of the repo (it got there through a reviewed pull request).
# Nothing else is ever rendered.
set -euo pipefail

ROOT="${ALICE_ROOT:-/opt/alice-render}"
REPO="$ROOT/repo"
VENV="$ROOT/venv"
MODEL="$ROOT/models/kokoro-en-v0_19"
OUT_DIR="${ALICE_OUT_DIR:-/var/lib/alice-render/out}"
STATE_DIR="${ALICE_STATE_DIR:-/var/lib/alice-render/state}"
ALICE_PNG="${ALICE_PNG:-/var/lib/alice-render/alice.png}"   # Alice's drawing: kept OFF the repo, put here by a person
LOCK="/var/lib/alice-render/render.lock"

mkdir -p "$OUT_DIR" "$STATE_DIR"
exec 9>"$LOCK"
flock -n 9 || { echo "another render is running; exiting"; exit 0; }

cd "$REPO"
git fetch --quiet origin main
git merge --quiet --ff-only origin/main   # fast-forward only: never merges, never rewrites

# Alice's picture: a full-size file placed on the machine wins; otherwise use the text-free reference that is in the repo
# (video-scripts/assets/alice.png, 820 px wide: it looks a little soft when enlarged until a full-size file exists).
REPO_ALICE="$REPO/video-scripts/assets/alice.png"
alice_arg=()
if [ -f "$ALICE_PNG" ]; then
  alice_arg=(--alice "$ALICE_PNG")
elif [ -f "$REPO_ALICE" ]; then
  alice_arg=(--alice "$REPO_ALICE")
  echo "note: using the repo reference $REPO_ALICE (no full-size $ALICE_PNG)"
else
  echo "WARNING: no Alice picture found ($ALICE_PNG or $REPO_ALICE): the pictures will have NO Alice (layout check only)"
fi

rendered=0; skipped=0; failed=0
for f in video-scripts/*.json; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  # Only plain file names are accepted (same rule as the GitHub workflow).
  [[ "$name" =~ ^[A-Za-z0-9._-]+\.json$ ]] || { echo "skip odd name: $name"; continue; }
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  if [ -f "$STATE_DIR/$name.sha256" ] && [ "$(cat "$STATE_DIR/$name.sha256")" = "$sum" ]; then
    skipped=$((skipped + 1)); continue
  fi
  echo "== rendering $name"
  if "$VENV/bin/python" tools/video-pipeline/build_short.py "$f" --model-dir "$MODEL" "${alice_arg[@]}" --out "$OUT_DIR"; then
    echo "$sum" > "$STATE_DIR/$name.sha256"
    rendered=$((rendered + 1))
  else
    echo "FAILED: $name"; failed=$((failed + 1))
  fi
done
echo "done: rendered=$rendered unchanged=$skipped failed=$failed; files are in $OUT_DIR (nothing was uploaded)"
[ "$failed" -eq 0 ]
