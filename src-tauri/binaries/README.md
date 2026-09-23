# Bundled `impetusd` sidecar (Tauri `bundle.externalBin`)

Do not commit the binary. Before `pnpm tauri build`:

```zsh
./scripts/prepare-impetusd-sidecar.sh
```

Produces `impetusd-<rustc-host-triple>` (e.g. `impetusd-aarch64-apple-darwin`).
Resolver order at runtime: `IMPETUSD_BIN` / `IMPETUS_IMPETUSD_PATH` → next-to-exe
(bundled) → sibling `impetus/target` → PATH.

CI `cargo check` / clippy: `scripts/ci-stub-impetusd-sidecar.sh` creates an empty
path so Tauri build.rs does not fail (real binary only for package workflow).
