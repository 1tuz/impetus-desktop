/**
 * Wire-presence selfcheck for P0/P1 harness IPC (subscribe, mode, intent).
 * Run: node --experimental-strip-types scripts/harness-ipc-selfcheck.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const harness = readFileSync(
  join(root, "src-tauri/src/commands/harness.rs"),
  "utf8",
);
const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
const modes = readFileSync(join(root, "src/lib/agentModes.ts"), "utf8");
const hotkeys = readFileSync(join(root, "src/lib/hotkeys.ts"), "utf8");

check("path-dep points at main impetus-client (not wt-310 adapter)", () => {
  if (cargo.includes("impetus-wt-310-gui-adapter")) {
    throw new Error("Cargo.toml still depends on wt-310 adapter");
  }
  if (cargo.includes("impetus-desktop-adapter")) {
    throw new Error("Cargo.toml still lists impetus-desktop-adapter");
  }
  if (!cargo.includes('../../impetus/crates/impetus-client"')) {
    throw new Error("impetus-client path-dep not rebased to main");
  }
});

check("Rust exposes subscribe / mode / intent / approval detail", () => {
  for (const name of [
    "subscribe_session_events",
    "unsubscribe_session_events",
    "set_execution_mode",
    "get_execution_mode",
    "get_approval_detail",
    "send_message_with_intent",
  ]) {
    if (!harness.includes(name)) {
      throw new Error(`harness.rs missing ${name}`);
    }
  }
  for (const name of [
    "subscribe_session_events",
    "set_execution_mode",
    "get_execution_mode",
    "get_approval_detail",
  ]) {
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
});

check("UI starts live subscribe and listens for harness://events", () => {
  if (!page.includes("subscribe_session_events")) {
    throw new Error("page never invokes subscribe_session_events");
  }
  if (!page.includes("harness://events")) {
    throw new Error("page never listens for harness://events");
  }
  if (!page.includes("send_prompt") || !page.includes("intent")) {
    throw new Error("page send_prompt path missing intent");
  }
});

check("ModeSelect uses set_execution_mode; no banner ceiling", () => {
  if (!page.includes("set_execution_mode")) {
    throw new Error("page missing set_execution_mode");
  }
  if (modes.includes("applyModePrefix") || modes.includes("#308")) {
    throw new Error("agentModes still has applyModePrefix / #308 ceiling");
  }
});

check("Stop + intent hotkeys documented", () => {
  if (!hotkeys.includes("Ctrl+T") || !hotkeys.includes("Ctrl+Shift+P")) {
    throw new Error("HOTKEY_HELP missing Steer / intent cycle");
  }
  if (!hotkeys.includes("Stop turn")) {
    throw new Error("HOTKEY_HELP missing Stop turn");
  }
  if (!page.includes("cyclePromptIntent") || !page.includes('key === "."')) {
    throw new Error("page missing intent cycle or ⌘. stop");
  }
  if (!page.includes('"steer"')) {
    throw new Error("page missing Steer intent assignment");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall harness-ipc checks passed");
