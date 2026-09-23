/**
 * Selfcheck: ExtensionsPanel uses only daemon extension invokes (static asserts).
 * No marketplace / local extension.toml reads.
 */
import { readFileSync } from "node:fs";
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

const ALLOWED_INVOKES = new Set([
  "list_extension_packages",
  "get_extension_package",
  "enable_extension_package",
  "disable_extension_package",
  "reload_extension_packages",
]);

const panel = readFileSync(
  join(root, "src/lib/components/ExtensionsPanel.svelte"),
  "utf8",
);
const prefs = readFileSync(join(root, "src/lib/PreferencesPanel.svelte"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

check("ExtensionsPanel invokes list_extension_packages", () => {
  if (!panel.includes('"list_extension_packages"') && !panel.includes("'list_extension_packages'")) {
    throw new Error("ExtensionsPanel must invoke list_extension_packages");
  }
});

check("ExtensionsPanel invoke names are only extension commands", () => {
  const found = new Set<string>();
  const re = /invoke\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(panel)) !== null) {
    found.add(m[1]);
  }
  if (!found.size) {
    throw new Error("ExtensionsPanel has no invoke(...) calls");
  }
  for (const name of found) {
    if (!ALLOWED_INVOKES.has(name)) {
      throw new Error(`ExtensionsPanel uses disallowed invoke: ${name}`);
    }
  }
});

check("ExtensionsPanel has no local extension.toml / fs.readFile", () => {
  if (/extension\.toml/i.test(panel)) {
    throw new Error("ExtensionsPanel must not mention extension.toml");
  }
  if (/readFile|readTextFile|fs\.read/i.test(panel)) {
    throw new Error("ExtensionsPanel must not read files locally");
  }
});

check("ExtensionsPanel has enable / disable / reload", () => {
  for (const needle of [
    "enable_extension_package",
    "disable_extension_package",
    "reload_extension_packages",
  ]) {
    if (!panel.includes(`"${needle}"`) && !panel.includes(`'${needle}'`)) {
      throw new Error(`ExtensionsPanel missing invoke ${needle}`);
    }
  }
});

check("PreferencesPanel mentions Extensions + wires ExtensionsPanel", () => {
  if (!prefs.includes("Extensions")) {
    throw new Error("PreferencesPanel must mention Extensions");
  }
  if (!prefs.includes("ExtensionsPanel")) {
    throw new Error("PreferencesPanel must import/wire ExtensionsPanel");
  }
});

check("package.json test includes extensions-selfcheck", () => {
  if (!packageJson.includes("extensions-selfcheck.ts")) {
    throw new Error("package.json test script missing extensions-selfcheck.ts");
  }
});

console.log("extensions-selfcheck: all ok");
