/**
 * Selfcheck: ModelSelect is daemon-driven (no hardcoded model id lists).
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

const modelSelect = readFileSync(
  join(root, "src/lib/components/ModelSelect.svelte"),
  "utf8",
);
const composer = readFileSync(
  join(root, "src/lib/components/Composer.svelte"),
  "utf8",
);
const packageJson = readFileSync(join(root, "package.json"), "utf8");

check("ModelSelect invokes list_models / get_session_model / set_session_model", () => {
  for (const needle of ["list_models", "get_session_model", "set_session_model"]) {
    if (!modelSelect.includes(`"${needle}"`) && !modelSelect.includes(`'${needle}'`)) {
      throw new Error(`ModelSelect missing invoke ${needle}`);
    }
  }
});

check("ModelSelect has Provider / Model / Reasoning controls", () => {
  for (const needle of [
    'aria-label="Providers"',
    'aria-label="Models"',
    'aria-label="Reasoning"',
    "pickProvider",
    "pickModel",
    "pickReasoning",
  ]) {
    if (!modelSelect.includes(needle)) {
      throw new Error(`ModelSelect missing ${needle}`);
    }
  }
});

check("ModelSelect has no hardcoded vendor model id strings", () => {
  const bannedList = [
    /\[\s*["']gpt-/i,
    /\[\s*["']claude-/i,
    /=\s*\[\s*["']gpt-[^"']+["']\s*,/i,
    /=\s*\[\s*["']claude-[^"']+["']\s*,/i,
    /models\s*=\s*\[\s*["']gpt-/i,
    /MODEL_IDS|HARDCODED_MODELS|DEFAULT_MODELS/,
  ];
  for (const re of bannedList) {
    if (re.test(modelSelect)) {
      throw new Error(`ModelSelect looks like hardcoded model list (${re})`);
    }
  }
  // Exact vendor id literals the catalog must supply — not the UI.
  const bannedIds = [
    /["']gpt-4[^"']*["']/,
    /["']claude-3[^"']*["']/,
    /["']o1[^"']*["']/,
    /["']deepseek[^"']*["']/i,
  ];
  for (const re of bannedIds) {
    if (re.test(modelSelect)) {
      throw new Error(`ModelSelect hardcodes model id matching ${re}`);
    }
  }
  const quotedVendorIds =
    modelSelect.match(/["'](?:gpt-|claude-|o1|deepseek)[^"']*["']/gi) ?? [];
  if (quotedVendorIds.length >= 1) {
    throw new Error(
      `ModelSelect has hardcoded vendor model id string(s): ${quotedVendorIds.join(", ")}`,
    );
  }
});

check("Composer wires ModelSelect with sessionId + connected", () => {
  if (!composer.includes("ModelSelect")) {
    throw new Error("Composer missing ModelSelect");
  }
  if (!composer.includes("sessionId={selectedSessionId}")) {
    throw new Error("Composer ModelSelect must pass sessionId={selectedSessionId}");
  }
  if (!composer.includes("connected={connected}")) {
    throw new Error("Composer ModelSelect must pass connected={connected}");
  }
});

check("package.json test includes model-select-selfcheck", () => {
  if (!packageJson.includes("model-select-selfcheck.ts")) {
    throw new Error("package.json test script missing model-select-selfcheck.ts");
  }
});

console.log("model-select-selfcheck: all ok");
