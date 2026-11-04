#!/usr/bin/env bash
# CK-7728 part A: one-command runner for the Alice listener-test samples on a fresh Ubuntu droplet.
#
#   bash tools/alice-voice/run-on-droplet.sh [WORKDIR]
#
# Does, in order: checks free disk and memory; installs python3-venv, ffmpeg, curl and bzip2 (apt);
# creates a venv in WORKDIR (default ~/alice-voice-job) and installs sherpa-onnx 1.13.8, soundfile, numpy;
# downloads the two Kokoro model packages from the sherpa-onnx tts-models release; records their SHA-256;
# copies each package's LICENSE next to the samples; runs generate_samples.py at low priority (nice 10).
# Output: WORKDIR/out/A.wav B.wav C.wav, WORKDIR/out/licences/, WORKDIR/out/SHA256SUMS.txt.
#
# Zero spend, no secrets. It writes only inside WORKDIR (plus the apt packages) and never touches other
# services on the machine. Safe to re-run: downloads and the venv are reused.
set -euo pipefail

WORKDIR="${1:-$HOME/alice-voice-job}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
SHERPA_VERSION="1.13.8"   # the version the samples were first generated with (README)
MODELS=(kokoro-en-v0_19 kokoro-multi-lang-v1_0)

say() { printf '\n== %s\n' "$*"; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

say "Checking the machine"
mkdir -p "$WORKDIR"
free_kb=$(df -Pk "$WORKDIR" | awk 'NR==2{print $4}')
mem_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
echo "free disk: $((free_kb / 1024)) MiB, available memory: $((mem_kb / 1024)) MiB"
[ "$free_kb" -ge 3145728 ] || { echo "Need at least 3 GiB free in $WORKDIR" >&2; exit 1; }
[ "$mem_kb" -ge 1572864 ] || { echo "Need at least 1.5 GiB of available memory" >&2; exit 1; }

say "Installing system packages (python3-venv ffmpeg curl bzip2)"
$SUDO apt-get update -qq
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv ffmpeg curl bzip2

say "Python environment in $WORKDIR/venv"
[ -d "$WORKDIR/venv" ] || python3 -m venv "$WORKDIR/venv"
"$WORKDIR/venv/bin/pip" install --quiet --upgrade pip
"$WORKDIR/venv/bin/pip" install --quiet "sherpa-onnx==$SHERPA_VERSION" soundfile numpy

say "Downloading the Kokoro model packages (Apache 2.0, from the sherpa-onnx release)"
mkdir -p "$WORKDIR/models" "$WORKDIR/out/licences"
cd "$WORKDIR/models"
: > "$WORKDIR/out/SHA256SUMS.txt"
for m in "${MODELS[@]}"; do
  [ -f "$m.tar.bz2" ] || curl -fsSL --retry 4 --retry-delay 5 -o "$m.tar.bz2" "$BASE/$m.tar.bz2"
  sha256sum "$m.tar.bz2" | tee -a "$WORKDIR/out/SHA256SUMS.txt"
  [ -d "$m" ] || tar xjf "$m.tar.bz2"
  if [ -f "$m/LICENSE" ]; then
    cp "$m/LICENSE" "$WORKDIR/out/licences/$m-LICENSE.txt"
  else
    echo "WARNING: no LICENSE file in $m: read the model card and record the licence by hand" >&2
  fi
  [ -f "$m/README.md" ] && cp "$m/README.md" "$WORKDIR/out/licences/$m-README.md" || true
done

say "Generating samples A, B, C (low priority)"
nice -n 10 "$WORKDIR/venv/bin/python" "$HERE/generate_samples.py" \
  --v019 "$WORKDIR/models/kokoro-en-v0_19" \
  --v10 "$WORKDIR/models/kokoro-multi-lang-v1_0" \
  --out "$WORKDIR/out"

say "Done"
ls -l "$WORKDIR/out" "$WORKDIR/out/licences"
cat <<EOF

Next (a person, not this script):
  1. Listen to A, B and C. Confirm C (bf_emma, speaker 7) sounds like a different voice from B (bf_isabella).
     If C sounds like Isabella, the speaker id in generate_samples.py is wrong.
  2. Read $WORKDIR/out/licences/kokoro-multi-lang-v1_0-LICENSE.txt in full (sample B's model) and record the result on CK-7728.
  3. Copy A.wav B.wav C.wav off the machine (scp) for the listener test. Do NOT publish any Alice audio until a sample passes (MPC-7725 part C).
EOF
