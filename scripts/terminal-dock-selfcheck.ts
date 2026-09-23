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

check("TerminalTabBar exists with horizontal tablist", () => {
  const path = join(root, "src/lib/components/TerminalTabBar.svelte");
  if (!existsSync(path)) throw new Error("TerminalTabBar.svelte missing");
  const src = readFileSync(path, "utf8");
  if (!src.includes('role="tablist"')) {
    throw new Error("TerminalTabBar missing role=tablist");
  }
  if (!src.includes("ondragstart") && !src.includes("dragstart")) {
    throw new Error("TerminalTabBar missing HTML5 DnD");
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
