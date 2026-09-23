# Impetus Desktop

> **Impetus Desktop is the graphical client for Impetus.**

[![License](https://img.shields.io/badge/license-MIT-71717a.svg)](package.json)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20Svelte%205-18181b.svg)](#thin-client)
[![Backlog](https://img.shields.io/badge/backlog-TODO.md-27272a.svg)](TODO.md)

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%"
       alt="Impetus Desktop: thin shell over Unix-socket IPC to impetusd">
</p>

<p align="center">
  <img src="./assets/readme/app-chrome.png" width="100%"
       alt="Impetus Desktop: session rail, transcript, composer, Connected runtime">
</p>

## Thin client

Desktop is **view + view state + typed Tauri commands + `HarnessClient` only**.
The window never owns session SQLite, Keychain secrets, or policy — those stay
in [`impetusd`](../impetus). There is no `DesktopHarness` / adapter crate; the
shell uses path-dep `impetus-client` and Tauri commands in
`src-tauri/src/commands/harness.rs`.

| Layer | Owns |
| --- | --- |
| `impetusd` | sessions, events, policy, sandbox, secret **refs**, PTY |
| Impetus Desktop | UI, view state, typed invokes, transcript display |

## Quick Start

1. Install Impetus Desktop.
2. Open it.
3. Start working.

Desktop auto-ensures Runtime on open → **Connected**. No manual `impetusd`
Terminal.

## Install / run

**Normal use:** open the app. Desktop auto-ensures the runtime and reaches
**Connected**. You do **not** need a manual `cargo run -p impetusd` as the
primary path.

```bash
pnpm install
pnpm tauri build --bundles app,dmg
# DMG: Applications → /Applications — drag Impetus Desktop.app there
open -a "Impetus Desktop"
```

**Start / Restart Runtime** lives under Preferences → Advanced (recovery only),
not the everyday Connect path.

### DMG install smoke

1. Confirm **Applications** symlink → `/Applications`.
2. Drag **Impetus Desktop.app** into Applications.
3. `open -a "Impetus Desktop"` — window opens; runtime auto-connects.
4. Optional idle RSS: `pnpm perf:baseline` (skips if app not running).

## Key features

- Auto **ensure runtime** on open → Connected (phases surfaced in UI)
- Session rail, live transcript, composer (modes, intents, Stop)
- Attachments / artifacts via harness upload (single artifact ref on send today)
- Branch / git / MCP / workspace Files | Review | Agents — all via harness IPC
- **Extensions** list / enable / disable / reload — Preferences panel (public IPC)
- **ModelSelect** including `service_tier` from daemon model APIs
- **PTY** daemon-owned; reattach of last detached id (no `PtyList` IPC yet)
- Themes (≥2), hotkeys listed in Preferences only (no chrome clutter)

## Architecture

<p align="center">
  <img src="./assets/readme/request-path.svg" width="100%"
       alt="Request: Desktop UI → Tauri typed bridge → HarnessClient → Unix IPC (12..=14) → impetusd. Lifecycle: Tauri typed bridge → impetus-daemon-control → impetusd. GUI replaceable; Runtime authoritative.">
</p>

```text
Request:
  Desktop UI ──invoke──▶ Tauri typed bridge ──▶ HarnessClient
       ──Unix IPC (negotiate 12..=14)──▶ impetusd

Lifecycle:
  Tauri typed bridge ──▶ impetus-daemon-control ──▶ impetusd
```

GUI is **replaceable**; Runtime (`impetusd`) is **authoritative** — sessions,
events, policy, secret refs, and PTY stay in the daemon.

Core advertises `IPC_VERSION=14`, `IPC_MIN_SUPPORTED=12`. Desktop negotiates
overlap — not exact-match Hello. Lifecycle ensure uses shared
`impetus-daemon-control` (not a Desktop-owned spawn lock). CI pins sibling
`1tuz/impetus` to [`.github/impetus-revision`](.github/impetus-revision)
(`7dc456a0062fd61c9d47d1abe2fed76fec56a12c`).

Desktop and `impetusd` run as a **normal user** — no admin password,
PrivilegedHelper, or LaunchDaemon for Connect / socket IPC. Socket defaults to
`~/Library/Application Support/Impetus/harness.sock` (or `$IMPETUS_SOCKET`).

## Development

```bash
pnpm install
pnpm tauri dev          # auto ensure_runtime; Connected without manual daemon
pnpm verify             # check + selfchecks (not live daemon E2E)
```

Contributors may still run sibling `../impetus` (`cargo run -p impetusd`) when
debugging daemon-side behavior. Layout: `Documents/projects/{impetus,impetus-desktop}`.

```bash
cd src-tauri && cargo fmt && cargo check && cargo clippy -- -D warnings && cargo test
```

PR CI: path-aware **Gate** — require only job `Gate`. Details:
[AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [TODO.md](TODO.md).

## Related

- Terminal harness + TUI: [`impetus`](../impetus)
- Daemon architecture: [`impetus/ARCHITECTURE.md`](../impetus/ARCHITECTURE.md)
- Desktop backlog: [TODO.md](TODO.md)
