/**
 * Terminal bottom dock: prefs helpers + multi-tab wiring (static + unit).
 * Run: node --experimental-strip-types scripts/terminal-dock-selfcheck.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clampDockHeight,
  DOCK_HEIGHT_DEFAULT,
  DOCK_HEIGHT_MAX,
  DOCK_HEIGHT_MIN,
  MAX_TERMINAL_TABS,
  nextSessionTitle,
  pickNeighborTabId,
  ptyStateLooksAlive,
  reorderTabIds,
  shellBasename,
} from "../src/lib/terminalDockPrefs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

check("reorderTabIds moves and is pure", () => {
  const order = ["a", "b", "c", "d"];
  const moved = reorderTabIds(order, "a", "c");
  if (moved.join(",") !== "b,c,a,d") {
    throw new Error(`unexpected reorder: ${moved.join(",")}`);
  }
  if (order.join(",") !== "a,b,c,d") {
    throw new Error("reorderTabIds must not mutate input");
  }
  if (reorderTabIds(order, "a", "a").join(",") !== "a,b,c,d") {
    throw new Error("same-id reorder should copy");
  }
  if (reorderTabIds(order, "x", "a").join(",") !== "a,b,c,d") {
    throw new Error("unknown id should copy");
  }
});

check("pickNeighborTabId prefers left neighbor", () => {
  const order = ["a", "b", "c"];
  if (pickNeighborTabId(order, "b") !== "a") {
    throw new Error("closing middle should prefer left");
  }
  if (pickNeighborTabId(order, "a") !== "b") {
    throw new Error("closing first should pick next");
  }
  if (pickNeighborTabId(order, "c") !== "b") {
    throw new Error("closing last should pick previous");
  }
  if (pickNeighborTabId(["only"], "only") !== null) {
    throw new Error("closing last remaining must be null");
  }
});

check("nextSessionTitle gap-fills", () => {
  if (nextSessionTitle([]) !== "session 1") {
    throw new Error("empty → session 1");
  }
  if (nextSessionTitle(["session 1", "session 2"]) !== "session 3") {
    throw new Error("sequential next");
  }
  if (nextSessionTitle(["session 1", "session 3"]) !== "session 2") {
    throw new Error("gap fill failed");
  }
  if (nextSessionTitle(["zsh", "session 1"]) !== "session 2") {
    throw new Error("ignore non-session titles");
  }
});

check("clampDockHeight + shellBasename + ptyStateLooksAlive", () => {
  if (clampDockHeight(Number.NaN) !== DOCK_HEIGHT_DEFAULT) {
    throw new Error("NaN height should default");
  }
  if (clampDockHeight(10) !== DOCK_HEIGHT_MIN) {
    throw new Error("below min not clamped");
  }
  if (clampDockHeight(9999) !== DOCK_HEIGHT_MAX) {
    throw new Error("above max not clamped");
  }
  if (shellBasename("/bin/zsh") !== "zsh") {
    throw new Error("shellBasename failed");
  }
  if (!ptyStateLooksAlive("Running")) {
    throw new Error("Running should look alive");
  }
  if (!ptyStateLooksAlive("Detached")) {
    throw new Error("Detached should look alive");
  }
  if (!ptyStateLooksAlive("Starting")) {
    throw new Error("Starting should look alive");
  }
  if (ptyStateLooksAlive("Exited")) {
    throw new Error("Exited must not look alive");
  }
  if (MAX_TERMINAL_TABS !== 8) {
    throw new Error("MAX_TERMINAL_TABS must stay 8");
  }
});

check("TerminalTabBar horizontal tabs + Terminal label + hide≠close", () => {
  const path = join(root, "src/lib/components/TerminalTabBar.svelte");
  if (!existsSync(path)) throw new Error("TerminalTabBar.svelte missing");
  const src = readFileSync(path, "utf8");
  if (!src.includes('role="tablist"')) {
    throw new Error("TerminalTabBar missing role=tablist");
  }
  if (!src.includes("ondragstart") && !src.includes("dragstart")) {
    throw new Error("TerminalTabBar missing HTML5 DnD");
  }
  if (!src.includes("dock-label") || !src.includes("Terminal")) {
    throw new Error("TerminalTabBar must show Terminal label");
  }
  if (!src.includes("Hide terminal (keeps sessions)")) {
    throw new Error("hide control must document keep-sessions");
  }
  // Hide uses chevron; tab close uses x — do not reuse same affordance alone.
  if (!src.includes('name="chevron-down"')) {
    throw new Error("hide control should use chevron-down (not only x)");
  }
});

check("RightPanel has no vertical terminal sidebar", () => {
  const right = readFileSync(
    join(root, "src/lib/components/RightPanel.svelte"),
    "utf8",
  );
  if (right.includes("TerminalPanel") || right.includes("pty_start")) {
    throw new Error("RightPanel must not contain TerminalPanel / pty_start");
  }
  if (!right.includes("Files") || !right.includes("Review") || !right.includes("Agents")) {
    throw new Error("RightPanel should stay Files|Review|Agents");
  }
});

check("TerminalPanel reconnect uses pty_status + pty_attach", () => {
  const panel = readFileSync(
    join(root, "src/lib/components/TerminalPanel.svelte"),
    "utf8",
  );
  if (!panel.includes('"pty_status"') && !panel.includes("'pty_status'")) {
    throw new Error("TerminalPanel must invoke pty_status for reconnect");
  }
  if (!panel.includes("pty_attach")) {
    throw new Error("TerminalPanel must invoke pty_attach for survivors");
  }
  if (!panel.includes("args: []")) {
    throw new Error("pty_start must use empty args");
  }
  if (!panel.includes("TerminalTabBar")) {
    throw new Error("TerminalPanel must mount TerminalTabBar");
  }
  if (!panel.includes("saveDockChrome") || !panel.includes("loadSessionBook")) {
    throw new Error("TerminalPanel must persist dock chrome + session book");
  }
  if (!panel.includes("nextSessionTitle") || !panel.includes("pickNeighborTabId")) {
    throw new Error("TerminalPanel must use session naming + neighbor pick");
  }
  if (!panel.includes("EmptyState")) {
    throw new Error("empty dock must show EmptyState CTA");
  }
  if (!panel.includes("MesloLGS NF")) {
    throw new Error("xterm must prefer Nerd Font stack for glyph compatibility");
  }
});

check("collapse/hide does not terminate", () => {
  const panel = readFileSync(
    join(root, "src/lib/components/TerminalPanel.svelte"),
    "utf8",
  );
  // hideDock / open=false path must not sit beside pty_terminate in same handler.
  const hideMatch = panel.match(
    /function\s+hideDock\s*\([^)]*\)\s*\{[\s\S]*?\}/,
  );
  if (!hideMatch) {
    throw new Error("missing hideDock helper");
  }
  if (hideMatch[0].includes("pty_terminate")) {
    throw new Error("hideDock must not call pty_terminate");
  }
  // Assign open = false should not share a block with terminate.
  const openFalseBlocks = [
    ...panel.matchAll(/open\s*=\s*false[\s\S]{0,120}/g),
  ].map((m) => m[0]);
  for (const block of openFalseBlocks) {
    if (block.includes("pty_terminate")) {
      throw new Error("open=false path must not terminate PTY");
    }
  }
});

check("⌘J path toggles open without terminate (page hotkey)", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes('event.key.toLowerCase() === "j"')) {
    throw new Error("page missing ⌘J handler");
  }
  if (!page.includes("terminalOpen = !terminalOpen")) {
    throw new Error("⌘J must toggle terminalOpen");
  }
  // Hotkey block must not call pty_terminate.
  const jBlock = page.match(
    /event\.key\.toLowerCase\(\) === "j"[\s\S]{0,400}?return;/,
  );
  if (!jBlock) throw new Error("could not locate ⌘J handler block");
  if (jBlock[0].includes("pty_terminate")) {
    throw new Error("⌘J handler must not terminate PTY");
  }
  if (!page.includes("let terminalOpen = $state(false)")) {
    throw new Error("terminalOpen must default closed (prefs restore open)");
  }
});

check("auto-create when dock opens empty", () => {
  const panel = readFileSync(
    join(root, "src/lib/components/TerminalPanel.svelte"),
    "utf8",
  );
  if (!panel.includes("autoCreateTried") || !panel.includes("createTerminal()")) {
    throw new Error("open-empty path must auto-create a working terminal");
  }
  if (!panel.includes("open = blob.dock.open")) {
    throw new Error("must restore dock open/closed from prefs exactly");
  }
});

check("terminal_env command wired", () => {
  const envRs = join(root, "src-tauri/src/commands/terminal_env.rs");
  if (!existsSync(envRs)) throw new Error("terminal_env.rs missing");
  const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  if (!lib.includes("commands::terminal_env")) {
    throw new Error("lib.rs missing terminal_env registration");
  }
  const mod = readFileSync(
    join(root, "src-tauri/src/commands/mod.rs"),
    "utf8",
  );
  if (!mod.includes("terminal_env")) {
    throw new Error("commands/mod.rs missing terminal_env");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall terminal-dock selfchecks passed");
