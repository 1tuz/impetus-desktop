# Design notes — Impetus Desktop

Minimal project design notes for agents and humans. **Not** a full design system.

## Source of truth

| Layer | Where |
| --- | --- |
| Colors / type / space | `src/app.css` CSS variables (`--muted`, `--faint`, …) |
| Structure tokens | `src/lib/tokens/` |
| Desktop chrome bar | Skill `desktop-app-builder` → `visual-baseline.md` + Skill `tauri-ui` |
| Brand identity | Skill `frontend-design` (inside tokens — no one-off neon void) |

Do not invent parallel hex/spacing scales in feature pages. Prefer tokens.

## Visual direction (as shipped)

- Dark-first chat shell: calm near-black surface, sparse accent (Reconnect / Connect).
- Regions: thin rail / topbar status / transcript empty / bottom composer.
- Theme toggle lives in chrome for now; Preferences remains the durable home for theme packs.

## Naming consistency

| User-facing label | Prefer | Avoid in UI copy |
| --- | --- | --- |
| Offline recovery (chrome) | **Reconnect** | Primary **Start daemon** CTA |
| Stuck / Advanced recovery | **Restart Runtime** (Preferences → Advanced) | “Start daemon” / “Start impetusd” as the only instruction |
| Auto path on open / send | ensure_runtime (silent) | Asking user to `cargo run -p impetusd` as primary path |
| Process name (docs / tooltips OK) | `impetusd` | Competing CTA wording next to Reconnect / Restart Runtime |

Runtime phases in chrome: Starting · Connected · Reconnecting · Offline · Incompatible · Failed.

---

## Visual QA log (2026-09-22)

Pass: `macos-visual-qa` on live window `com.impetus.desktop` (empty/offline main).

### Fixed in source (verify with `pnpm tauri dev` — installed `.app` does not hot-reload)

| ID | Severity | Area | Mismatch | What “good” looks like | Done in |
| --- | --- | --- | --- | --- | --- |
| F001 | HIGH | Titlebar / a11y | Socket basename used `--faint` → unreadable on near-black | Status + sock on `--muted` (or better); readable offline label | `AppTopbar.svelte` |
| F002 | HIGH | Titlebar | `.sock` `max-width: 12ch` → `harness.soc…`; offline tooltip without full path | Basename mostly visible (`min(28ch, 36vw)`); `title` = full socket path | `AppTopbar.svelte` |
| F003 | MEDIUM | Empty state | Copy said “Start impetusd…” while button was **Start daemon** | Empty / composer name **Runtime** + **Restart Runtime** / auto-reconnect (no Start daemon primary) | `Transcript.svelte`, `Composer.svelte`, Prefs Advanced |
| F004 | MEDIUM | Composer | Empty says connect first; composer looked fully “live” | Soft `is-offline` cue + placeholder “Draft… (reconnects on send)” without changing send behavior | `Composer.svelte` |

### Open — needs product / design decision

| ID | Severity | Mismatch | Options to resolve |
| --- | --- | --- | --- |
| F004-residual | MEDIUM | Offline composer still accepts draft/send (connect-on-send). Cue only. | **A)** Keep draft + connect-on-send (document in empty state). **B)** Disable Send/attach until Runtime reachable (harder gate). Pick one and align empty + composer + topbar. |
| Theme sun in topbar | LOW | Theme control in chrome vs “theme lives in Preferences” baseline | Keep quick toggle **and** Preferences entry, or move toggle only into Preferences. |
| Status density | LOW | Brand + offline + sock in one row still tight at narrow widths | Collapse sock behind tooltip earlier; or two-line status under brand. |

### Verify checklist (after rebuild)

1. Offline status + sock readable; hover shows full path.
2. Empty / composer mention **Runtime** + Preferences → **Restart Runtime** (no primary Start daemon).
3. Offline composer quieter surface + draft placeholder; still typeable.
4. No layout clip / Reconnect / theme control regressions.
5. Open window auto-ensures Runtime; Restart Runtime only under Preferences → Advanced.

### Out of scope this pass

Light theme full audit, Preferences surfaces polish, connected/live session transcript density.

---

## Visual QA log (2026-09-23) — session rail densify

Live capture `assets/qa/rail-expanded-ok.png` (rail open).

| ID | Area | Fix |
| --- | --- | --- |
| R001 | Session rows | Rename / archive / remove always visible between title and time (local prefs; Core delete IPC still BLOCKED) |
| R002 | Empty gap in row | Row grid `title \| actions \| meta` — no `1fr` hole between id and timestamp |
| R003 | Rail toggle | Collapse/expand stay top-left (`justify-content: flex-start`); prefs bottom-left when collapsed |
| R004 | Files empty | Hide preview pane until session; no dual empty-state column void |

## Visual QA log (2026-09-23) — terminal bottom dock

| ID | Area | Fix |
| --- | --- | --- |
| T001 | Terminal region | Multi-tab bottom dock under `.stage-row` only (not right panel) |
| T002 | Tab chrome | Horizontal tabs match RightPanel tokens (`--elevated`, `--muted`, `--radius-md`) |
| T003 | Resize | `ns-resize` handle above tab bar; height + open persist in dock prefs |
