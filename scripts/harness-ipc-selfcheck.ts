/**
 * Wire-presence selfcheck for P0/P1 harness IPC (subscribe, mode, intent).
 * Run: node --experimental-strip-types scripts/harness-ipc-selfcheck.ts
 */
import { existsSync, readFileSync } from "node:fs";
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
    "list_child_runs",
    "get_child_run",
    "send_message_with_intent",
    "upload_artifact",
    "open_external",
    "read_workspace_file",
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
    "list_child_runs",
    "get_child_run",
    "upload_artifact",
    "open_external",
    "read_workspace_file",
  ]) {
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (!harness.includes("ArtifactRefDto") || !harness.includes("artifact: Option<ArtifactRefDto>")) {
    throw new Error("send_prompt must accept optional ArtifactRefDto");
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
  if (
    !(page.includes("applyHarnessEvent") || page.includes("applyEvent")) ||
    !page.includes("afterSeq")
  ) {
    throw new Error("page must use reducer + afterSeq cursor (not blind afterSeq:0 only)");
  }
  if (
    !page.includes("createSessionStore") &&
    !page.includes("createSessionTranscript") &&
    !page.includes("applyHarnessEvent")
  ) {
    throw new Error("page must wire harnessEventReducer (direct or via session store)");
  }
  if (page.includes("!messages.some((m) => m.role === \"user\" && m.text === text)")) {
    throw new Error("page still text-dedupes user intents");
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

check("PTY Tauri cmds registered and TerminalPanel wired", () => {
  for (const name of [
    "pty_start",
    "pty_attach",
    "pty_input",
    "pty_output",
    "pty_resize",
    "pty_detach",
    "pty_terminate",
    "pty_status",
  ]) {
    if (!harness.includes(`pub async fn ${name}`)) {
      throw new Error(`harness.rs missing ${name}`);
    }
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (!lib.includes("commands::terminal_env")) {
    throw new Error("lib.rs does not register terminal_env");
  }
  const panel = readFileSync(
    join(root, "src/lib/components/TerminalPanel.svelte"),
    "utf8",
  );
  const tabBarPath = join(root, "src/lib/components/TerminalTabBar.svelte");
  const tabBar = existsSync(tabBarPath)
    ? readFileSync(tabBarPath, "utf8")
    : "";
  const right = readFileSync(
    join(root, "src/lib/components/RightPanel.svelte"),
    "utf8",
  );
  if (!panel.includes('"pty_start"')) {
    throw new Error("TerminalPanel never invokes pty_start");
  }
  if (panel.includes('args: ["-l"]') || panel.includes("args: ['-l']")) {
    throw new Error("TerminalPanel must not pass login argv -l (daemon refuses)");
  }
  if (!panel.includes("args: []")) {
    throw new Error("TerminalPanel should start shell with empty args (non-login)");
  }
  if (!panel.includes("pty_output") || !panel.includes("pty_input")) {
    throw new Error("TerminalPanel missing output poll or input");
  }
  if (!panel.includes("pty_attach")) {
    throw new Error("TerminalPanel missing reconnect via pty_attach");
  }
  if (!panel.includes("pty_status")) {
    throw new Error("TerminalPanel missing pty_status for reconnect prune");
  }
  if (!panel.includes("pty_terminate")) {
    throw new Error("TerminalPanel missing pty_terminate for tab close");
  }
  if (
    !tabBar.includes('role="tablist"') &&
    !panel.includes('role="tablist"')
  ) {
    throw new Error("TerminalTabBar or TerminalPanel missing horizontal tablist");
  }
  if (right.includes("TerminalPanel") || right.includes("pty_start")) {
    throw new Error("RightPanel must not host terminal list / pty_start");
  }
  if (!page.includes("TerminalPanel")) {
    throw new Error("page does not mount TerminalPanel");
  }
});

check("ensure_runtime + impetus-daemon-control", () => {
  if (!harness.includes("pub async fn ensure_runtime")) {
    throw new Error("harness.rs missing ensure_runtime");
  }
  if (!lib.includes("commands::ensure_runtime")) {
    throw new Error("lib.rs does not register ensure_runtime");
  }
  if (
    !harness.includes("ensure_daemon_running_with") &&
    !harness.includes("impetus_daemon_control")
  ) {
    throw new Error("ensure path must use impetus-daemon-control");
  }
  // Production body only — unit tests may mention forbidden APIs as negative asserts.
  const prod = harness.split("\n#[cfg(test)]")[0] ?? harness;
  if (prod.includes("create_new(true)")) {
    throw new Error("Desktop must not own spawn.lock create");
  }
  if (!page.includes("ensure_runtime") && !page.includes("ensureRuntimeThenConnect")) {
    throw new Error("page missing ensure runtime path");
  }
});

check("extension package IPC registered (no local manifest)", () => {
  for (const name of [
    "list_extension_packages",
    "get_extension_package",
    "enable_extension_package",
    "disable_extension_package",
    "reload_extension_packages",
  ]) {
    if (!harness.includes(`pub async fn ${name}`)) {
      throw new Error(`harness.rs missing ${name}`);
    }
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (harness.includes("extension.toml") || harness.includes("ExtensionPackageManifest")) {
    throw new Error("Desktop must not parse extension manifests");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall harness-ipc checks passed");
