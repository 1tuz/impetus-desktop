/**
 * Composer image chips — Cursor-style thumbnails before send.
 */

export type ComposerAttachment = {
  id: string;
  name: string;
  mime: string;
  /** Object URL or asset:// preview for <img>. */
  previewUrl: string;
  /** Filesystem path when known (drop / saved paste). */
  path?: string;
  /** True when previewUrl is from URL.createObjectURL — must revoke. */
  revokeOnClear: boolean;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
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
    previewUrl,
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
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime,
    previewUrl: URL.createObjectURL(file),
    path,
    revokeOnClear: true,
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
    if (a.revokeOnClear) URL.revokeObjectURL(a.previewUrl);
  }
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
          t === "image/png" || t === "image/jpeg" || t === "image/webp" || t === "image/gif",
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
  const parts = partitionPaths(["/a.png", "/b.rs", "/c.webp"]);
  if (parts.images.join() !== "/a.png,/c.webp" || parts.other.join() !== "/b.rs") {
    throw new Error("partitionPaths failed");
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
}
