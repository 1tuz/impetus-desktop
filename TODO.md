# Impetus Desktop backlog

Thin Tauri/Svelte shell over harness IPC. Daemon truth + terminal backlog =
sibling [`impetus`](../impetus) (`TODO.md`, `ARCHITECTURE.md`).

**Rules**

- Mark `[x]` only when the vertical slice works in the real app against a live
  `impetusd` (not mock-only, not web-preview-only).
- Prefer wiring existing `DesktopHarness` / `HarnessClient` APIs over new UI
  chrome. Stale “#308 unsupported” comments after IPC v7 rebase = bug.
- Hotkey chrome stays out of the main UI; list lives in Preferences only.

---

## Now

### P0 — talk to current daemon

- [x] Rebase path-dep off `impetus-wt-310-gui-adapter` (IPC **v5**) onto main
      `impetus` / merged adapter (IPC **v7**). Hello is exact-match — v5 client
      vs main `impetusd` hard-fails.
- [x] Live transcript: `subscribe_live` → Tauri events → streaming chunks/tools
      in UI (replace status-string “assistant” after send).
      *(Wire + UI done; mark live-daemon smoke when you confirm against `impetusd`.)*
- [x] Approval cards from events (`GetApprovalDetail` / pending id) — drop
      manual UUID paste in Composer.
      *(Auto-fill from events; paste field kept as fallback.)*

### P1 — parity with TUI intents (APIs already on main)

- [x] `set` / `get_execution_mode` Tauri + ModeSelect; delete prompt-banner
      ceiling in `agentModes.ts`.
- [x] Prompt intents: Steer / FollowUp (`UserPromptIntent`) + hotkeys
      (TUI: `Ctrl+T`, `Ctrl+Shift+P`).
- [x] Stop hotkey while busy (Esc or ⌘. — today Composer Stop button only).

### P2 — attach / stubs honesty

- [ ] Artifact upload for large paste (TUI pattern) where path-in-prompt is weak.
- [x] MCP attach: list from `~/.codex/config.toml` / `IMPETUS_MCP_CONFIG` via
      `list_mcp_servers` (honest — not daemon ListMcp IPC). Inserts `MCP: <id>`.
- [ ] Model picker: still Auto stub until ListModels IPC exists.

### P3 — optional / later

- [ ] Fork / checkpoint / `ListChildRuns` thin UI (client APIs on main).
- [ ] Command palette (⌘K today = focus prompt only; TUI has `Ctrl+P`).
- [x] Git branch picker under composer (Cursor-like; `git_*` Tauri commands).
- [ ] DMG install smoke checklist in README (App + Applications symlink).

---

## Done (do not re-litigate)

- Connect / probe / setup wizard (no auto-TCC)
- Topbar Connected/Offline + Connect / Start daemon / Disconnect (single CTA;
  rail foot is Preferences only)
- New Chat ⌘N + workspace folder-plus / ⌘O (`pick_folder`)
- Attach files ⌘G (`pick_files` real paths) + image paste/drop thumbs
- `cancel_session` + Composer Stop
- Approve/reject IPC (auto id from events; paste fallback)
- Themes (≥2 packs, Prefs) + ⌘⇧T cycle
- Hotkeys in Prefs only (`HOTKEY_HELP`); rail without kbd chrome
- Cursor-density chrome (rail / topbar / floating composer)
- Path-dep IPC **v7** + `subscribe_session_events` / execution mode / prompt intent
- Live CLI smoke vs `impetusd` mock: create → prompt → stream chunks
- CloseRouter `--provider-profile` smoke: `closerouter-ok` (deepseek flash)

### Smoke notes (2026-09-22)

- **Live mock daemon:** create → prompt → stream chunks OK.
- **CloseRouter `--provider-profile`:** OK (`closerouter-ok`, deepseek flash) —
  separate from Codex; Keychain `impetus`/`openrouter`. Do **not** put this key
  into `~/.codex/auth.json` / `OPENAI_API_KEY`.
- **ACP + `gpt-5.6-luna` / low (ChatGPT auth):** path fixed end-to-end.
  - Bug that looked like “auth broken”: `NO_BROWSER=1` in ACP profile env
    **removes** advertised `chat-gpt` (only `api-key` left). Drop `NO_BROWSER`
    for ChatGPT login; use `auth_method_id: "chat-gpt"` + isolated `CODEX_HOME`
    with chatgpt tokens; strip CloseRouter/`OPENAI_API_KEY` from child env.
  - Live result after fix: Codex ACP connects, Luna selected, then
    `usageLimitExceeded` — *Your workspace is out of credits* (OpenAI workspace
    quota, not Impetus/desktop wiring).

---

## Hotkey map (Cursor → Impetus Desktop)

Shown in Preferences. Bound in `+page.svelte` `onKeydown`.

| Chord | Action |
| --- | --- |
| ⌘N | New Chat |
| ⌘O | Open workspace |
| ⌘G | Attach files |
| ⌘↵ | Send |
| ⌘K | Focus prompt |
| ⌘B | Toggle session rail |
| ⌘, / ⌃⇧/ | Preferences |
| ⌘⇧T | Cycle theme pack |
| ⌘L | Clear local transcript |
| ⌘1…9 | Select chat by index |
| Ctrl+T | Steer intent |
| Ctrl+Shift+P | Cycle prompt intent |
| Esc | Close overlay / Stop turn |
| ⌘. | Stop turn |

---

## Notes

| Doc | Role |
| --- | --- |
| [README.md](README.md) | Install / run / trust |
| Sibling [impetus/TODO.md](../impetus/TODO.md) | Daemon + TUI backlog |
| Issue [#310](https://github.com/1tuz/impetus/issues/310) | GUI adapter track |

Inventory refresh: 2026-09-22 (desktop rebased to main IPC v7).

NOTE: P0 checkboxes marked for code wire-up. Confirm once against a live
`impetusd` before treating as production-ready.
