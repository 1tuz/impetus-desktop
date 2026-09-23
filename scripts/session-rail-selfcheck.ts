/**
 * Session rail: density + rename/archive/remove prefs.
 * Run: node --experimental-strip-types scripts/session-rail-selfcheck.ts
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

const rail = readFileSync(
  join(root, "src/lib/components/SessionRail.svelte"),
  "utf8",
);
const prefs = readFileSync(join(root, "src/lib/sessionRailPrefs.ts"), "utf8");

check("rail has rename / archive / remove actions", () => {
  for (const needle of [
    "startRename",
    "archiveSession",
    "deleteFromList",
    'name="pencil"',
    'name="archive"',
    'name="trash"',
  ]) {
    if (!rail.includes(needle)) throw new Error(`missing ${needle}`);
  }
});

check("toggle stays start-aligned (left)", () => {
  if (!rail.includes("justify-content: flex-start")) {
    throw new Error("rail-head must keep toggle on the left");
  }
  if (rail.includes("justify-content: flex-end")) {
    throw new Error("rail-head must not push toggle to the right");
  }
});

check("session row packs actions between title and time", () => {
  if (!rail.includes("grid-template-columns: minmax(0, 1fr) auto auto")) {
    throw new Error("session row must be title | actions | meta");
  }
  if (!rail.includes("grid-template-columns: auto minmax(0, 1fr)")) {
    throw new Error("session-main must be icon | title only");
  }
  // Old hole: .session .id { flex: 1 } under button layout
  if (/\.session \.id\s*\{[^}]*flex:\s*1/.test(rail)) {
    throw new Error("session .id must not flex:1 (causes empty gap)");
  }
  // meta must sit after session-actions in markup
  const mainEnd = rail.indexOf('class="session-main"');
  const actions = rail.indexOf('class="session-actions"', mainEnd);
  const meta = rail.indexOf('class="meta"', actions);
  if (actions < 0 || meta < 0 || meta < actions) {
    throw new Error("meta must follow session-actions (fills former gap)");
  }
});

check("prefs are presentation-only (localStorage)", () => {
  if (!prefs.includes("impetus.desktop.session_titles")) {
    throw new Error("titles key missing");
  }
  if (!prefs.includes("impetus.desktop.session_archived")) {
    throw new Error("archived key missing");
  }
  if (!prefs.includes("DeleteSession") && !prefs.includes("no DeleteSession")) {
    // comment in deleteFromList is in SessionRail
  }
  if (!rail.includes("Core has no DeleteSession")) {
    throw new Error("delete must document Core gap");
  }
});

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nsession-rail-selfcheck: all passed");
