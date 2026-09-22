#!/usr/bin/env bash
# Compute CI scope from changed files (vs BASE_REF, default origin/main).
# Prints key=value lines suitable for GitHub Actions $GITHUB_OUTPUT.
set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
if [[ -n "${CHANGED_FILES:-}" ]]; then
  CHANGED="$CHANGED_FILES"
elif git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  CHANGED="$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || git diff --name-only "$BASE_REF" HEAD || true)"
else
  CHANGED="$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)"
fi

frontend=false
rust=false
docs=false
security=false

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    docs/*|*.md|assets/*|LICENSE|SECURITY.md|CONTRIBUTING.md|AGENTS.md)
      docs=true
      ;;
    # License/policy only — no compile.
    deny.toml)
      security=true
      ;;
    rust-toolchain|rust-toolchain.toml)
      rust=true
      ;;
    src-tauri/Cargo.toml|src-tauri/Cargo.lock)
      rust=true
      security=true
      ;;
    src-tauri/*)
      rust=true
      ;;
    # Frontend sources + Node lock/config.
    src/*|static/*|package.json|pnpm-lock.yaml|svelte.config.*|vite.config.*|tsconfig.*|components.json)
      frontend=true
      ;;
    # Self-test path: selector + workflow changes need full compile scope.
    .github/workflows/ci.yml|scripts/ci-affected.sh)
      frontend=true
      rust=true
      ;;
    # Tooling / hooks / non-CI scripts — no compile.
    .githooks/*|scripts/*|.vscode/*)
      ;;
  esac
done <<< "$CHANGED"

docs_only=false
if [[ "$frontend" == false && "$rust" == false ]]; then
  docs_only=true
fi

echo "frontend=$frontend"
echo "rust=$rust"
echo "docs_only=$docs_only"
echo "security=$security"
