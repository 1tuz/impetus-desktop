/**
 * Composer attachment chips — images + file refs before send.
 */

export type AttachmentKind = "image" | "file";

export type ComposerAttachment = {
  id: string;
  name: string;
  mime: string;
  kind?: AttachmentKind;
  sizeBytes?: number;
  /** Object URL or asset:// preview for <img>. Empty for file chips. */
  previewUrl: string;
  /** Filesystem path when known (drop / saved paste). */
  path?: string;
  /** True when previewUrl is from URL.createObjectURL — must revoke. */
  revokeOnClear: boolean;
};

/** Large paste / file → path-based `upload_artifact` (avoid huge JS number[]). */
export const ARTIFACT_UPLOAD_THRESHOLD = 64 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

const TEXT_PREVIEW_EXT =
  /\.(txt|md|markdown|rs|js|mjs|cjs|jsx|ts|tsx|json|yaml|yml|toml|py|go|sh|bash|zsh|fish|conf|cfg|ini|env|html|htm|css|svg|c|h|cpp|hpp|java|kt|rb|php|sql|xml)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

export function isTextPreviewPath(path: string): boolean {
  return TEXT_PREVIEW_EXT.test(path);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10_485_760 ? 1 : 0)} MB`;
}

export function shouldUploadArtifact(att: ComposerAttachment): boolean {
  const size = att.sizeBytes ?? 0;
  if (size >= ARTIFACT_UPLOAD_THRESHOLD) return true;
  if ((att.kind ?? "image") === "file" && size > 0) return true;
  return false;
}

export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/bmp") return "bmp";
  if (m === "image/heic" || m === "image/heif") return "heic";
  return "png";
}

export function partitionPaths(paths: string[]): {
  images: string[];
  other: string[];
} {
  const images: string[] = [];
  const other: string[] = [];
  for (const path of paths) {
    if (isImagePath(path)) images.push(path);
    else other.push(path);
  }
  return { images, other };
}

export function attachmentFromPath(
  path: string,
  previewUrl: string,
): ComposerAttachment {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "png";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime: `image/${ext === "jpg" ? "jpeg" : ext}`,
    kind: "image",
    previewUrl,
    path,
    revokeOnClear: false,
  };
}

export function attachmentFromFilePath(
  path: string,
  sizeBytes?: number,
  mime?: string,
): ComposerAttachment {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const guessed =
    mime?.trim() ||
    (ext === "json"
      ? "application/json"
      : ext === "md" || ext === "markdown"
        ? "text/markdown"
        : isTextPreviewPath(path)
          ? "text/plain"
          : "application/octet-stream");
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime: guessed,
    kind: "file",
    sizeBytes,
    previewUrl: "",
    path,
    revokeOnClear: false,
  };
}

export function attachmentFromBlob(
  file: Blob,
  name: string,
  path?: string,
): ComposerAttachment {
  const mime = file.type || "image/png";
  const image = isImageMime(mime);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime,
    kind: image ? "image" : "file",
    sizeBytes: file.size,
    previewUrl: image ? URL.createObjectURL(file) : "",
    path,
    revokeOnClear: image,
  };
}

/** Append image refs to prompt text for text-only harness send. */
export function mergeAttachmentsIntoPrompt(
  prompt: string,
  attachments: ComposerAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const refs = attachments.map((a) => a.path ?? a.name).join("\n");
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n${refs}` : refs;
}

export function revokeAttachments(attachments: ComposerAttachment[]): void {
  for (const a of attachments) {
    if (a.revokeOnClear && a.previewUrl) URL.revokeObjectURL(a.previewUrl);
  }
}

/**
 * Snapshot chip meta for a sent user bubble.
 * Drops revokeOnClear object URLs — use path + convertFileSrc after send.
 */
export function userMsgWithAttachments(
  text: string,
  attachments: ComposerAttachment[],
): {
  text: string;
  attachments?: Array<{
    name: string;
    path?: string;
    previewUrl?: string;
    mime?: string;
  }>;
} {
  if (attachments.length === 0) return { text };
  return {
    text,
    attachments: attachments.map((a) => {
      const ref: {
        name: string;
        path?: string;
        previewUrl?: string;
        mime?: string;
      } = { name: a.name };
      if (a.path) ref.path = a.path;
      if (a.mime) ref.mime = a.mime;
      if (a.previewUrl && !a.revokeOnClear) ref.previewUrl = a.previewUrl;
      return ref;
    }),
  };
}

export function ensureImageFile(file: File, mimeHint?: string): File {
  if (isImageMime(file.type)) return file;
  const mime =
    mimeHint && isImageMime(mimeHint) ? mimeHint : "image/png";
  const ext = extFromMime(mime);
  const name = file.name?.trim() || `paste.${ext}`;
  return new File([file], name, { type: mime });
}

/** Collect image files from a paste event (browser + Tauri webview). */
export function collectPastedImages(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const out: File[] = [];
  for (const item of [...clipboard.items]) {
    if (!item.type.startsWith("image/")) continue;
    const raw = item.getAsFile();
    if (!raw) continue;
    out.push(ensureImageFile(raw, item.type));
  }
  if (out.length) return out;
  for (const file of [...clipboard.files]) {
    if (isImageMime(file.type) || isImagePath(file.name)) {
      out.push(ensureImageFile(file));
    }
  }
  return out;
}

/**
 * Async clipboard read — needed when paste event has empty clipboardData
 * (some embedded browsers / strict clipboard hosts strip image payloads).
 */
export async function readImagesFromClipboardApi(): Promise<File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return [];
  }
  try {
    const items = await navigator.clipboard.read();
    const out: File[] = [];
    for (const item of items) {
      const types = item.types.filter((t) => t.startsWith("image/"));
      if (!types.length) continue;
      const preferred =
        types.find((t) =>
          t === "image/png" ||
          t === "image/jpeg" ||
          t === "image/webp" ||
          t === "image/gif",
        ) ?? types[0]!;
      const blob = await item.getType(preferred);
      const ext = extFromMime(preferred);
      out.push(new File([blob], `paste.${ext}`, { type: preferred }));
    }
    return out;
  } catch {
    return [];
  }
}

/** Decode odd types (tiff/heic) to PNG so <img> preview works in Chromium. */
export async function toPreviewableImage(file: File): Promise<File> {
  const ok = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];
  if (ok.includes(file.type)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".png") || "paste.png", {
      type: "image/png",
    });
  } catch {
    return file;
  }
}

export function assertComposerAttachmentsContract(): void {
  if (!isImagePath("/tmp/shot.PNG")) throw new Error("png must be image");
  if (isImagePath("/tmp/a.rs")) throw new Error("rs must not be image");
  if (!isImageMime("image/png")) throw new Error("mime image/png");
  if (extFromMime("image/jpeg") !== "jpg") throw new Error("jpeg→jpg");
  if (!isTextPreviewPath("/x/foo.rs") || !isTextPreviewPath("/x/a.yaml")) {
    throw new Error("text preview ext");
  }
  if (isTextPreviewPath("/x/a.bin")) throw new Error("bin not text");
  if (formatBytes(512) !== "512 B") throw new Error("formatBytes B");
  const parts = partitionPaths(["/a.png", "/b.rs", "/c.webp"]);
  if (parts.images.join() !== "/a.png,/c.webp" || parts.other.join() !== "/b.rs") {
    throw new Error("partitionPaths failed");
  }
  const fileAtt = attachmentFromFilePath("/tmp/x.rs", 100);
  if (fileAtt.kind !== "file" || fileAtt.name !== "x.rs") {
    throw new Error("attachmentFromFilePath");
  }
  if (
    !shouldUploadArtifact(
      attachmentFromFilePath("/tmp/y.rs", ARTIFACT_UPLOAD_THRESHOLD),
    )
  ) {
    throw new Error("should upload at threshold");
  }
  const merged = mergeAttachmentsIntoPrompt("hi", [
    attachmentFromPath("/tmp/x.png", "asset://x"),
  ]);
  if (merged !== "hi\n/tmp/x.png") throw new Error(`merge failed: ${merged}`);
  const only = mergeAttachmentsIntoPrompt("", [
    attachmentFromPath("/tmp/y.png", "asset://y"),
  ]);
  if (only !== "/tmp/y.png") throw new Error(`merge-only failed: ${only}`);
  const blank = new File([new Uint8Array([1, 2, 3])], "", { type: "" });
  const fixed = ensureImageFile(blank, "image/png");
  if (fixed.type !== "image/png" || fixed.name !== "paste.png") {
    throw new Error("ensureImageFile must fill empty mime/name");
  }
  const snap = userMsgWithAttachments("hi", [
    attachmentFromPath("/tmp/x.png", "asset://x"),
    {
      ...attachmentFromBlob(
        new Blob([new Uint8Array([1])], { type: "image/png" }),
        "paste.png",
        "/tmp/p.png",
      ),
      revokeOnClear: true,
    },
  ]);
  if (!snap.attachments || snap.attachments.length !== 2) {
    throw new Error("userMsgWithAttachments length");
  }
  if (snap.attachments[0]?.previewUrl !== "asset://x") {
    throw new Error("keep non-revoke previewUrl");
  }
  if (snap.attachments[1]?.previewUrl) {
    throw new Error("drop revokeOnClear previewUrl");
  }
  if (snap.attachments[1]?.path !== "/tmp/p.png") {
    throw new Error("keep path for convertFileSrc");
  }
}
