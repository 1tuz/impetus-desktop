/**
 * Selfcheck: sent-message path chips (mergeAttachmentsIntoPrompt lines → openable).
 * Main agent: wire into package.json `test` /
 *   node --experimental-strip-types scripts/sent-attach-selfcheck.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isImagePath } from "../src/lib/composerAttachments.ts";
import {
  assertPathMentionsContract,
  classifyPathMention,
} from "../src/lib/pathMentions.ts";
import { isTextPreviewPath } from "../src/lib/textPreview.ts";

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

check("pathMentions contract", () => {
  assertPathMentionsContract();
});

check("classify aligns with isImagePath / isTextPreviewPath", () => {
  const samples = [
    "/tmp/a.png",
    "/tmp/a.JPEG",
    "/tmp/a.rs",
    "/tmp/a.yaml",
    "/tmp/a.bin",
    "/tmp/noext",
  ];
  for (const p of samples) {
    const kind = classifyPathMention(p);
    if (isImagePath(p)) {
      if (kind !== "image") throw new Error(`${p}: expected image, got ${kind}`);
    } else if (isTextPreviewPath(p)) {
      if (kind !== "text") throw new Error(`${p}: expected text, got ${kind}`);
    } else if (kind !== "other") {
      throw new Error(`${p}: expected other, got ${kind}`);
    }
  }
});

check("Transcript wires MessageBody + open_external / lightbox", () => {
  const src = readFileSync(
    join(root, "src/lib/components/Transcript.svelte"),
    "utf8",
  );
  for (const needle of [
    "MessageBody",
    "open_external",
    "toFileUrl",
    "preview-scrim",
    "convertFileSrc",
    "onOpenPath",
  ]) {
    if (!src.includes(needle)) {
      throw new Error(`Transcript missing ${needle}`);
    }
  }
  if (src.includes("monaco") || src.includes("Monaco")) {
    throw new Error("Transcript must stay quiet — no Monaco");
  }
});

check("MessageBody renders path chips from splitMessageBody", () => {
  const src = readFileSync(
    join(root, "src/lib/components/MessageBody.svelte"),
    "utf8",
  );
  if (!src.includes("splitMessageBody") || !src.includes("path-chip")) {
    throw new Error("MessageBody missing splitMessageBody / path-chip");
  }
  if (src.includes("monaco") || src.includes("Monaco")) {
    throw new Error("MessageBody must not pull Monaco");
  }
});

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nsent-attach-selfcheck: all passed");
