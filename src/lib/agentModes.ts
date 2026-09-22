/**
 * Agent execution modes — aligned with Impetus terminal (`ExecutionMode` in
 * impetus-core / impetus-tui): ask | plan | accept_edits | auto | bypass.
 *
 * Mode is daemon-owned via `set_execution_mode` / `get_execution_mode` IPC.
 * UI keeps a local mirror for ModeSelect; do not prefix prompts with banners.
 */

export type AgentModeId =
  | "ask"
  | "plan"
  | "accept_edits"
  | "auto"
  | "bypass";

export type AgentMode = {
  id: AgentModeId;
  /** Short trigger label (matches terminal status wording). */
  label: string;
  description: string;
  /** Wire / IPC name (snake_case). */
  wire: AgentModeId;
};

export const AGENT_MODES: AgentMode[] = [
  {
    id: "ask",
    label: "Ask",
    description: "Proceed normally; show every daemon-requested approval.",
    wire: "ask",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Research and plan only; daemon denies mutating tools.",
    wire: "plan",
  },
  {
    id: "accept_edits",
    label: "Accept edits",
    description: "Scoped grant for file edits; requires daemon capability.",
    wire: "accept_edits",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Policy-allowed autonomy; risky paths still approval-gated.",
    wire: "auto",
  },
  {
    id: "bypass",
    label: "Bypass",
    description: "Broad grant; requires approval_scope_full_auto capability.",
    wire: "bypass",
  },
];

export const DEFAULT_AGENT_MODE: AgentModeId = "ask";

const MODE_BY_ID = new Map(AGENT_MODES.map((m) => [m.id, m]));

export function agentModeById(id: AgentModeId): AgentMode {
  return MODE_BY_ID.get(id) ?? AGENT_MODES[0]!;
}

export function isAgentModeId(value: string): value is AgentModeId {
  return MODE_BY_ID.has(value as AgentModeId);
}

/** Prompt / Steer / FollowUp — matches `UserPromptIntent` wire names. */
export type PromptIntentId = "prompt" | "steer" | "follow_up";

export const PROMPT_INTENTS: { id: PromptIntentId; label: string }[] = [
  { id: "prompt", label: "prompt" },
  { id: "steer", label: "steer" },
  { id: "follow_up", label: "follow-up" },
];

export const DEFAULT_PROMPT_INTENT: PromptIntentId = "prompt";

export function cyclePromptIntent(current: PromptIntentId): PromptIntentId {
  const idx = PROMPT_INTENTS.findIndex((i) => i.id === current);
  const next = PROMPT_INTENTS[(idx + 1) % PROMPT_INTENTS.length];
  return next?.id ?? "prompt";
}

export function promptIntentLabel(id: PromptIntentId): string {
  return PROMPT_INTENTS.find((i) => i.id === id)?.label ?? id;
}

/** Legacy slash skill prefixes from the old + menu — strip on apply. */
const LEGACY_SKILL_PREFIX_RE = /^(?:\/(?:plan|debug|multitask|ask)\s+)+/i;

/** Existing UI-mode banner from a prior send — strip if pasted from old transcripts. */
const UI_MODE_PREFIX_RE = /^\[Impetus UI mode:[^\]]*\]\s*/i;

/** Strip any prior mode/skill banner from prompt body. */
export function stripModePrefix(prompt: string): string {
  return prompt.replace(UI_MODE_PREFIX_RE, "").replace(LEGACY_SKILL_PREFIX_RE, "");
}

export function assertModeIdsMatchTerminal(): void {
  const ids = AGENT_MODES.map((m) => m.id).join(",");
  if (ids !== "ask,plan,accept_edits,auto,bypass") {
    throw new Error(`unexpected modes: ${ids}`);
  }
}

export function assertPromptIntentCycle(): void {
  let cur: PromptIntentId = "prompt";
  cur = cyclePromptIntent(cur);
  if (cur !== "steer") throw new Error(`expected steer, got ${cur}`);
  cur = cyclePromptIntent(cur);
  if (cur !== "follow_up") throw new Error(`expected follow_up, got ${cur}`);
  cur = cyclePromptIntent(cur);
  if (cur !== "prompt") throw new Error(`expected prompt, got ${cur}`);
}
