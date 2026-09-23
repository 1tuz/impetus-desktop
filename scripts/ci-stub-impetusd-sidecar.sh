#!/usr/bin/env bash
# CI/check only: create empty executable so Tauri externalBin path exists.
# Real sidecar: scripts/prepare-impetusd-sidecar.sh (before package / tauri build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
DEST="$BIN_DIR/impetusd-${TRIPLE}"

mkdir -p "$BIN_DIR"
# Prefer real binary if already prepared (local / package job).
if [[ -x "$DEST" && -s "$DEST" ]]; then
  echo "sidecar already present: $DEST"
  exit 0
fi
: >"$DEST"
chmod +x "$DEST"
echo "stub sidecar for check/clippy: $DEST"
