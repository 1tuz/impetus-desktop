#!/usr/bin/env bash
# Unit checks for scripts/ci-affected.sh path classification.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci-affected.sh"
fail=0

scope() {
  CHANGED_FILES="$1" bash "$SCRIPT"
}

val() {
  local key="$1"
  local out="$2"
  printf '%s\n' "$out" | awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }'
}

expect() {
  local label="$1" key="$2" want="$3" out="$4"
  local got
  got="$(val "$key" "$out")"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL [$label] $key: want='$want' got='$got'" >&2
    echo "--- output ---" >&2
    echo "$out" >&2
    fail=1
  else
    echo "ok [$label] $key=$got"
  fi
}

# --- docs-only ---
out="$(scope $'docs/guides/development.md\nREADME.md')"
expect docs frontend false "$out"
expect docs rust false "$out"
expect docs docs_only true "$out"
expect docs security false "$out"

# --- deny.toml → security only ---
out="$(scope 'deny.toml')"
expect deny frontend false "$out"
expect deny rust false "$out"
expect deny security true "$out"
expect deny docs_only true "$out"

# --- githooks → no compile ---
out="$(scope $'.githooks/commit-msg\nscripts/check-commit-subject.py')"
expect hooks frontend false "$out"
expect hooks rust false "$out"
expect hooks security false "$out"
expect hooks docs_only true "$out"

# --- frontend sources ---
out="$(scope 'src/routes/+page.svelte')"
expect fe frontend true "$out"
expect fe rust false "$out"
expect fe docs_only false "$out"
expect fe security false "$out"

# --- frontend lock ---
out="$(scope 'pnpm-lock.yaml')"
expect lock frontend true "$out"
expect lock rust false "$out"
expect lock docs_only false "$out"

# --- package.json ---
out="$(scope 'package.json')"
expect pkg frontend true "$out"
expect pkg rust false "$out"

# --- rust crate ---
out="$(scope 'src-tauri/src/lib.rs')"
expect rustc frontend false "$out"
expect rustc rust true "$out"
expect rustc docs_only false "$out"
expect rustc security false "$out"

# --- Cargo.lock → rust + security ---
out="$(scope 'src-tauri/Cargo.lock')"
expect cargo frontend false "$out"
expect cargo rust true "$out"
expect cargo security true "$out"
expect cargo docs_only false "$out"

# --- rust-toolchain → rust, not security ---
out="$(scope 'rust-toolchain.toml')"
expect tool frontend false "$out"
expect tool rust true "$out"
expect tool security false "$out"

# --- ci-affected.sh self-test → full compile scope ---
out="$(scope 'scripts/ci-affected.sh')"
expect self frontend true "$out"
expect self rust true "$out"
expect self docs_only false "$out"

# --- frontend selfcheck script → pnpm test ---
out="$(scope 'scripts/event-reducer-selfcheck.ts')"
expect selfcheck frontend true "$out"
expect selfcheck rust false "$out"
expect selfcheck docs_only false "$out"

# --- workflow change → full compile scope ---
out="$(scope '.github/workflows/ci.yml')"
expect workflow frontend true "$out"
expect workflow rust true "$out"
expect workflow docs_only false "$out"

# --- mixed frontend + rust ---
out="$(scope $'src/app.css\nsrc-tauri/src/main.rs')"
expect mixed frontend true "$out"
expect mixed rust true "$out"
expect mixed docs_only false "$out"

# --- assets docs ---
out="$(scope 'assets/impetus-icon.png')"
expect assets frontend false "$out"
expect assets rust false "$out"
expect assets docs_only true "$out"

if [[ "$fail" -ne 0 ]]; then
  echo "ci-affected tests FAILED" >&2
  exit 1
fi
echo "ci-affected tests passed"
