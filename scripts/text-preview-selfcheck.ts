/**
 * Selfcheck: text preview path allowlist + language guess helpers.
 */
import { assertTextPreviewContract } from "../src/lib/textPreview.ts";

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check("textPreview helpers", () => {
  assertTextPreviewContract();
});

console.log("text-preview-selfcheck: all passed");
