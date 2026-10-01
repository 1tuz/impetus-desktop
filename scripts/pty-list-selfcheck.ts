/**
 * Selfcheck: TerminalPanel PtyList attach picker (IPC v15).
 * Run: node --experimental-strip-types scripts/pty-list-selfcheck.ts
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
const panel = readFileSync(
  join(root, "src/lib/components/TerminalPanel.svelte"),
  "utf8",
);
const todo = readFileSync(join(root, "TODO.md"), "utf8");
const pin = readFileSync(join(root, ".github/impetus-revision"), "utf8").trim();
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

check("pty_list Tauri command + registration", () => {
  if (!harness.includes("pub async fn pty_list")) {
    throw new Error("harness.rs missing pty_list");
  }
  if (!harness.includes(".pty_list(")) {
    throw new Error("pty_list must call HarnessClient::pty_list");
  }
  if (!lib.includes("commands::pty_list")) {
    throw new Error("lib.rs does not register pty_list");
  }
});

check("PtySessionDto carries IPC v15 metadata fields", () => {
  for (const field of [
    "working_dir",
    "created_at_unix_ms",
    "origin",
    "args",
  ]) {
    if (!harness.includes(`pub ${field}:`)) {
      throw new Error(`PtySessionDto missing ${field}`);
    }
  }
  if (!harness.includes("fn pty_info_dto")) {
    throw new Error("harness.rs missing pty_info_dto for PtyList rows");
  }
});

check("TerminalPanel attach picker wires pty_list + pty_attach", () => {
  if (!panel.includes('"pty_list"')) {
    throw new Error("TerminalPanel never invokes pty_list");
  }
  if (!panel.includes("liveOnly: true") && !panel.includes("liveOnly:true")) {
    throw new Error("attach picker should request live_only inventory");
  }
  if (!panel.includes("toggleAttachPicker") || !panel.includes("attachPtyId")) {
    throw new Error("TerminalPanel missing attach picker handlers");
  }
  if (!panel.includes('aria-label="Attach PTY"')) {
    throw new Error("Attach control missing aria-label");
  }
  if (!panel.includes('aria-label="Live PTYs"')) {
    throw new Error("Attach menu missing listbox label");
  }
});

check("TODO.md: PtyList attach picker off BLOCKED BY CORE", () => {
  const blocked = todo.split("## BLOCKED BY CORE")[1]?.split("## ")[0] ?? "";
  if (/PtyList attach picker/i.test(blocked)) {
    throw new Error("PtyList attach picker still listed under BLOCKED BY CORE");
  }
  if (!/IPC.?v15|IPC pin v15/i.test(todo)) {
    throw new Error("TODO Compatibility must mention IPC v15");
  }
});

check("CI impetus pin bumped past PtyList (#395)", () => {
  if (!/^[0-9a-f]{40}$/.test(pin)) {
    throw new Error(`impetus-revision not a full SHA: ${pin}`);
  }
  // Old pin before PtyList / IPC v15.
  if (pin === "7dc456a0062fd61c9d47d1abe2fed76fec56a12c") {
    throw new Error("impetus-revision still on pre-PtyList SHA");
  }
  if (!ci.includes(`IMPETUS_REF: ${pin}`)) {
    throw new Error("ci.yml IMPETUS_REF must match .github/impetus-revision");
  }
});

check("package.json test includes pty-list-selfcheck", () => {
  if (!packageJson.includes("pty-list-selfcheck.ts")) {
    throw new Error("package.json test script missing pty-list-selfcheck");
  }
});

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall pty-list checks passed");
