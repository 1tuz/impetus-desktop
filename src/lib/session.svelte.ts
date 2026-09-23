/**
 * Session transcript store — reducer-backed runes state for live harness events.
 * Connect / send / hotkeys stay in the page; this owns apply/reset/push only.
 */

import {
  DEFAULT_AGENT_MODE,
  isAgentModeId,
  type AgentModeId,
} from "$lib/agentModes";
import {
  applyHarnessEvent,
  emptyTranscriptState,
  type HarnessEvent,
  type Msg,
  type MsgAttachment,
  type ReduceResult,
  type Role,
} from "$lib/harnessEventReducer";

export type PushOpts = {
  runId?: string;
  id?: string;
  attachments?: MsgAttachment[];
};

export class SessionStore {
  messages = $state<Msg[]>([]);
  lastSeq = $state(0);
  turnActive = $state(false);
  pendingApproval = $state(false);
  approvalId = $state("");
  approvalSummary = $state("");
  agentMode = $state<AgentModeId>(DEFAULT_AGENT_MODE);
  subscribeGen = $state(0);

  /** Internal dedupe set — not UI-facing. */
  seenIds = $state(new Set<string>());

  reset(): void {
    const empty = emptyTranscriptState();
    this.messages = empty.messages;
    this.lastSeq = empty.lastSeq;
    this.seenIds = empty.seenIds;
    this.turnActive = empty.turnActive;
  }

  /**
   * Apply one harness event via reducer. Returns UI side-effect hints
   * (approval detail fetch) — page owns invoke + scroll.
   */
  applyEvent(
    event: HarnessEvent,
    selectedSessionId: string,
  ): ReduceResult["effects"] {
    const next = applyHarnessEvent(
      {
        messages: this.messages,
        lastSeq: this.lastSeq,
        seenIds: this.seenIds,
        turnActive: this.turnActive,
        pendingApproval: this.pendingApproval,
        approvalId: this.approvalId,
        approvalSummary: this.approvalSummary,
        agentMode: this.agentMode,
      },
      event,
      selectedSessionId,
    );
    this.messages = next.state.messages;
    this.lastSeq = next.state.lastSeq;
    this.seenIds = next.state.seenIds;
    this.turnActive = next.state.turnActive;
    this.pendingApproval = next.state.pendingApproval;
    this.approvalId = next.state.approvalId;
    this.approvalSummary = next.state.approvalSummary;
    if (next.state.agentMode && isAgentModeId(next.state.agentMode)) {
      this.agentMode = next.state.agentMode;
    }
    return next.effects;
  }

  push(role: Role, text: string, opts?: PushOpts): void {
    this.messages = [
      ...this.messages,
      {
        id:
          opts?.id ??
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text,
        ts: Date.now(),
        runId: opts?.runId,
        ...(opts?.attachments?.length
          ? { attachments: opts.attachments }
          : {}),
      },
    ];
  }

  /** Race token for subscribe / activateSession — bump before async gaps. */
  bumpSubscribeGen(): number {
    return ++this.subscribeGen;
  }
}

export function createSessionTranscript(): SessionStore {
  return new SessionStore();
}
