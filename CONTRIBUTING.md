# Contributing to Impetus Desktop

Thanks for improving Impetus Desktop. Keep changes narrow, reviewable, and
aligned with the thin-shell boundary (UI over harness IPC — daemon owns
authority).

## Before you start

1. Read [TODO.md](TODO.md) — open work. Stale docs are a bug; update in the same
   change.
2. Read [README.md](README.md) for run/install context.
3. Daemon / protocol truth: sibling [`impetus`](../impetus)
   (`ARCHITECTURE.md`, IPC version). Do not claim a planned IPC surface as
   shipped.
4. Discuss a substantial design or public-protocol change in an issue before
   investing in an implementation.

## Local setup and checks

Use macOS with Xcode (for Tauri), Node 22+, pnpm, and Rust `1.98.0`
(`rust-toolchain.toml`). Then:

```zsh
pnpm install
pnpm verify
```

For Rust changes under `src-tauri/`:

```zsh
cd src-tauri
cargo fmt --all -- --check
cargo check
cargo clippy --lib --bins -- -D warnings
cargo test --lib --bins
```

If a change modifies `src-tauri/Cargo.toml` or `src-tauri/Cargo.lock`, also:

```zsh
cd src-tauri
cargo audit
cargo deny check advisories bans sources licenses
```

Preview PR CI scope:

```zsh
BASE_REF=origin/main ./scripts/ci-affected.sh
./scripts/tests/ci-affected.sh
```

Install commit-subject hook once:

```zsh
git config core.hooksPath .githooks
```

Validate a subject without committing:

```zsh
python3 scripts/check-commit-subject.py --message 'feat: wire live transcript (refs #315)'
```

Update `.github/workflows/ci.yml` when changing the merge gate.

## Scope and safety

- Keep the desktop process free of session SQLite ownership, secret storage,
  and policy decisions — those stay in `impetusd`.
- Do not add raw credentials to the repository, fixtures, logs, or tests.
- Do not auto-prompt for Accessibility / Screen Recording / Full Disk Access
  on launch.
- Do not describe a stub, mock-only path, or planned IPC as a production
  feature.

## Pull requests and auto-merge

Explain the user-visible change, its boundary, and the checks you ran. Keep
unrelated formatting, refactors, and secret-bearing files out of the diff.

After creating a PR:

```bash
gh pr create --fill
gh pr merge --auto --squash
```

### One-time GitHub setup

Repository Settings → General → Pull Requests:

- Allow auto-merge
- Automatically delete head branches

Branch protection for `main`:

- Require status checks to pass before merging
- Required check: **only** `Gate` (workflow `CI`)

Do not require Frontend / macOS / Linux / Security as individual required
checks — path-aware CI skips them when out of scope; only `Gate` aggregates
`success|skipped`.

Use the repository's commit-subject convention (see [AGENTS.md](AGENTS.md)).

## Security issues

Do not open a public issue with a vulnerability or secret. Prefer a private
channel to maintainers, or follow sibling [`impetus`](../impetus) `SECURITY.md`
when present.
