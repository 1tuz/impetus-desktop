/**
 * Thin-client privilege boundary: no privileged helpers, no local git, MCP via
 * daemon client. Run: node --experimental-strip-types scripts/no-privilege-selfcheck.ts
 *
 * Scope: `src-tauri` + `src` only. CI apt elevate under `.github` out of scope.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "target" || name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (st.isFile()) out.push(full);
  }
  return out;
}

// Needle ids for privilege escalation surfaces (must not appear in app source).
const FORBIDDEN: { id: string; re: RegExp }[] = [
  { id: "sudo", re: /\bsudo\b/ },
  { id: "AuthorizationExecute", re: /AuthorizationExecute/ },
  { id: "SMJobBless", re: /SMJobBless/ },
  { id: "PrivilegedHelper", re: /PrivilegedHelper/ },
  { id: "osascript admin", re: /osascript[\s\S]{0,80}\badmin\b/i },
  { id: "/Library/LaunchDaemons", re: /\/Library\/LaunchDaemons/ },
  {
    id: "/Library/PrivilegedHelperTools",
    re: /\/Library\/PrivilegedHelperTools/,
  },
  { id: "pkexec", re: /\bpkexec\b/ },
  { id: "doas", re: /\bdoas\b/ },
];

const TEXT_EXT = new Set([
  ".rs",
  ".ts",
  ".js",
  ".svelte",
  ".toml",
  ".json",
  ".md",
  ".sh",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".svg",
]);

function isTextPath(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (base === "Cargo.lock" || base === "pnpm-lock.yaml") return false;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXT.has(base.slice(dot).toLowerCase());
}

check("no privileged helpers in src-tauri + src", () => {
  const dirs = [join(root, "src-tauri"), join(root, "src")];
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const file of walkFiles(dir)) {
      if (!isTextPath(file)) continue;
      const text = readFileSync(file, "utf8");
      const rel = relative(root, file);
      for (const needle of FORBIDDEN) {
        if (needle.re.test(text)) {
          hits.push(`${rel}: ${needle.id}`);
        }
      }
    }
  }
  if (hits.length) {
    throw new Error(`forbidden privilege surface:\n  ${hits.join("\n  ")}`);
  }
});

check("default socket uses Application Support / user home", () => {
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("pub async fn ensure_runtime")) {
    throw new Error("missing ensure_runtime");
  }
  if (!harness.includes("pub async fn start_daemon")) {
    throw new Error("missing start_daemon recovery alias");
  }
  if (!harness.includes("fn default_app_support_socket")) {
    throw new Error("missing default_app_support_socket");
  }
  if (!harness.includes("fn default_socket_path")) {
    throw new Error("missing default_socket_path");
  }
  if (!harness.includes("discover_socket_path")) {
    throw new Error("Desktop must reuse impetus_daemon_control::discover_socket_path");
  }
  if (!harness.includes("default_data_root")) {
    throw new Error("fallback socket must use impetus_daemon_control::default_data_root");
  }
  if (!harness.includes("is_ephemeral_smoke_socket")) {
    throw new Error("must ignore ephemeral smoke IMPETUS_SOCKET paths");
  }
  // Runtime socket / data must not write under /usr/local.
  if (/IMPETUS_SOCKET[\s\S]{0,200}\/usr\/local/.test(harness)) {
    throw new Error("IMPETUS_SOCKET must not target /usr/local");
  }
  const lines = harness.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("/usr/local")) continue;
    const window = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
    if (
      /create_dir|File::create|OpenOptions|rename\(|remove_file|IMPETUS_DATA_DIR|harness\.sock/.test(
        window,
      )
    ) {
      throw new Error(`suspicious /usr/local runtime write near line ${i + 1}`);
    }
  }
});

check("no Command::new(\"git\") in src-tauri (git only via harness)", () => {
  const files = walkFiles(join(root, "src-tauri")).filter((f) =>
    f.endsWith(".rs"),
  );
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (/Command::new\(\s*"git"\s*\)/.test(text)) {
      hits.push(relative(root, file));
    }
  }
  if (hits.length) {
    throw new Error(`local git spawn: ${hits.join(", ")}`);
  }
});

check("list_mcp_servers uses client, not Codex config.toml parse", () => {
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  if (!harness.includes("pub async fn list_mcp_servers")) {
    throw new Error("missing list_mcp_servers");
  }
  if (!harness.includes(".list_mcp_servers()")) {
    throw new Error("list_mcp_servers must call client.list_mcp_servers()");
  }
  for (const bad of [
    "parse_mcp_servers_toml",
    ".codex/config.toml",
    "IMPETUS_MCP_CONFIG",
    "~/.codex",
  ]) {
    if (harness.includes(bad)) {
      throw new Error(`Codex/local MCP parse still present: ${bad}`);
    }
  }
  const attach = readFileSync(
    join(root, "src/lib/components/AttachMenu.svelte"),
    "utf8",
  );
  if (!attach.includes('invoke<McpServerDto[]>("list_mcp_servers")')) {
    throw new Error("AttachMenu must invoke list_mcp_servers");
  }
  if (!attach.includes('invoke<McpServerDto[]>("reload_mcp_servers")')) {
    throw new Error("AttachMenu must invoke reload_mcp_servers");
  }
  if (/parse_mcp|readFileSync\([^)]*codex|IMPETUS_MCP_CONFIG/.test(attach)) {
    throw new Error("AttachMenu must not parse MCP config locally");
  }
});

check("Cargo.toml stays thin (no core/sqlite/pty/keychain/git2)", () => {
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  for (const bad of [
    "impetus-core",
    "rusqlite",
    "sqlx",
    "keyring",
    "portable-pty",
    "git2",
    "impetus-desktop-adapter",
    "DesktopHarness",
  ]) {
    if (cargo.includes(bad)) {
      throw new Error(`forbidden Cargo dep/name: ${bad}`);
    }
  }
  if (!cargo.includes("impetus-client")) {
    throw new Error("must depend on impetus-client");
  }
});

check("pty_start goes through HarnessClient (not local spawn)", () => {
  const harness = readFileSync(
    join(root, "src-tauri/src/commands/harness.rs"),
    "utf8",
  );
  const start = harness.indexOf("pub async fn pty_start");
  if (start < 0) throw new Error("missing pty_start");
  const slice = harness.slice(start, start + 800);
  if (!slice.includes(".pty_start(")) {
    throw new Error("pty_start must call client.pty_start");
  }
  if (/Command::new\([^)]*(zsh|bash|sh)/.test(slice)) {
    throw new Error("pty_start must not spawn a local shell");
  }
});

check("package.json test includes no-privilege-selfcheck", () => {
  const pkg = readFileSync(join(root, "package.json"), "utf8");
  if (!pkg.includes("no-privilege-selfcheck.ts")) {
    throw new Error("package.json test missing no-privilege-selfcheck.ts");
  }
});

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nno-privilege-selfcheck: all passed");
