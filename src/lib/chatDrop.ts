/**
 * Chat drag-and-drop helpers — folder → workspace, files → prompt mentions.
 */

export type DroppedPathInfo = {
  path: string;
  is_dir: boolean;
};

export type DropDisposition =
  | { kind: "workspace"; path: string }
  | { kind: "prompt"; paths: string[] }
  | { kind: "empty" };

/** Pure disposition of a drop (no I/O). */
export function dispositionForDrop(infos: DroppedPathInfo[]): DropDisposition {
  if (infos.length === 0) return { kind: "empty" };
  const dirs = infos.filter((i) => i.is_dir);
  const files = infos.filter((i) => !i.is_dir);
  // Single folder alone → set workspace (Cursor-like open project).
  if (dirs.length === 1 && files.length === 0) {
    return { kind: "workspace", path: dirs[0]!.path };
  }
  // Mixed or files → mention all paths in the prompt.
  return { kind: "prompt", paths: infos.map((i) => i.path) };
}

export function appendPathsToPrompt(prompt: string, paths: string[]): string {
  if (paths.length === 0) return prompt;
  const block = paths.join("\n");
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n${block}` : block;
}

export function assertDropDispositionContract(): void {
  const ws = dispositionForDrop([{ path: "/tmp/proj", is_dir: true }]);
  if (ws.kind !== "workspace" || ws.path !== "/tmp/proj") {
    throw new Error("single dir drop must set workspace");
  }
  const prompt = dispositionForDrop([
    { path: "/tmp/a.rs", is_dir: false },
    { path: "/tmp/b.rs", is_dir: false },
  ]);
  if (prompt.kind !== "prompt" || prompt.paths.length !== 2) {
    throw new Error("file drops must go to prompt");
  }
  const mixed = dispositionForDrop([
    { path: "/tmp/proj", is_dir: true },
    { path: "/tmp/a.rs", is_dir: false },
  ]);
  if (mixed.kind !== "prompt") {
    throw new Error("mixed drop must go to prompt, not workspace alone");
  }
  const joined = appendPathsToPrompt("hello", ["/a", "/b"]);
  if (joined !== "hello\n/a\n/b") {
    throw new Error(`appendPathsToPrompt failed: ${JSON.stringify(joined)}`);
  }
}
