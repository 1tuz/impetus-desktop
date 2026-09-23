/**
 * Selfcheck: activity card wiring (reducer merge + ActivityCard source).
 * Main agent must wire this into package.json verify scripts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHarnessEventReducer } from "../src/lib/harnessEventReducer.ts";

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

check("harnessEventReducer activity merge", () => {
  assertHarnessEventReducer();
});

check("ActivityCard expandable quiet shell", () => {
  const src = readFileSync(
    join(root, "src/lib/components/ActivityCard.svelte"),
    "utf8",
  );
  for (const needle of [
    "data-status",
    "aria-expanded",
    "activity.title",
    "activity.detail",
    "toggle",
    "hasDetail",
    "onclick={toggle}",
    "expanded &&",
    'class="detail"',
  ]) {
    if (!src.includes(needle)) {
      throw new Error(`ActivityCard missing ${needle}`);
    }
  }
  if (src.includes("neon") || src.includes("#0ff") || src.includes("glow")) {
    throw new Error("ActivityCard looks neon — keep Cursor-quiet");
  }
});

check("ActivityCard status colors match SubagentCard pattern", () => {
  const src = readFileSync(
    join(root, "src/lib/components/ActivityCard.svelte"),
    "utf8",
  );
  const required = [
    'data-status="running"',
    'data-status="done"',
    'data-status="error"',
    "background: var(--muted)",
    "background: var(--success)",
    "background: var(--danger)",
  ];
  for (const needle of required) {
    if (!src.includes(needle)) {
      throw new Error(`ActivityCard status CSS missing ${needle}`);
    }
  }
});

check("Transcript routes activity to ActivityCard", () => {
  const src = readFileSync(
    join(root, "src/lib/components/Transcript.svelte"),
    "utf8",
  );
  if (!src.includes("ActivityCard")) {
    throw new Error("Transcript does not import ActivityCard");
  }
  if (!src.includes('kind === "activity"') && !src.includes("isActivity")) {
    throw new Error("Transcript missing activity kind branch");
  }
});

console.log("activity-card-selfcheck: all passed");
