/**
 * Attach (+) menu contract — context items only (files / workspace / chat / model / MCP).
 * Agent modes live in ModeSelect next to +, not here.
 * Composer + must open this menu, never Preferences.
 *
 * Files = attach any file(s) to the prompt (images → thumb chips).
 * Workspace = set project folder (desktop IPC / folder picker).
 */

export type AttachActionId = "files" | "workspace" | "new_chat" | "model" | "mcp";

export type AttachItem = {
  id: AttachActionId;
  label: string;
  description?: string;
  kind: "context";
};

export const ATTACH_CONTEXT: AttachItem[] = [
  {
    id: "files",
    label: "Files",
    description: "Attach files or images to the message",
    kind: "context",
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Open a project folder",
    kind: "context",
  },
  {
    id: "new_chat",
    label: "New chat",
    description: "Create a session in the current workspace",
    kind: "context",
  },
  {
    id: "model",
    label: "Model",
    description: "Composer Provider / Model / Reasoning",
    kind: "context",
  },
  {
    id: "mcp",
    label: "MCP",
    description: "Tools from the local daemon",
    kind: "context",
  },
];

export const ATTACH_MENU_ITEMS: AttachItem[] = [...ATTACH_CONTEXT];

/** What the composer + control must do. Never open_prefs. */
export type PlusTarget = "attach_menu" | "open_prefs";

export const COMPOSER_PLUS_TARGET: PlusTarget = "attach_menu";

export function assertComposerPlusOpensAttachMenu(target: PlusTarget = COMPOSER_PLUS_TARGET): void {
  if (target === "open_prefs") {
    throw new Error("composer + must open attach menu, not Preferences");
  }
  if (target !== "attach_menu") {
    throw new Error(`composer + unknown target: ${target}`);
  }
}

export function attachItemById(id: AttachActionId): AttachItem | undefined {
  return ATTACH_MENU_ITEMS.find((item) => item.id === id);
}

/** @deprecated Modes moved to agentModes — kept for selfcheck migration. */
const SKILL_PREFIX_RE = /^(?:\/(?:plan|debug|multitask|ask)\s+)+/i;

/** Replace any existing skill prefix — never stack /debug /plan. */
export function applySkillPrefix(prompt: string, prefix: string): string {
  const clean = prefix.endsWith(" ") ? prefix : `${prefix} `;
  const body = prompt.replace(SKILL_PREFIX_RE, "");
  return `${clean}${body}`;
}

export function requiredAttachIds(): AttachActionId[] {
  return ["files", "workspace", "new_chat", "model", "mcp"];
}

export function assertAttachMenuContract(items: AttachItem[] = ATTACH_MENU_ITEMS): void {
  assertComposerPlusOpensAttachMenu();
  const ids = new Set(items.map((i) => i.id));
  for (const need of requiredAttachIds()) {
    if (!ids.has(need)) {
      throw new Error(`attach menu missing required item: ${need}`);
    }
  }
  if (items.some((i) => (i as { id: string }).id === "open_prefs")) {
    throw new Error("attach menu must not include open_prefs");
  }
  if (items.some((i) => (i as { id: string }).id === "image")) {
    throw new Error("attach menu must not split Image from Files — one Files action");
  }
  if (items.some((i) => (i as { id: string }).id.startsWith("skill:"))) {
    throw new Error("attach menu must not include agent mode skills (use ModeSelect)");
  }
  const files = items.find((i) => i.id === "files");
  if (files?.description?.toLowerCase().includes("folder")) {
    throw new Error("Files must attach files, not open a project folder");
  }
}

export function assertSkillPrefixDoesNotStack(): void {
  const once = applySkillPrefix("hello", "/debug ");
  if (once !== "/debug hello") {
    throw new Error(`expected "/debug hello", got ${JSON.stringify(once)}`);
  }
  const twice = applySkillPrefix(once, "/plan ");
  if (twice !== "/plan hello") {
    throw new Error(`skill prefixes stacked: ${JSON.stringify(twice)}`);
  }
}
