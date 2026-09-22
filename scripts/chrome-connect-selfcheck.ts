/**
 * Selfcheck: topbar Connect, start_daemon, git branch, list_mcp_servers.
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

check("start_daemon registered", () => {
  if (!harness.includes("pub async fn start_daemon")) {
    throw new Error("harness.rs missing start_daemon");
  }
  if (!lib.includes("commands::start_daemon")) {
    throw new Error("lib.rs does not register start_daemon");
  }
  if (!page.includes("start_daemon") || !page.includes("startDaemon")) {
    throw new Error("page missing startDaemon wiring");
  }
});

check("git branch commands registered", () => {
  for (const name of [
    "git_current_branch",
    "git_list_branches",
    "git_checkout_branch",
  ]) {
    if (!harness.includes(`pub async fn ${name}`)) {
      throw new Error(`harness.rs missing ${name}`);
    }
    if (!lib.includes(`commands::${name}`)) {
      throw new Error(`lib.rs does not register ${name}`);
    }
  }
  if (!composer.includes("BranchSelect")) {
    throw new Error("composer missing BranchSelect");
  }
  if (!icon.includes('"git-branch"')) {
    throw new Error("Icon registry missing git-branch");
  }
});

check("list_mcp_servers registered + AttachMenu uses it", () => {
  if (!harness.includes("pub async fn list_mcp_servers")) {
    throw new Error("harness.rs missing list_mcp_servers");
  }
  if (!lib.includes("commands::list_mcp_servers")) {
    throw new Error("lib.rs does not register list_mcp_servers");
  }
  if (!attach.includes("list_mcp_servers")) {
    throw new Error("AttachMenu does not invoke list_mcp_servers");
  }
  if (!page.includes("handleMcpSelect") || !page.includes("MCP:")) {
    throw new Error("page missing MCP mention insert");
  }
  if (page.includes("MCP tools come from impetusd when configured")) {
    throw new Error("page still pushes MCP stub message");
  }
});

check("topbar Connect / Start daemon + status", () => {
  if (!topbar.includes("onConnect") || !topbar.includes("onDisconnect")) {
    throw new Error("AppTopbar missing Connect/Disconnect handlers");
  }
  if (!topbar.includes("Start daemon") || !topbar.includes("onStartDaemon")) {
    throw new Error("AppTopbar missing Start daemon");
  }
  if (!topbar.includes("connected") || !topbar.includes("offline")) {
    throw new Error("AppTopbar missing status labels");
  }
  if (!page.includes("onStartDaemon=") || !page.includes("daemonReachable")) {
    throw new Error("page does not wire topbar Start daemon / daemonReachable");
  }
});

check("rail does not duplicate Start / Connect", () => {
  if (rail.includes("rail-connect") || rail.includes("onStartDaemon")) {
    throw new Error("SessionRail must not duplicate topbar Start/Connect");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall chrome-connect checks passed");
