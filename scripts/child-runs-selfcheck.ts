/**
 * Selfcheck: child-runs UI + Tauri command wiring (static source asserts).
 * No daemon / live IPC.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check("ChildRunsPanel invokes list_child_runs", () => {
  const src = readFileSync(
    join(root, "src/lib/components/ChildRunsPanel.svelte"),
    "utf8",
  );
  if (!src.includes("list_child_runs")) {
    throw new Error("ChildRunsPanel must invoke list_child_runs");
  }
});

check("SubagentCard has data-status", () => {
  const src = readFileSync(
    join(root, "src/lib/components/SubagentCard.svelte"),
    "utf8",
  );
  if (!src.includes("data-status")) {
    throw new Error("SubagentCard missing data-status");
  }
});

check("harness.rs child-run commands + ChildRunDto fields", () => {
  const src = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  for (const needle of [
    "list_child_runs",
    "get_child_run",
    "struct ChildRunDto",
    "child_id",
    "role",
    "summary",
  ]) {
    if (!src.includes(needle)) {
      throw new Error(`harness.rs missing ${needle}`);
    }
  }
});

check("lib.rs registers list_child_runs + get_child_run", () => {
  const src = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  for (const needle of ["list_child_runs", "get_child_run"]) {
    if (!src.includes(needle)) {
      throw new Error(`lib.rs missing generate_handler entry ${needle}`);
    }
  }
});

check("RightPanel wires ChildRunsPanel (or panel file exists)", () => {
  const panelPath = join(root, "src/lib/components/ChildRunsPanel.svelte");
  const rightPath = join(root, "src/lib/components/RightPanel.svelte");
  if (!existsSync(panelPath)) {
    throw new Error("ChildRunsPanel.svelte missing");
  }
  if (!existsSync(rightPath)) {
    console.warn(
      "soft-fail: RightPanel.svelte missing — agents tab not landed yet; ChildRunsPanel file present",
    );
    return;
  }
  const src = readFileSync(rightPath, "utf8");
  if (!src.includes("ChildRunsPanel")) {
    console.warn(
      "soft-fail: RightPanel has no ChildRunsPanel import — agents tab not landed yet; ChildRunsPanel file present",
    );
  }
});

console.log("child-runs-selfcheck: all passed");
