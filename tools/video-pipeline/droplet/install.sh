#!/usr/bin/env bash
# CK-7728: one-time setup of the automatic Alice renderer on an Ubuntu droplet. Run as root, from a clone of the repo:
#
#   sudo bash tools/video-pipeline/droplet/install.sh
#
# Creates an unprivileged user (alice-render), installs ffmpeg/fonts/python venv/sherpa-onnx and the Kokoro v0.19 voice
# model under /opt/alice-render, clones the repo there, installs a systemd timer (every 6 hours) and starts it.
# Idempotent: safe to re-run. Zero spend, no secrets, never uploads anything.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

ROOT=/opt/alice-render
STATE=/var/lib/alice-render
REPO_URL="${ALICE_REPO_URL:-https://github.com/MyPrivacyTOOL/myprivacytool}"
MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2
SHERPA_VERSION=1.13.8

echo "== disk and memory"
free_kb=$(df -Pk /opt | awk 'NR==2{print $4}'); mem_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
[ "$free_kb" -ge 3145728 ] || { echo "Need 3 GiB free on /opt" >&2; exit 1; }
[ "$mem_kb" -ge 1572864 ] || { echo "Need 1.5 GiB available memory" >&2; exit 1; }

echo "== packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ffmpeg fonts-inter python3-venv curl bzip2

echo "== user and folders"
id alice-render >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin alice-render
mkdir -p "$ROOT/models" "$STATE/out" "$STATE/state"
chown -R alice-render:alice-render "$ROOT" "$STATE"

echo "== repo (main branch, fast-forward only)"
if [ ! -d "$ROOT/repo/.git" ]; then
  sudo -u alice-render git clone --quiet --branch main "$REPO_URL" "$ROOT/repo"
fi

echo "== python environment"
[ -d "$ROOT/venv" ] || sudo -u alice-render python3 -m venv "$ROOT/venv"
sudo -u alice-render "$ROOT/venv/bin/pip" install --quiet --upgrade pip
sudo -u alice-render "$ROOT/venv/bin/pip" install --quiet "sherpa-onnx==$SHERPA_VERSION" numpy pillow

echo "== voice model (Kokoro v0.19, Apache 2.0)"
if [ ! -d "$ROOT/models/kokoro-en-v0_19" ]; then
  sudo -u alice-render bash -c "cd '$ROOT/models' && curl -fsSL --retry 4 --retry-delay 5 -o k.tar.bz2 '$MODEL_URL' && tar xjf k.tar.bz2 && rm k.tar.bz2"
fi

echo "== systemd timer"
install -m 0644 "$ROOT/repo/tools/video-pipeline/droplet/alice-render.service" /etc/systemd/system/alice-render.service
install -m 0644 "$ROOT/repo/tools/video-pipeline/droplet/alice-render.timer" /etc/systemd/system/alice-render.timer
chmod +x "$ROOT/repo/tools/video-pipeline/droplet/render-pending.sh"
systemctl daemon-reload
systemctl enable --now alice-render.timer

cat <<MSG

Installed. The timer runs at about 00:15, 06:15, 12:15 and 18:15 (UTC) and renders any approved script on the main branch.
  Output:   $STATE/out        (nothing is uploaded; a person watches and publishes)
  Logs:     journalctl -u alice-render.service
  Test now: systemctl start alice-render.service
  Picture:  uses video-scripts/assets/alice.png from the repo; a full-size file at $STATE/alice.png (owned by alice-render) takes priority.
MSG
