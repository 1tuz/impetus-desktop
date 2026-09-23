# Impetus Desktop backlog

Thin Tauri/Svelte shell over harness IPC. Daemon truth =
sibling [`impetus`](../impetus) (`TODO.md`, `ARCHITECTURE.md`).

**Rules**

- Status words only: **DONE** / **PARTIAL** / **OPEN** / **BLOCKED BY CORE**.
- Mark DONE only when the vertical slice works in the real app against a live
  `impetusd` (not mock-only, not web-preview-only). PARTIAL = wire/UI present;
  live E2E still thin or unit-only.
- Prefer wiring existing `HarnessClient` APIs. Do not invent daemon
  capabilities. No `DesktopHarness` / `impetus-desktop-adapter` — path-dep
  `impetus-client` + Tauri `harness.rs` only.
- Hotkey list lives in Preferences only.
- Privilege: Desktop + `impetusd` as normal user — no PrivilegedHelper /
  LaunchDaemon / admin password for Connect or socket IPC.

---

## Compatibility

| Fact | Value |
| --- | --- |
| Wire | Negotiate overlap — Core `IPC_VERSION=14`, `IPC_MIN_SUPPORTED=12` |
| Path dep | `src-tauri/Cargo.toml` → `../../impetus/crates/impetus-client` |
| Daemon control | `impetus-daemon-control` via `ensure_daemon_running_with` + `discover_socket_path` (no local `spawn.lock` create) |
| CI pin | `.github/impetus-revision` = `7dc456a0062fd61c9d47d1abe2fed76fec56a12c` |
| Thin boundary | UI · view state · typed Tauri · HarnessClient only |

Bump pin when Desktop needs a new client API. Local path-dep floats sibling tip;
CI stays pinned.

---

## DONE

- [x] **Thin boundary** — view / view state / typed Tauri / `HarnessClient` only;
      no session SQLite, Keychain, or policy in the window.
- [x] **IPC pin v14** — negotiate 12..=14; CI SHA
      `7dc456a0062fd61c9d47d1abe2fed76fec56a12c`.
- [x] **Runtime ensure** — `ensure_daemon_running_with` (shared daemon-control);
      auto-ensure on open → Connected; Restart Runtime = Prefs → Advanced only.
- [x] **Bundled sidecar wiring** — `bundle.externalBin` `binaries/impetusd`;
      `scripts/prepare-impetusd-sidecar.sh`; resolve next to `current_exe()`
      (before PATH). Local evidence: release `.app` runs
      `Contents/MacOS/impetusd` on shared App Support socket; CLI `doctor`
      sees IPC 14 on that daemon. `package-macos.yml` asserts binary in
      bundle (dispatch/tag only — not Gate).
- [x] Connect / probe / setup wizard (no auto-TCC on launch).
- [x] Themes (≥2) + hotkeys in Prefs; session rail / topbar / composer chrome.
- [x] Sessions / `send_prompt` / intents / mode / cancel / live subscribe →
      transcript stream.
- [x] **Reconnect** resumes live subscribe with `lastSeq` (no transcript wipe).
- [x] Approvals from events + detail fetch.
- [x] Attach / upload artifact path; BranchSelect / MCP / ListModels via harness
      IPC (no local `git`, no Codex TOML parse).
- [x] Right panel Files | Review | Agents (workspace tree, diff, child runs).
- [x] Activity cards + reducer merge; `session.svelte.ts` transcript store.
- [x] **Extensions** Prefs panel — list / enable / disable / reload via public IPC.
- [x] **ModelSelect** including `service_tier` from daemon model APIs.
- [x] **PTY** daemon-owned; bottom multi-tab dock (≤8) with local
      session book reconnect via `pty_status` + `pty_attach` (no `PtyList`
      discovery UI). Collapse/hide does not terminate.
- [x] Probe `failure_kind` honesty; CSP non-null; no-privilege selfcheck;
      Hello version / Incompatible warn on topbar.
- [x] Perf baseline script; unit selfchecks (reducer, attachments, file-tree
      boundary, extensions, etc.).

---

## PARTIAL

- [ ] **Live E2E smokes** — many paths have unit selfchecks only. Still need
      live `impetusd` smoke for: chat seq/event identity, artifact upload +
      sent chips, Agents/`Child*`, PTY Start→type→Detach, ModelSelect,
      Extensions toggle, mock vs real provider profile honesty.
- [ ] Event reducer / `afterSeq` — unit covered; live duplicate-prompt /
      session-switch smoke open.
- [ ] Child runs — poll snapshot OK; live `Child*` parent-log events wait on
      Core richness.
- [ ] Daemon provider honesty UI (mock badge / profile paths) — wire present;
      live E2E vs mock + real profile open.
- [ ] Full perf matrix (cold start, large transcript, tree, diff, terminal) —
      placeholders only.

---

## OPEN

- [ ] **Release sign / notarize** — Developer ID + notarize + staple + GitHub
      Release DMG; Hardened Runtime entitlements; optional updater after signed
      channel exists.
- [ ] **CodeMirror** (optional) — syntax highlight in FilePreview / DiffView
      hunk nav. Not required for source of truth.
- [ ] **Command palette** — ⌘K today focuses prompt only.
- [ ] Fork / checkpoint thin UI (client APIs ready).
- [ ] Optional typed-codegen for command DTOs (`ts-rs` / specta) — YAGNI until
      drift hurts.
- [ ] **`ReadArtifact` / artifact metadata UI** — Core IPC ready; Desktop has
      upload path only.

---

## BLOCKED BY CORE

- [ ] **PtyList attach picker** — discover / pick arbitrary detached PTY ids
      unknown to this window. Desktop reconnects known ids via local
      `terminalDockPrefs` session book (`pty_status` prune + `pty_attach`)
      without ListPtys; picker for foreign/orphaned ids still needs Core.
- [ ] **Multi-artifact on `SendPrompt`** — Core accepts a single artifact ref
      today; multi-attach send needs daemon support.
- [ ] **Session delete / rename / archive IPC** — Desktop rail uses local
      presentation prefs (`sessionRailPrefs.ts`) until Core ships session
      lifecycle commands.

---

## Implementation order

1. Live E2E smokes on PARTIAL paths (chat seq, artifacts, PTY, Agents, models).
2. Sign/notarize when release channel needed.
3. Unblock when Core ships: PtyList, multi-artifact SendPrompt.
4. Optional polish: CodeMirror, command palette, fork/checkpoint UI,
   ReadArtifact UI.

---

## Hotkey map

Shown in Preferences. Bound in `+page.svelte`.

| Chord | Action |
| --- | --- |
| ⌘N | New Chat |
| ⌘O | Open workspace |
| ⌘G | Attach files |
| ⌘↵ | Send |
| ⌘K | Focus prompt (no palette yet) |
| ⌘B | Toggle session rail |
| ⌘, | Preferences |
| ⌘⇧T | Cycle theme pack |
| ⌘L | Clear local transcript |
| ⌘1…9 | Select chat by index |
| Ctrl+T | Steer intent |
| Ctrl+Shift+P | Cycle prompt intent |
| ⌘J / Ctrl+` | Toggle terminal dock |
| Esc / ⌘. | Close overlay / Stop turn |

---

## Related

| Doc | Role |
| --- | --- |
| [README.md](README.md) | Install / thin client / architecture |
| [`impetus/ARCHITECTURE.md`](../impetus/ARCHITECTURE.md) | Daemon SoT |
| [`impetus/TODO.md`](../impetus/TODO.md) | Core + TUI backlog |
| [AGENTS.md](AGENTS.md) | Boundaries + verify |
