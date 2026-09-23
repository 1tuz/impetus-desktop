#!/usr/bin/env bash
# Sample idle RSS for a running Impetus Desktop process (macOS).
# Cold-start timing is manual — see instructions below.
set -euo pipefail

# Match binary basename only — avoid false hits on repo path / worker argv.
PROC_NAME='impetus-desktop'

pids="$(pgrep -x "$PROC_NAME" 2>/dev/null || true)"
pid="${pids%%$'\n'*}"
if [[ -z "$pid" ]]; then
  cat <<'EOF'
SKIP: Impetus Desktop not running (no process named impetus-desktop).

Start the app first, then re-run:
  open -a "Impetus Desktop"
  pnpm perf:baseline

Or after a DMG install smoke:
  open /Applications/Impetus\ Desktop.app
  pnpm perf:baseline

Cold start (manual):
  1. Quit Impetus Desktop completely (Cmd+Q).
  2. time open -a "Impetus Desktop"   # wall clock until window usable
  3. pnpm perf:baseline               # idle RSS once UI is idle
EOF
  exit 0
fi

# ps rss= is kilobytes on macOS.
rss_kb="$(ps -o rss= -p "$pid" | tr -d '[:space:]')"
if [[ -z "${rss_kb:-}" ]]; then
  echo "SKIP: found pid $pid but no RSS"
  exit 0
fi

rss_mb="$((rss_kb / 1024)).$(( (rss_kb % 1024) * 10 / 1024 ))"

printf '%s\n' \
  "perf-baseline (idle, process alive)" \
  "  match:     $PROC_NAME (pid $pid)" \
  "  idle RSS:  ${rss_kb} KB (~${rss_mb} MiB)" \
  "" \
  "cold-ish placeholders (fill manually):" \
  "  cold start (s):  —" \
  "  idle RSS (MiB):  ${rss_mb}" \
  "  active chat RSS: —" \
  "  large transcript: —" \
  "" \
  "Cold start (manual):" \
  "  Quit app → time open -a \"Impetus Desktop\" → wait until window usable → re-run this script."
