#!/usr/bin/env bash
# Prepare Tauri externalBin sidecar: binaries/impetusd-<target-triple>
# Prefer sibling release build; fall back to debug. Does not commit the binary.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
DEST="$BIN_DIR/impetusd-${TRIPLE}"

SIBLING_RELEASE="$ROOT/../impetus/target/release/impetusd"
SIBLING_DEBUG="$ROOT/../impetus/target/debug/impetusd"
SRC=""

if [[ -n "${IMPETUSD_BIN:-}" && -f "${IMPETUSD_BIN}" ]]; then
  SRC="$IMPETUSD_BIN"
elif [[ -f "$SIBLING_RELEASE" ]]; then
  SRC="$SIBLING_RELEASE"
elif [[ -f "$SIBLING_DEBUG" ]]; then
  SRC="$SIBLING_DEBUG"
else
  echo "error: impetusd not found. Build sibling: cargo build -p impetusd --release" >&2
  echo "  looked: $SIBLING_RELEASE" >&2
  echo "  or set IMPETUSD_BIN" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cp -f "$SRC" "$DEST"
chmod +x "$DEST"
echo "prepared sidecar: $DEST (from $SRC)"
