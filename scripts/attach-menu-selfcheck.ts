/**
 * Regression selfcheck for composer + / attach menu / mode select / folder pick.
 * Run: node --experimental-strip-types scripts/attach-menu-selfcheck.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTACH_MENU_ITEMS,
  COMPOSER_PLUS_TARGET,
  assertAttachMenuContract,
  assertComposerPlusOpensAttachMenu,
  assertSkillPrefixDoesNotStack,
} from "../src/lib/attachMenu.ts";
import {
  AGENT_MODES,
  assertModeIdsMatchTerminal,
  assertPromptIntentCycle,
} from "../src/lib/agentModes.ts";
import { assertDropDispositionContract } from "../src/lib/chatDrop.ts";
import { assertComposerAttachmentsContract } from "../src/lib/composerAttachments.ts";

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

check("contract: plus target attach_menu", () => {
  assertComposerPlusOpensAttachMenu(COMPOSER_PLUS_TARGET);
});

check("contract: menu has context only (no mode skills)", () => {
  assertAttachMenuContract(ATTACH_MENU_ITEMS);
});

check("legacy skill prefix helper still replaces", () => {
  assertSkillPrefixDoesNotStack();
});

check("agent modes match terminal ExecutionMode set", () => {
  assertModeIdsMatchTerminal();
});

check("prompt intent cycles Prompt → Steer → FollowUp", () => {
  assertPromptIntentCycle();
});

check("page must set execution mode via IPC (no prompt banners)", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (page.includes("applyModePrefix")) {
    throw new Error("page still uses applyModePrefix banner hack");
  }
  if (!page.includes("set_execution_mode")) {
    throw new Error("page does not call set_execution_mode");
  }
  if (page.includes("${item.promptPrefix}${promptText}")) {
    throw new Error("page still concatenates skill prefixes (stacks modes)");
  }
});

check("page must not wire composer + to prefs opener", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (page.includes("onAttach={focusWorkspaceOrCreate}")) {
    throw new Error(
      "composer + still wired to focusWorkspaceOrCreate (opens Preferences)",
    );
  }
  if (!page.includes("onAttachAction=") || !page.includes("bind:attachOpen")) {
    throw new Error("page does not wire AttachMenu via attachOpen / onAttachAction");
  }
});

check("composer + must open attach menu; ModeSelect beside +", () => {
  const composer = readFileSync(
    join(root, "src/lib/components/Composer.svelte"),
    "utf8",
  );
  if (composer.includes('aria-label="New session"')) {
    throw new Error("composer + still labeled New session");
  }
  if (!composer.includes("AttachMenu") || !composer.includes("Open attach menu")) {
    throw new Error("composer + does not toggle AttachMenu");
  }
  if (!composer.includes("ModeSelect")) {
    throw new Error("composer missing ModeSelect next to +");
  }
  if (composer.includes("disabled={!connected}")) {
    throw new Error("composer still disables textarea when offline");
  }
});

check("prompt must stay typed when connected even without session", () => {
  const composer = readFileSync(
    join(root, "src/lib/components/Composer.svelte"),
    "utf8",
  );
  if (composer.includes("disabled={!connected || !selectedSessionId}")) {
    throw new Error("prompt still disabled without session (feels non-clickable)");
  }
});

check("Files attaches via file picker; Workspace opens folder picker", () => {
  const menu = readFileSync(
    join(root, "src/lib/components/AttachMenu.svelte"),
    "utf8",
  );
  if (menu.includes("filesMode") || menu.includes("/path/to/project")) {
    throw new Error("AttachMenu still uses manual path pane");
  }
  if (menu.includes("ATTACH_SKILLS") || menu.includes("skill:plan")) {
    throw new Error("AttachMenu still lists agent mode skills");
  }
  if (menu.includes('item.id === "image"') || menu.includes(">Image<")) {
    throw new Error("AttachMenu still has separate Image item");
  }
  const attach = readFileSync(join(root, "src/lib/attachMenu.ts"), "utf8");
  if (attach.includes('"image"') && attach.includes("Attach a picture")) {
    throw new Error("attachMenu still defines Image action");
  }
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("pickAttachedFiles") || !page.includes('id === "files"')) {
    throw new Error("Files action must open file picker (pickAttachedFiles)");
  }
  if (!page.includes('id === "workspace"') || !page.includes("pickWorkspaceFolder")) {
    throw new Error("Workspace action must open folder picker");
  }
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("pick_folder")) {
    throw new Error("missing pick_folder tauri command");
  }
});

check("rail New Chat + workspace folder-plus like Cursor", () => {
  const rail = readFileSync(
    join(root, "src/lib/components/SessionRail.svelte"),
    "utf8",
  );
  if (rail.includes("disabled={!canCreate}") || rail.includes("canCreate")) {
    throw new Error("rail still gates New Chat on connected");
  }
  if (rail.includes("impetus-logo") || rail.includes("brand-text")) {
    throw new Error("rail still shows Impetus logo/wordmark");
  }
  if (!rail.includes("New Chat") || !rail.includes("onOpenWorkspace")) {
    throw new Error("rail must have New Chat and workspace open action");
  }
  if (!rail.includes("folder-plus")) {
    throw new Error("rail missing folder-plus control for workspace");
  }
  if (rail.includes(">New session<")) {
    throw new Error("rail still says New session — use New Chat");
  }
});

check("Runtime status in topbar only (not rail)", () => {
  const rail = readFileSync(
    join(root, "src/lib/components/SessionRail.svelte"),
    "utf8",
  );
  // Must not be a primary rail-nav item; foot Connect also removed (issue #1).
  const navSlice = rail.slice(
    rail.indexOf('class="rail-nav"'),
    rail.indexOf('class="rail-section"'),
  );
  if (navSlice.includes(">Connect<") || navSlice.includes("onConnect")) {
    throw new Error("Connect still primary rail-nav action");
  }
  if (rail.includes("rail-connect") || rail.includes("onStartDaemon")) {
    throw new Error("rail must not duplicate topbar Start/Connect");
  }
  const top = readFileSync(
    join(root, "src/lib/components/AppTopbar.svelte"),
    "utf8",
  );
  if (!top.includes("Runtime") || !top.includes("runtimePhase")) {
    throw new Error("topbar must show Runtime phase status");
  }
  for (const phase of [
    "Starting",
    "Connected",
    "Reconnecting",
    "Offline",
    "Incompatible",
    "Failed",
  ]) {
    if (!top.includes(phase)) {
      throw new Error(`topbar missing Runtime phase label ${phase}`);
    }
  }
  // Primary Start daemon CTA removed — recovery via Prefs Restart / Reconnect.
  if (top.includes(">Start daemon<")) {
    throw new Error("topbar must not show primary Start daemon CTA");
  }
});

check("New session / send must not open Preferences", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  // Bug: offline createSession/sendPrompt set showPrefs = true.
  const createBlock = page.slice(
    page.indexOf("async function createSession"),
    page.indexOf("async function pickWorkspaceFolder"),
  );
  const sendBlock = page.slice(
    page.indexOf("async function sendPrompt"),
    page.indexOf("async function refreshStatus"),
  );
  if (createBlock.includes("showPrefs = true")) {
    throw new Error("createSession still opens Preferences");
  }
  if (sendBlock.includes("showPrefs = true")) {
    throw new Error("sendPrompt still opens Preferences");
  }
  const rail = readFileSync(
    join(root, "src/lib/components/SessionRail.svelte"),
    "utf8",
  );
  if (rail.includes("opens Preferences")) {
    throw new Error("New session tooltip still mentions opening Preferences");
  }
});

check("web preview must not crash New session via invoke", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("inTauriShell")) {
    throw new Error("missing inTauriShell guard");
  }
  const createBlock = page.slice(
    page.indexOf("async function createSession"),
    page.indexOf("async function pickWorkspaceFolder"),
  );
  if (!createBlock.includes("inTauriShell")) {
    throw new Error("createSession must bail in browser before invoke");
  }
  if (!createBlock.includes("Web preview")) {
    throw new Error("createSession should explain web preview limit once");
  }
  if (!createBlock.includes("pickIfMissing") || !createBlock.includes("folder +")) {
    throw new Error("New Chat must not auto-open folder picker; ask for workspace first");
  }
});

check("chat drag-drop: disposition + page wiring", () => {
  assertDropDispositionContract();
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("onDragDropEvent") || !page.includes("handleDroppedPaths")) {
    throw new Error("page missing Tauri drag-drop listener");
  }
  if (!page.includes("classify_paths")) {
    throw new Error("page does not classify dropped paths");
  }
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("classify_paths")) {
    throw new Error("missing classify_paths command");
  }
});

check("composer image chips: paste + thumb + remove", () => {
  assertComposerAttachmentsContract();
  const composer = readFileSync(
    join(root, "src/lib/components/Composer.svelte"),
    "utf8",
  );
  if (!composer.includes("onpaste") || !composer.includes("thumb-x")) {
    throw new Error("composer missing paste handler or thumb remove");
  }
  if (!composer.includes("collectPastedImages")) {
    throw new Error("composer must use collectPastedImages (empty File.type fix)");
  }
  if (!composer.includes("readImagesFromClipboardApi")) {
    throw new Error("composer must fall back to clipboard.read() for web paste");
  }
  if (!composer.includes("attachments")) {
    throw new Error("composer missing attachments chip row");
  }
  if (!composer.includes("openPreview") || !composer.includes("preview-scrim")) {
    throw new Error("composer missing image lightbox preview");
  }
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("save_temp_image") || !page.includes("addImageFiles")) {
    throw new Error("page missing paste→save_temp_image wiring");
  }
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("save_temp_image") || !harness.includes("read_image_bytes")) {
    throw new Error("missing save_temp_image / read_image_bytes commands");
  }
});

check("Cursor-like hotkeys: N chat, O workspace, G files", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  const keys = page.slice(page.indexOf("function onKeydown"), page.indexOf("onMount(() =>"));
  if (!keys.includes('k === "o"') || !keys.includes("pickWorkspaceFolder")) {
    throw new Error("missing ⌘O → open workspace");
  }
  if (!keys.includes('k === "g"') || !keys.includes("pickAttachedFiles")) {
    throw new Error("missing ⌘G → attach files");
  }
  if (!keys.includes('k === "n"') || !keys.includes("createSession")) {
    throw new Error("missing ⌘N → New Chat");
  }
  const help = readFileSync(join(root, "src/lib/hotkeys.ts"), "utf8");
  if (!help.includes("Open workspace") || !help.includes("Attach files")) {
    throw new Error("HOTKEY_HELP must list Cursor-aligned O/G actions");
  }
});

check("gap close: cancel_session + pick_files IPC", () => {
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("cancel_session") || !harness.includes("pick_files")) {
    throw new Error("missing cancel_session / pick_files commands");
  }
  const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  if (!lib.includes("cancel_session") || !lib.includes("pick_files")) {
    throw new Error("commands not registered in lib.rs");
  }
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("cancelTurn") || !page.includes("cancel_session")) {
    throw new Error("page missing cancelTurn wiring");
  }
  if (!page.includes("pick_files")) {
    throw new Error("desktop Files must use pick_files for real paths");
  }
  const composer = readFileSync(
    join(root, "src/lib/components/Composer.svelte"),
    "utf8",
  );
  if (!composer.includes("onCancel") || !composer.includes("canCancel")) {
    throw new Error("composer missing Stop while busy");
  }
});

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
