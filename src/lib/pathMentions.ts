/**
 * Detect attachment-looking path tokens in transcript text
 * (refs appended by mergeAttachmentsIntoPrompt: absolute paths or bare names).
 *
 * Image/text ext lists mirrored from composerAttachments / textPreview
 * (no relative imports — Node selfcheck is extension-strict ESM).
 */

export type PathMentionKind = "image" | "text" | "other";

export type BodyPart =
  | { type: "text"; text: string }
  | { type: "path"; path: string; kind: PathMentionKind };

/** Keep in sync with composerAttachments.isImagePath */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

/** Keep in sync with textPreview.isTextPreviewPath */
const TEXT_PREVIEW_EXT =
  /\.(txt|md|rs|js|ts|json|yaml|yml|toml|py|go|sh|bash|zsh|fish|conf|cfg|ini|env|html|css|svg|c|h|cpp|hpp|java|kt|rb|php|sql|xml)$/i;

/** Non-image attachment-ish extensions (whole-line bare names only). */
const OTHER_ATTACH_EXT =
  /\.(pdf|zip|tar|gz|tgz|dmg|pkg|wasm|bin|exe|dll|so|dylib|ico|icns|mp[34]|wav|mov|avi|mkv|csv|tsv|xlsx?|docx?|pptx?)$/i;

function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

function isTextPreviewPath(path: string): boolean {
  return TEXT_PREVIEW_EXT.test(path);
}

/** Strip quotes / backticks / file:// so chip path is filesystem-usable. */
export function normalizePathToken(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2) {
    const a = s[0]!;
    const b = s[s.length - 1]!;
    if ((a === "`" && b === "`") || (a === '"' && b === '"') || (a === "'" && b === "'")) {
      s = s.slice(1, -1).trim();
    }
  }
  // Trailing prose punctuation (not part of the path).
  s = s.replace(/[,:;)]+$/, "");
  if (/^file:\/\//i.test(s)) {
    let rest = s.replace(/^file:\/\//i, "");
    // file:///tmp/x → /tmp/x ; file://localhost/tmp/x → /tmp/x
    if (rest.startsWith("localhost/")) rest = rest.slice("localhost".length);
    try {
      s = decodeURIComponent(rest);
    } catch {
      s = rest;
    }
  }
  return s;
}

function isAbsoluteUnixPath(s: string): boolean {
  if (!s.startsWith("/") || s.startsWith("//")) return false;
  if (s.length < 2) return false;
  if (/[\t<>|*?;`]/.test(s)) return false;
  const segs = s.split("/").filter(Boolean);
  if (segs.length === 0) return false;
  const last = segs[segs.length - 1]!;
  // Nested path (/tmp/x) or root-level file with extension (/README.md).
  return segs.length >= 2 || /\.[A-Za-z0-9]{1,16}$/.test(last);
}

/** Bare attachment name: shot.png / notes.md (no slash). */
function isBareAttachmentName(s: string): boolean {
  if (!s || s.includes("/") || s.includes("\\")) return false;
  if (/[\t<>|*?;`]/.test(s)) return false;
  if (isImagePath(s) || isTextPreviewPath(s)) return true;
  return OTHER_ATTACH_EXT.test(s);
}

/** Absolute unix path or attachment-looking bare filename (whole line). */
export function isPathMentionLine(line: string): boolean {
  const s = normalizePathToken(line);
  if (!s) return false;
  return isAbsoluteUnixPath(s) || isBareAttachmentName(s);
}

export function classifyPathMention(path: string): PathMentionKind {
  const p = normalizePathToken(path);
  if (isImagePath(p)) return "image";
  if (isTextPreviewPath(p)) return "text";
  return "other";
}

export function pathBasename(path: string): string {
  const p = normalizePathToken(path);
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** file:// URL for Tauri open_external (unix absolute paths). */
export function toFileUrl(path: string): string {
  const abs = normalizePathToken(path);
  const encoded = abs
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `file://${encoded}`;
}

/** Split message into text runs + path chips (one chip per whole path line). */
export function splitMessageBody(text: string): BodyPart[] {
  if (!text) return [];
  const lines = text.split("\n");
  const parts: BodyPart[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    parts.push({ type: "text", text: buf.join("\n") });
    buf = [];
  };

  for (const line of lines) {
    if (isPathMentionLine(line)) {
      flush();
      const path = normalizePathToken(line);
      parts.push({ type: "path", path, kind: classifyPathMention(path) });
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts;
}

export function assertPathMentionsContract(): void {
  if (!isPathMentionLine("/tmp/shot.png")) {
    throw new Error("image path line must match");
  }
  if (!isPathMentionLine("/Users/a/proj/src/main.rs")) {
    throw new Error("nested source path must match");
  }
  if (isPathMentionLine("//cdn.example/x.png")) {
    throw new Error("protocol-relative must not match");
  }
  if (isPathMentionLine("see /tmp/x.png later")) {
    throw new Error("inline path must not match (whole line only)");
  }
  if (isPathMentionLine("/")) {
    throw new Error("bare slash must not match");
  }
  // Attachment-looking bare names (mergeAttachmentsIntoPrompt may emit name-only).
  if (!isPathMentionLine("shot.PNG")) {
    throw new Error("bare image name must match");
  }
  if (!isPathMentionLine("notes.md")) {
    throw new Error("bare text name must match");
  }
  if (!isPathMentionLine("report.pdf")) {
    throw new Error("bare other attach name must match");
  }
  if (isPathMentionLine("e.g.")) {
    throw new Error("prose abbreviation must not match");
  }
  if (!isPathMentionLine("`/tmp/quoted.png`")) {
    throw new Error("backtick-wrapped path must match");
  }
  if (!isPathMentionLine("file:///tmp/url%20shot.png")) {
    throw new Error("file:// URL must match");
  }
  if (normalizePathToken("file:///tmp/url%20shot.png") !== "/tmp/url shot.png") {
    throw new Error("file:// normalize must decode");
  }
  if (classifyPathMention("/tmp/a.PNG") !== "image") {
    throw new Error("png → image");
  }
  if (classifyPathMention("shot.webp") !== "image") {
    throw new Error("bare webp → image (lightbox)");
  }
  if (classifyPathMention("/tmp/a.rs") !== "text") {
    throw new Error("rs → text");
  }
  if (classifyPathMention("/tmp/a.bin") !== "other") {
    throw new Error("bin → other");
  }
  if (classifyPathMention("report.pdf") !== "other") {
    throw new Error("pdf → other");
  }
  if (toFileUrl("/tmp/my file.png") !== "file:///tmp/my%20file.png") {
    throw new Error("toFileUrl must encode spaces");
  }
  const parts = splitMessageBody("hi\n/tmp/a.png\n/tmp/b.rs\nok");
  if (parts.length !== 4) throw new Error(`expected 4 parts, got ${parts.length}`);
  if (parts[0]?.type !== "text" || parts[0].text !== "hi") {
    throw new Error("leading text");
  }
  if (parts[1]?.type !== "path" || parts[1].path !== "/tmp/a.png" || parts[1].kind !== "image") {
    throw new Error("image chip");
  }
  if (parts[2]?.type !== "path" || parts[2].kind !== "text") {
    throw new Error("text chip");
  }
  if (parts[3]?.type !== "text" || parts[3].text !== "ok") {
    throw new Error("trailing text");
  }
  const only = splitMessageBody("/tmp/solo.webp");
  if (only.length !== 1 || only[0]?.type !== "path" || only[0].kind !== "image") {
    throw new Error("path-only body");
  }
  const bare = splitMessageBody("paste.png");
  if (bare.length !== 1 || bare[0]?.type !== "path" || bare[0].kind !== "image") {
    throw new Error("bare image chip for lightbox");
  }
  const quoted = splitMessageBody('hi\n"/tmp/q.png"');
  if (
    quoted.length !== 2 ||
    quoted[1]?.type !== "path" ||
    quoted[1].path !== "/tmp/q.png" ||
    quoted[1].kind !== "image"
  ) {
    throw new Error("quoted absolute path chip");
  }
  if (pathBasename("/a/b/c.rs") !== "c.rs") {
    throw new Error("basename");
  }
}
