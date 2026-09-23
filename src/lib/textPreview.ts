/**
 * Textual preview allowlist + language guess for FilePreview.
 * Daemon `ReadWorkspaceFile` is text-only (rejects binary).
 */

const TEXT_PREVIEW_EXT =
  /\.(txt|md|markdown|rs|js|mjs|cjs|jsx|ts|tsx|json|yaml|yml|toml|py|go|sh|bash|zsh|fish|conf|cfg|ini|env|html|htm|css|svg|c|h|cpp|hpp|java|kt|rb|php|sql|xml)$/i;

const IMAGE_PREVIEW_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

const EXT_LANGUAGE: Record<string, string> = {
  txt: "plaintext",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  go: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  conf: "ini",
  cfg: "ini",
  ini: "ini",
  env: "ini",
  html: "html",
  htm: "html",
  css: "css",
  svg: "svg",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  sql: "sql",
  xml: "xml",
};

export function isTextPreviewPath(path: string): boolean {
  return TEXT_PREVIEW_EXT.test(path);
}

export function isImagePreviewPath(path: string): boolean {
  return IMAGE_PREVIEW_EXT.test(path);
}

/** Language label for FilePreview chrome (no highlighter required). */
export function guessLanguage(path: string): string | undefined {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_LANGUAGE[ext];
}

/** Honest empty copy when daemon cannot serve bytes as text. */
export function binaryPreviewMessage(path: string): string {
  if (isImagePreviewPath(path)) {
    return "Image — binary; ReadWorkspaceFile is text-only";
  }
  return "Binary file — no text preview";
}

export function isBinaryReadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /looks binary|binary file|is binary/i.test(msg);
}

export function assertTextPreviewContract(): void {
  if (!isTextPreviewPath("/x/foo.rs") || !isTextPreviewPath("a.yaml")) {
    throw new Error("text ext allowlist");
  }
  if (isTextPreviewPath("/x/a.bin") || isTextPreviewPath("/x/a.png")) {
    throw new Error("bin/png not text");
  }
  if (!isImagePreviewPath("/tmp/shot.PNG") || isImagePreviewPath("/tmp/a.rs")) {
    throw new Error("image ext");
  }
  if (guessLanguage("src/main.rs") !== "rust") throw new Error("rs→rust");
  if (guessLanguage("a.TSX") !== "typescript") throw new Error("tsx→typescript");
  if (guessLanguage("noext") !== undefined) throw new Error("noext→undefined");
  if (!binaryPreviewMessage("a.png").toLowerCase().includes("image")) {
    throw new Error("image empty message");
  }
  if (!isBinaryReadError("workspace file looks binary: a.bin")) {
    throw new Error("binary error detect");
  }
}
