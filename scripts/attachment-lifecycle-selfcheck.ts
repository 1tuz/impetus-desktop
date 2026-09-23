/**
 * Selfcheck: attachment failed-send restore + path mentions + upload_artifact.
 * Grep-based — does not mutate +page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertComposerAttachmentsContract } from "../src/lib/composerAttachments.ts";

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

check("composerAttachments contract (path mentions)", () => {
  assertComposerAttachmentsContract();
});

check("+page: failed-send restore (savedPrompt / sendOk)", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes("savedPrompt") || !page.includes("sendOk")) {
    throw new Error("+page missing savedPrompt / sendOk restore pattern");
  }
  if (!page.includes("promptText = savedPrompt")) {
    throw new Error("+page must restore promptText from savedPrompt on failure");
  }
  if (!page.includes("attachments = savedAttachments")) {
    throw new Error("+page must restore attachments on failure");
  }
  // Restore only when send failed.
  if (!page.includes("if (sendOk)") || !page.includes("else {")) {
    throw new Error("+page must branch restore on !sendOk");
  }
});

check("+page: path-based upload_artifact before send", () => {
  const page = readFileSync(join(root, "src/routes/+page.svelte"), "utf8");
  if (!page.includes('"upload_artifact"') && !page.includes("'upload_artifact'")) {
    throw new Error("+page missing upload_artifact invoke");
  }
  if (!page.includes("shouldUploadArtifact") || !page.includes("mergeAttachmentsIntoPrompt")) {
    throw new Error("+page must use shouldUploadArtifact + mergeAttachmentsIntoPrompt");
  }
});

check("composerAttachments: path mentions via merge", () => {
  const src = readFileSync(
    join(root, "src/lib/composerAttachments.ts"),
    "utf8",
  );
  if (!src.includes("a.path ?? a.name")) {
    throw new Error("mergeAttachmentsIntoPrompt must mention paths (path ?? name)");
  }
});

console.log("attachment-lifecycle-selfcheck: all passed");
