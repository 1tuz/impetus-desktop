/**
 * Selfcheck: Files/Review stay on harness IPC — no local fs / shell git in Svelte.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertTextPreviewContract } from "../src/lib/textPreview.ts";

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

const LOCAL_FS_NEEDLES = [
  "plugin-fs",
  "readDir",
  "readTextFile",
  "writeTextFile",
  "@tauri-apps/plugin-fs",
  "from \"fs\"",
  "from 'fs'",
  "node:fs",
];

check("FileTree: list_workspace_dir (not local fs)", () => {
  const src = readFileSync(
    join(root, "src/lib/components/FileTree.svelte"),
    "utf8",
  );
  if (!src.includes("list_workspace_dir")) {
    throw new Error("FileTree must invoke list_workspace_dir");
  }
  for (const needle of LOCAL_FS_NEEDLES) {
    if (src.includes(needle)) {
      throw new Error(`FileTree must not use local fs (${needle})`);
    }
  }
});

check("FileTree: read_workspace_file → FilePreview language", () => {
  const src = readFileSync(
    join(root, "src/lib/components/FileTree.svelte"),
    "utf8",
  );
  if (!src.includes("read_workspace_file")) {
    throw new Error("FileTree must invoke read_workspace_file");
  }
  if (!src.includes("guessLanguage") || !src.includes("language={previewLanguage}")) {
    throw new Error("FileTree must pass guessLanguage → FilePreview language");
  }
  if (!src.includes("isImagePreviewPath") || !src.includes("binaryPreviewMessage")) {
    throw new Error("FileTree must handle image/binary with honest empty");
  }
});

check("textPreview contract", () => {
  assertTextPreviewContract();
});

check("ReviewPanel: git_status (not Command git)", () => {
  const src = readFileSync(
    join(root, "src/lib/components/ReviewPanel.svelte"),
    "utf8",
  );
  if (!src.includes("git_status")) {
    throw new Error("ReviewPanel must invoke git_status");
  }
  // Tauri shell Command API or ad-hoc `git ` spawn in Svelte.
  if (
    src.includes("plugin-shell") ||
    src.includes("new Command") ||
    /Command\s*\(\s*["']git["']/.test(src) ||
    src.includes("`git ") ||
    src.includes('"git ') ||
    src.includes("'git ")
  ) {
    throw new Error("ReviewPanel must not shell out to git (use git_status IPC)");
  }
});

console.log("file-tree-boundary-selfcheck: all passed");
