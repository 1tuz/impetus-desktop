/**
 * Selfcheck: topbar Runtime status, ensure_runtime, git branch, list_mcp_servers.
 * Run: node --experimental-strip-types scripts/chrome-connect-selfcheck.ts
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
const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
const topbar = readFileSync(
  join(root, "src/lib/components/AppTopbar.svelte"),
  "utf8",
);
const rail = readFileSync(
  join(root, "src/lib/components/SessionRail.svelte"),
  "utf8",
);
const composer = readFileSync(
  join(root, "src/lib/components/Composer.svelte"),
  "utf8",
);
const attach = readFileSync(
  join(root, "src/lib/components/AttachMenu.svelte"),
  "utf8",
);
const icon = readFileSync(
  join(root, "src/lib/components/ui/Icon.svelte"),
  "utf8",
);

check("ensure_runtime / start_daemon registered", () => {
  if (!harness.includes("pub async fn ensure_runtime")) {
    throw new Error("harness.rs missing ensure_runtime");
  }
  if (!harness.includes("pub async fn start_daemon")) {
    throw new Error("harness.rs missing start_daemon recovery alias");
  }
  if (!harness.includes("impetus_daemon_control::ensure_daemon_running")
    && !harness.includes("ensure_daemon_running_with")) {
    throw new Error("ensure path must delegate to impetus-daemon-control");
  }
  // Production body only — unit tests may mention forbidden APIs as negative asserts.
  const prodHarness = harness.split("\n#[cfg(test)]")[0] ?? harness;
  if (prodHarness.includes("OpenOptions::new()") && prodHarness.includes("daemon.spawn.lock")) {
    throw new Error("Desktop must not own spawn.lock create — use shared daemon-control");
  }
  if (!harness.includes("provider_profile") || !harness.includes("acp_profile")) {
    throw new Error("ensure_runtime must accept provider/acp profile args");
  }
  if (!harness.includes("provider_kind")) {
    throw new Error("DaemonProbe must expose provider_kind");
  }
  if (!harness.includes("failure_kind")) {
    throw new Error("DaemonProbe must expose failure_kind (stale vs incompatible)");
  }
  if (!harness.includes("is_protocol_incompatible_error")) {
    throw new Error("Start must classify protocol incompatible before unlink");
  }
  if (!lib.includes("commands::ensure_runtime") || !lib.includes("commands::start_daemon")) {
    throw new Error("lib.rs must register ensure_runtime + start_daemon");
  }
  if (!page.includes("ensure_runtime") || !page.includes("ensureRuntimeThenConnect")) {
    throw new Error("page missing ensureRuntimeThenConnect / ensure_runtime");
  }
  if (!page.includes("restartRuntime") || !page.includes("onRestartRuntime")) {
    throw new Error("page must wire Restart Runtime recovery");
  }
  if (!page.includes("providerProfile") || !page.includes("providerKind")) {
    throw new Error("page must pass profiles and track providerKind");
  }
});

check("connect path keeps transcript clean", () => {
  if (page.includes("hello.capabilities.join")) {
    throw new Error("must not join capabilities into system chat message");
  }
  if (page.includes("warning · mock backend") || page.includes("backend · mock provider")) {
    throw new Error("mock warning belongs in topbar badge, not chat dump");
  }
  // Success ensure must not dump binary path detail; errors may still surface p.detail.
  if (page.includes("if (p.detail) push")) {
    throw new Error("ensure success detail must not push into chat");
  }
  if (/caps:\s*\$\{hello\.capabilities/.test(page) || page.includes("`caps:")) {
    throw new Error("must not dump capability list into chat");
  }
});

check("mock backend is labeled (not silent)", () => {
  if (!harness.includes("mock provider")) {
    throw new Error("ensure must label mock spawn");
  }
  if (!topbar.includes("providerKind") || !topbar.includes("mock")) {
    throw new Error("AppTopbar must surface mock/provider badge");
  }
});

check("git branch commands use harness Git IPC", () => {
  for (const name of [
    "git_current_branch",
    "git_list_branches",
    "git_checkout_branch",
    "git_create_branch",
    "git_status",
    "get_diff",
    "get_file_diff",
  ]) {
    if (!harness.includes(`pub async fn ${name}`)) {
      throw new Error(`harness.rs missing ${name}`);
    }
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (harness.includes("Command::new(\"git\")") || harness.includes("require_git_root")) {
    throw new Error("local git shell-out still present");
  }
  if (!harness.includes("get_current_branch") || !harness.includes("list_branches")) {
    throw new Error("git cmds must call HarnessClient Git methods");
  }
  if (!composer.includes("BranchSelect") || !composer.includes("sessionId={selectedSessionId}")) {
    throw new Error("composer BranchSelect must pass sessionId");
  }
  if (!composer.includes("ModelSelect") || !composer.includes("connected={connected}")) {
    throw new Error("composer ModelSelect must pass connected + sessionId");
  }
  if (!icon.includes('"git-branch"')) {
    throw new Error("Icon registry missing git-branch");
  }
});

check("Files / Review use workspace + git harness IPC", () => {
  for (const name of ["list_workspace_dir", "read_workspace_file", "search_workspace_files"]) {
    if (!harness.includes(`pub async fn ${name}`)) {
      throw new Error(`harness.rs missing ${name}`);
    }
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (
    !harness.includes("list_workspace_dir") ||
    !harness.includes("read_workspace_file") ||
    !harness.includes("search_workspace_files")
  ) {
    throw new Error("workspace cmds must call HarnessClient Files methods");
  }
  const fileTree = readFileSync(join(root, "src/lib/components/FileTree.svelte"), "utf8");
  const review = readFileSync(join(root, "src/lib/components/ReviewPanel.svelte"), "utf8");
  const right = readFileSync(join(root, "src/lib/components/RightPanel.svelte"), "utf8");
  if (!fileTree.includes('invoke<DirListing>("list_workspace_dir"')) {
    throw new Error("FileTree must invoke list_workspace_dir");
  }
  if (!fileTree.includes('invoke<FileContent>("read_workspace_file"')) {
    throw new Error("FileTree must invoke read_workspace_file");
  }
  if (!fileTree.includes('invoke<SearchResult>("search_workspace_files"')) {
    throw new Error("FileTree must invoke search_workspace_files");
  }
  if (!review.includes('invoke<GitStatus>("git_status"') || !review.includes("get_file_diff")) {
    throw new Error("ReviewPanel must invoke git_status / get_file_diff");
  }
  if (!right.includes("sessionId") || page.includes("filesBlockedReason")) {
    throw new Error("RightPanel must take sessionId; page must drop blocked reasons");
  }
});

check("list_mcp_servers / list_models via IPC", () => {
  if (!harness.includes("pub async fn list_mcp_servers")) {
    throw new Error("harness.rs missing list_mcp_servers");
  }
  if (!harness.includes("pub async fn reload_mcp_servers")) {
    throw new Error("harness.rs missing reload_mcp_servers");
  }
  if (!harness.includes("pub async fn list_models")) {
    throw new Error("harness.rs missing list_models");
  }
  if (harness.includes("parse_mcp_servers_toml") || harness.includes(".codex/config.toml")) {
    throw new Error("local Codex MCP parse still present");
  }
  if (
    !lib.includes("commands::list_mcp_servers") ||
    !lib.includes("commands::reload_mcp_servers") ||
    !lib.includes("commands::list_models")
  ) {
    throw new Error("lib.rs does not register list/reload_mcp_servers/list_models");
  }
  if (!attach.includes("list_mcp_servers") || !attach.includes("reload_mcp_servers")) {
    throw new Error("AttachMenu must invoke list_mcp_servers and reload_mcp_servers");
  }
  if (!attach.includes("list_models")) {
    throw new Error("AttachMenu must invoke list_models");
  }
  if (!attach.includes("Reload MCP")) {
    throw new Error("AttachMenu missing Reload MCP button label");
  }
  const branch = readFileSync(
    join(root, "src/lib/components/BranchSelect.svelte"),
    "utf8",
  );
  if (!branch.includes("git_create_branch") || !branch.includes("Create")) {
    throw new Error("BranchSelect must expose create via git_create_branch");
  }
  if (!page.includes("handleMcpSelect") || !page.includes("MCP:")) {
    throw new Error("page missing MCP mention insert");
  }
  if (page.includes("MCP tools come from impetusd when configured")) {
    throw new Error("page still pushes MCP stub message");
  }
});

check("topbar Runtime status + recovery", () => {
  if (!topbar.includes("Runtime") || !topbar.includes("runtimePhase")) {
    throw new Error("AppTopbar must expose Runtime status / runtimePhase");
  }
  const phases = [
    "Starting",
    "Connected",
    "Reconnecting",
    "Offline",
    "Incompatible",
    "Failed",
  ];
  for (const label of phases) {
    if (!topbar.includes(`"${label}"`) && !topbar.includes(`'${label}'`) && !topbar.includes(label)) {
      throw new Error(`AppTopbar missing Runtime phase label ${label}`);
    }
  }
  if (topbar.includes("Start daemon") && topbar.includes('variant="primary"')) {
    // Primary Start daemon CTA must not remain the offline default.
    const primaryBlock = topbar.match(/variant="primary"[\s\S]{0,200}Start daemon/);
    if (primaryBlock) {
      throw new Error("AppTopbar must not keep Start daemon as primary offline CTA");
    }
  }
  if (!topbar.includes("Reconnect") || !topbar.includes("onReconnect")) {
    throw new Error("AppTopbar missing ghost Reconnect for Offline/Failed");
  }
  if (!topbar.includes("onDisconnect")) {
    throw new Error("AppTopbar missing Disconnect handler");
  }
  if (!page.includes("runtimePhase") || !page.includes("ensureRuntimeThenConnect")) {
    throw new Error("page missing runtimePhase / ensureRuntimeThenConnect");
  }
  if (!page.includes("ensure_runtime") || !page.includes("start_daemon")) {
    throw new Error("page must try ensure_runtime with start_daemon fallback");
  }
  if (!page.includes("restartRuntime") || !page.includes("onRestartRuntime")) {
    throw new Error("page must wire Restart Runtime recovery");
  }
  const prefs = readFileSync(join(root, "src/lib/PreferencesPanel.svelte"), "utf8");
  if (!prefs.includes("Restart Runtime") || !prefs.includes("onRestartRuntime")) {
    throw new Error("PreferencesPanel Advanced must expose Restart Runtime");
  }
});

check("rail does not duplicate Start / Connect", () => {
  if (rail.includes("rail-connect") || rail.includes("onStartDaemon")) {
    throw new Error("SessionRail must not duplicate topbar Start/Connect");
  }
  if (rail.includes("onConnect")) {
    throw new Error("SessionRail must not wire onConnect (topbar only)");
  }
});

check("tauri.conf.json CSP is set (not null)", () => {
  const conf = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  ) as { app?: { security?: { csp?: unknown } } };
  const csp = conf.app?.security?.csp;
  if (csp === null || csp === undefined || csp === "") {
    throw new Error("app.security.csp must be a non-null CSP string/object");
  }
});

check("topbar exposes IPC version badge", () => {
  if (!topbar.includes("ipcVersion")) {
    throw new Error("AppTopbar missing ipcVersion prop");
  }
  if (!topbar.includes("v{ipcVersion}")) {
    throw new Error("AppTopbar missing v{ipcVersion} badge pattern");
  }
});

check("RightPanel has agents or files|review tabs", () => {
  const right = readFileSync(
    join(root, "src/lib/components/RightPanel.svelte"),
    "utf8",
  );
  const hasAgents = right.includes('"agents"') || right.includes("right-panel-tab-agents");
  const hasFiles = right.includes('"files"') || right.includes("right-panel-tab-files");
  const hasReview = right.includes('"review"') || right.includes("right-panel-tab-review");
  if (!(hasAgents || (hasFiles && hasReview))) {
    throw new Error("RightPanel needs agents tab OR files|review at minimum");
  }
});

check("list_child_runs registered", () => {
  if (!lib.includes("commands::list_child_runs")) {
    throw new Error("lib.rs does not register list_child_runs");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall chrome-connect checks passed");
