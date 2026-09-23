# Rules for Coding Agents

Style (caveman), YAGNI/ponytail, **RTK**, and token reduction — see Codewhale
constitution / `~/.codewhale/RTK.md`:

- Global: `~/.codewhale/constitution.json` + `append_system_prompt` (RTK on every shell)
- Repo: `.codewhale/constitution.json` when present
- **Every `bash`:** only through `rtk …` (`rtk cargo`, `rtk git`, `rtk rg`, …)

This file covers product boundaries and verification for **Impetus Desktop**
only. Daemon / harness truth lives in sibling [`impetus`](../impetus).

## Persistent project memory

Before non-trivial work read `TODO.md`. After implementation update its status
in the same change. Stale documentation is a bug. `TODO.md` = open work only
(no `[x]` with Partial tails). Mark `[x]` only when the vertical slice works
in the real app against a live `impetusd`.

UI / visual polish: read `DESIGN.md` (token pointers + Visual QA log). Do not
invent a second design system beside `src/app.css` / `src/lib/tokens/`.

## Dev / QA — do not hijack the user's desktop

**Hard rule for agents:**

- **Do not** repeatedly `pnpm tauri dev`, kill/relaunch Impetus Desktop, move
  `/Applications/Impetus Desktop.app`, or `macos_capture` / AppleScript /
  `osascript` **focus** the native window unless the user **explicitly** asks
  for a live native smoke in that turn.
- **Default UI debug path:** Vite browser — `pnpm dev` (or existing Vite on
  `127.0.0.1:1420`). Layout, tabs, buttons, CSS, click handlers → browser /
  Cursor browser tools. Do not steal focus from the user's other windows.
- **Tauri-only** pieces (`invoke`, PTY, folder pickers) need the native shell
  **once**, when the user asks — not a loop of relaunch + focus + screenshot.
- Prefer `pnpm check` / `pnpm test` / selfchecks over live window automation.
- `macos-visual-qa` is opt-in: only when the user asks for visual QA of the
  running macOS app.

## Immovable Boundaries

- Thin shell: view + typed Tauri commands over Unix-socket IPC to `impetusd`.
  Window never owns session SQLite, Keychain secrets, or policy.
- Prefer wiring existing `HarnessClient` APIs over new UI chrome. Do not invent
  daemon capabilities the harness does not expose. There is no
  `DesktopHarness` / `impetus-desktop-adapter` crate — only path-dep
  `impetus-client` + `impetus-daemon-control` + Tauri commands in
  `src-tauri/src/commands/harness.rs`. Lifecycle (flock / spawn / readiness)
  lives in shared `impetus-daemon-control`; Desktop only resolves the binary
  and optional provider profiles.
- Do not auto-open macOS Security / TCC on launch; setup wizard or Prefs
  “later” only. Hotkey list lives in Preferences, not chrome.
- Secrets: never commit tokens/keys/passphrases; only opaque refs from daemon.
- Do not use `latest` image tags or unpinned git dependencies.
- Reject features whose only justification is vendor parity optics.

## Verification

Frontend (from repo root):

```zsh
pnpm verify
```

Rust (from `src-tauri/`):

```zsh
cargo fmt --all -- --check
cargo test --lib --bins
cargo check
cargo clippy --lib --bins -- -D warnings
```

On `src-tauri/Cargo.toml` or `src-tauri/Cargo.lock` changes, also run
`cargo audit` and `cargo deny check` from `src-tauri/`.

## CI and Verification

- Before handoff: `pnpm verify`; for Rust paths also the four cargo commands
  above (or equivalent).
- **PR CI** (`.github/workflows/ci.yml`): path-aware.
  - Frontend (`src/**`, locks, Svelte/Vite config) → `pnpm check` + `pnpm test`
  - Rust (`src-tauri/**`) → macOS Clippy/tests; Linux `fmt` + `check`
  - Security → `cargo audit` / `cargo deny` when lock/manifest/`deny.toml` change
  - Docs-only skips compile jobs
- **Gate** aggregator: success|skipped OK. Branch protection must require
  **only** the job named `Gate` (workflow `CI`). Do not require Frontend /
  macOS / Linux / Security individually — they may be skipped out of scope.
- Rust/security jobs check out sibling [`1tuz/impetus`](https://github.com/1tuz/impetus)
  next to this repo so `src-tauri` path dep
  `../../impetus/crates/impetus-client` resolves (same layout as local
  `Documents/projects/{impetus,impetus-desktop}`).
- Preview scope: `BASE_REF=origin/main ./scripts/ci-affected.sh`
- Selector self-check: `./scripts/tests/ci-affected.sh`
- No pages/release workflows in this repo (desktop ships as DMG/local build).

## Git and Commits

### Feature Branch Workflow (strictly required)

**NEVER PUSH DIRECTLY TO `main`.** Any push to main without PR is workflow
violation.

#### Before Starting Work

1. `git branch --show-current` — if `main`, stop and create feature branch
2. `gh issue list` — pick next task from `TODO.md` (create issue if missing)
3. Branch from current main:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/issue-42-short-description
   ```

#### Workflow

1. Work in feature branch (never in `main`)
2. Atomic commits with `closes #N`, `fixes #N`, or `refs #N`
3. Before push: `pnpm verify` (+ Rust checks if `src-tauri/` touched)
4. Push feature branch, then:
   ```bash
   gh pr create --fill
   gh pr merge --auto --squash
   ```
5. Required check `Gate` passes → GitHub auto-merges to main
6. After merge: `git checkout main && git pull`

#### Finish = ship (no ask)

When the requested vertical slice is implemented and verify/checks are green
on a feature branch, **complete the loop without asking**:

1. Commit (issue ref; no secrets / QA dumps / build junk)
2. Push (`-u` if needed)
3. `gh pr create --fill` if no open PR
4. `gh pr merge --auto --squash`

Do **not** ask “commit?”, “push?”, or “automerge?”. Unpushed finished work
counts as **incomplete**. Ask only for force-push, push to `main`, secrets in
diff, ambiguous scope, or when the user said stop / don’t push.

#### Auto-merge Setup (once per project)

In GitHub Repository Settings → General → Pull Requests:

- ✓ "Allow auto-merge"
- ✓ "Automatically delete head branches"

In Branch protection rules for `main`:

- ✓ "Require status checks to pass before merging"
- ✓ Required check: **only** `Gate` (do not add Frontend/macOS/Linux/Security)
- Enable auto-merge per PR: `gh pr merge --auto --squash`

### Commit Rules

- Commit message in English. Format:
  `type: Brief summary (closes #N)` or `type(scope): Summary (refs #N)`
- Allowed types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`
- Subject <= 72 characters, starts with lowercase (after `type:`), no trailing
  period
- Issue reference required: `closes #N` / `fixes #N` / `refs #N`. No issue →
  create issue first.
- Local hook: `git config core.hooksPath .githooks` then
  `scripts/check-commit-subject.py` runs via `.githooks/commit-msg`
- Do not use `--no-verify`, do not commit secrets, `.env`, `target/`,
  `node_modules/`, or generated runtime state.
- Do not amend/rebase/force-push or configure remote without explicit user
  instruction.

## Forbidden Files and Directories in Repository

- Build artifacts: `target/`, `**/target/`, `build/`, `.svelte-kit/`
- Secrets: `.env`, credentials, Keychain dumps
- IDE noise: `.DS_Store`, `__pycache__/`, `*.pyc`
- Runtime state: `*.db`, session logs, trace dumps

Before commit: `git status` and `git diff --cached`. Accidentally staged
forbidden file → `git reset HEAD <file>` and add to `.gitignore`.
