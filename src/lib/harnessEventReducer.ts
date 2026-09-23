/**
 * Session transcript apply — stable by event id / sequence (not text dedupe).
 */

export type Role = "system" | "user" | "assistant" | "tool";

export type ActivityStatus = "running" | "done" | "error";

export type ActivityMeta = {
  phase: string;
  title: string;
  detail?: string;
  status: ActivityStatus;
  expanded?: boolean;
  toolName?: string;
  /** Correlate started/finished/observed when daemon sends tool_call_id. */
  toolCallId?: string;
};

/** Local chip meta on optimistic user msgs (not from harness events). */
export type MsgAttachment = {
  name: string;
  path?: string;
  previewUrl?: string;
  mime?: string;
};

export type Msg = {
  id: string;
  role: Role;
  text: string;
  ts: number;
  runId?: string;
  /** Harness event sequence when known. */
  sequence?: number;
  kind?: "text" | "activity";
  activity?: ActivityMeta;
  /** Sent-user attachment chips (local push only). */
  attachments?: MsgAttachment[];
};

export type HarnessEvent = {
  id?: string;
  sequence: number;
  session_id: string;
  payload: {
    type: string;
    data: Record<string, unknown>;
  };
};

export type TranscriptState = {
  messages: Msg[];
  lastSeq: number;
  seenIds: Set<string>;
  turnActive: boolean;
  pendingApproval: boolean;
  approvalId: string;
  approvalSummary: string;
  agentMode: string | null;
};

export type ReduceResult = {
  state: TranscriptState;
  /** Side effects the UI should run (approval detail fetch). */
  effects: Array<{ kind: "approval"; id: string; summary: string }>;
};

export function emptyTranscriptState(): TranscriptState {
  return {
    messages: [],
    lastSeq: 0,
    seenIds: new Set(),
    turnActive: false,
    pendingApproval: false,
    approvalId: "",
    approvalSummary: "",
    agentMode: null,
  };
}

function eventKey(event: HarnessEvent): string {
  if (event.id && event.id.length > 0) return event.id;
  return `seq:${event.sequence}`;
}

function pushMsg(
  messages: Msg[],
  role: Role,
  text: string,
  opts?: { id?: string; runId?: string; sequence?: number },
): Msg[] {
  const msg: Msg = {
    id: opts?.id ?? `local:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    ts: Date.now(),
    runId: opts?.runId,
    sequence: opts?.sequence,
    kind: "text",
  };
  return [...messages, msg];
}

function appendAssistantChunk(
  messages: Msg[],
  runId: string,
  text: string,
  sequence: number,
  id: string,
): Msg[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.runId === runId) {
    return [
      ...messages.slice(0, -1),
      { ...last, text: last.text + text, ts: Date.now(), sequence },
    ];
  }
  return pushMsg(messages, "assistant", text, { id, runId, sequence });
}

function toolCallIdOf(data: Record<string, unknown>): string | undefined {
  const raw = data.tool_call_id;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function findActivityIndex(
  messages: Msg[],
  opts: { toolCallId?: string; toolName?: string },
): number {
  if (opts.toolCallId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.kind === "activity" && m.activity?.toolCallId === opts.toolCallId) {
        return i;
      }
    }
  }
  if (opts.toolName) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m?.kind === "activity" &&
        m.activity?.toolName === opts.toolName &&
        m.activity.status === "running"
      ) {
        return i;
      }
    }
  }
  return -1;
}

function upsertActivity(
  messages: Msg[],
  patch: ActivityMeta,
  opts: { id: string; sequence: number },
): Msg[] {
  const idx = findActivityIndex(messages, {
    toolCallId: patch.toolCallId,
    toolName: patch.toolName,
  });
  const text = patch.detail
    ? `${patch.title} · ${patch.detail}`
    : patch.title;
  if (idx >= 0) {
    const prev = messages[idx]!;
    const activity: ActivityMeta = { ...prev.activity!, ...patch };
    return [
      ...messages.slice(0, idx),
      {
        ...prev,
        text,
        ts: Date.now(),
        sequence: opts.sequence,
        kind: "activity",
        activity,
      },
      ...messages.slice(idx + 1),
    ];
  }
  return [
    ...messages,
    {
      id: opts.id,
      role: "tool",
      text,
      ts: Date.now(),
      sequence: opts.sequence,
      kind: "activity",
      activity: patch,
    },
  ];
}

function observedStatus(outcome: string): ActivityStatus {
  const o = outcome.toLowerCase();
  if (o === "error" || o === "denied") return "error";
  return "done";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** BudgetEvent wire: `{ state, ... }`. Skip Updated (status-bar noise). */
function budgetLine(data: Record<string, unknown>): string | null {
  const state = typeof data.state === "string" ? data.state : "";
  if (state === "compaction_required") {
    const used = num(data.used);
    const threshold = num(data.threshold);
    if (used != null && threshold != null) {
      return `budget · compaction required ${used}/${threshold} tokens`;
    }
    return "budget · compaction required";
  }
  if (state === "compaction_started") {
    const from = num(data.from_sequence);
    const to = num(data.to_sequence);
    const used = num(data.used);
    const threshold = num(data.threshold);
    if (from != null && to != null && used != null && threshold != null) {
      return `budget · compacting ${from}..${to} (${used}/${threshold} tokens)`;
    }
    return "budget · compacting";
  }
  if (state === "compaction_completed") {
    const compactedTo = num(data.compacted_to);
    const count = num(data.compaction_count);
    if (compactedTo != null && count != null) {
      return `budget · compacted ${compactedTo} tokens · #${count}`;
    }
    return "budget · compacted";
  }
  if (state === "turn_limit_approaching") {
    const used = num(data.used);
    const limit = num(data.limit);
    if (used != null && limit != null) {
      return `budget · turn limit ${used}/${limit}`;
    }
    return "budget · turn limit approaching";
  }
  if (state === "token_limit_approaching") {
    const used = num(data.used);
    const limit = num(data.limit);
    if (used != null && limit != null) {
      return `budget · token limit ${used}/${limit}`;
    }
    return "budget · token limit approaching";
  }
  return null;
}

/** RetryEvent wire: externally tagged `{ attempting|succeeded|exhausted: {...} }`. */
function retryLine(
  data: Record<string, unknown>,
): { title: string; detail?: string } | null {
  if ("attempting" in data && data.attempting && typeof data.attempting === "object") {
    const a = data.attempting as Record<string, unknown>;
    const attempt = num(a.attempt);
    const max = num(a.max_attempts);
    const reason = typeof a.reason === "string" ? a.reason : "";
    const backoff = num(a.backoff_ms);
    const title =
      attempt != null && max != null
        ? `retry ${attempt}/${max}`
        : "retry";
    const parts: string[] = [];
    if (reason) parts.push(reason);
    if (backoff != null) parts.push(`backoff ${backoff}ms`);
    return { title, detail: parts.length ? parts.join(" · ") : undefined };
  }
  if ("succeeded" in data && data.succeeded && typeof data.succeeded === "object") {
    const a = data.succeeded as Record<string, unknown>;
    const attempt = num(a.attempt);
    return {
      title: "retry succeeded",
      detail: attempt != null ? `recovered on attempt ${attempt}` : undefined,
    };
  }
  if ("exhausted" in data && data.exhausted && typeof data.exhausted === "object") {
    const a = data.exhausted as Record<string, unknown>;
    const attempts = num(a.attempts);
    const err = typeof a.last_error === "string" ? a.last_error : "";
    const parts: string[] = [];
    if (attempts != null) parts.push(`${attempts} attempts`);
    if (err) parts.push(err);
    return {
      title: "retries exhausted",
      detail: parts.length ? parts.join(" · ") : undefined,
    };
  }
  return null;
}

/** BackendEvent wire: `{ state, profile?, reason?, expires_in_seconds? }`. */
function backendLine(data: Record<string, unknown>): string | null {
  const state = typeof data.state === "string" ? data.state : "";
  const profile = typeof data.profile === "string" ? data.profile : "";
  const reason = typeof data.reason === "string" ? data.reason : "";
  if (state === "provider_healthy") {
    return profile ? `backend · provider ${profile} healthy` : "backend · provider healthy";
  }
  if (state === "provider_degraded") {
    const base = profile
      ? `backend · provider ${profile} degraded`
      : "backend · provider degraded";
    return reason ? `${base} · ${reason}` : base;
  }
  if (state === "provider_unavailable") {
    const base = profile
      ? `backend · provider ${profile} unavailable`
      : "backend · provider unavailable";
    return reason ? `${base} · ${reason}` : base;
  }
  if (state === "keychain_available") {
    return "backend · keychain available";
  }
  if (state === "keychain_unavailable") {
    return reason
      ? `backend · keychain unavailable · ${reason}`
      : "backend · keychain unavailable";
  }
  if (state === "token_expiry_warning") {
    const secs = num(data.expires_in_seconds);
    const base = profile
      ? `backend · token expiry · ${profile}`
      : "backend · token expiry";
    return secs != null ? `${base} · expires in ${secs}s` : base;
  }
  return null;
}

/**
 * Apply one harness event. Skips if sequence already applied or id seen.
 * Does not text-dedupe user intents — identical prompts both stay.
 */
export function applyHarnessEvent(
  prev: TranscriptState,
  event: HarnessEvent,
  selectedSessionId: string,
): ReduceResult {
  const effects: ReduceResult["effects"] = [];
  if (
    event.session_id &&
    selectedSessionId &&
    event.session_id !== selectedSessionId
  ) {
    return { state: prev, effects };
  }

  const key = eventKey(event);
  if (event.sequence > 0 && event.sequence <= prev.lastSeq) {
    return { state: prev, effects };
  }
  if (prev.seenIds.has(key)) {
    return { state: prev, effects };
  }

  const seenIds = new Set(prev.seenIds);
  seenIds.add(key);
  const lastSeq =
    event.sequence > prev.lastSeq ? event.sequence : prev.lastSeq;

  let messages = prev.messages;
  let turnActive = prev.turnActive;
  let pendingApproval = prev.pendingApproval;
  let approvalId = prev.approvalId;
  let approvalSummary = prev.approvalSummary;
  let agentMode = prev.agentMode;

  const { type, data } = event.payload;
  const state = typeof data?.state === "string" ? data.state : "";

  if (type === "agent") {
    const runId = String(data.run_id ?? "");
    const text = String(data.text ?? "");
    if (state === "chunk" && text) {
      messages = appendAssistantChunk(messages, runId, text, event.sequence, key);
      turnActive = true;
    } else if (state === "final" && text) {
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant" && last.runId === runId) {
        messages = [
          ...messages.slice(0, -1),
          { ...last, text, ts: Date.now(), sequence: event.sequence },
        ];
      } else {
        messages = pushMsg(messages, "assistant", text, {
          id: key,
          runId,
          sequence: event.sequence,
        });
      }
    }
  } else if (type === "run") {
    if (state === "started") turnActive = true;
    if (
      state === "completed" ||
      state === "failed" ||
      state === "cancelled" ||
      state === "interrupted_unknown"
    ) {
      turnActive = false;
      if (state === "failed") {
        messages = pushMsg(
          messages,
          "system",
          `run failed · ${String(data.reason ?? "")}`,
          { id: key, sequence: event.sequence },
        );
      } else if (state === "cancelled") {
        messages = pushMsg(messages, "system", "run cancelled", {
          id: key,
          sequence: event.sequence,
        });
      }
    }
  } else if (type === "tool") {
    const name = String(data.name ?? data.tool_name ?? "tool");
    const toolCallId = toolCallIdOf(data);
    if (state === "started") {
      messages = upsertActivity(
        messages,
        {
          phase: "tool",
          title: `● ${name}`,
          status: "running",
          toolName: name,
          toolCallId,
        },
        { id: key, sequence: event.sequence },
      );
    } else if (state === "finished") {
      const summary = String(data.summary ?? "done");
      messages = upsertActivity(
        messages,
        {
          phase: "tool",
          title: `● ${name}`,
          detail: summary,
          status: "done",
          toolName: name,
          toolCallId,
        },
        { id: key, sequence: event.sequence },
      );
    } else if (state === "observed") {
      const preview = String(data.preview ?? data.outcome ?? "");
      const outcome = String(data.outcome ?? "");
      messages = upsertActivity(
        messages,
        {
          phase: "tool",
          title: `● ${name}`,
          detail: preview,
          status: observedStatus(outcome),
          toolName: name,
          toolCallId,
        },
        { id: key, sequence: event.sequence },
      );
    } else if (state === "deferred") {
      const id = String(data.approval_id ?? "");
      if (id) {
        approvalId = id;
        approvalSummary = `${name} needs approval`;
        pendingApproval = true;
        messages = pushMsg(messages, "tool", approvalSummary, {
          id: key,
          sequence: event.sequence,
        });
        effects.push({ kind: "approval", id, summary: approvalSummary });
      }
    }
  } else if (type === "approval") {
    const request = data.request as { id?: string; reason?: string } | undefined;
    if (state === "requested" && request?.id) {
      approvalId = request.id;
      approvalSummary = request.reason ?? "approval required";
      pendingApproval = true;
      messages = pushMsg(
        messages,
        "tool",
        approvalSummary
          ? `approval · ${approvalSummary}`
          : `approval · ${request.id.slice(0, 8)}…`,
        { id: key, sequence: event.sequence },
      );
      effects.push({
        kind: "approval",
        id: request.id,
        summary: approvalSummary,
      });
    } else if (state === "resolved") {
      pendingApproval = false;
      approvalSummary = "";
    }
  } else if (type === "intent") {
    const text = String(data.text ?? "");
    if (text) {
      messages = pushMsg(messages, "user", text, {
        id: key,
        sequence: event.sequence,
      });
    }
  } else if (type === "session") {
    const modeChanged = data.execution_mode_changed as
      | { mode?: string }
      | undefined;
    if (modeChanged && typeof modeChanged.mode === "string") {
      agentMode = modeChanged.mode;
    }
  } else if (type === "notice") {
    if (typeof data === "object" && data) {
      const kind = typeof data.kind === "string" ? data.kind : "";
      if (kind === "runtime" && typeof data.message === "string") {
        messages = pushMsg(messages, "system", data.message, {
          id: key,
          sequence: event.sequence,
        });
      } else if (kind === "policy_denied") {
        messages = pushMsg(
          messages,
          "system",
          `policy denied · ${String(data.reason ?? "")}`,
          { id: key, sequence: event.sequence },
        );
      } else if ("runtime" in data) {
        const runtime = data.runtime as { message?: string };
        if (runtime?.message) {
          messages = pushMsg(messages, "system", runtime.message, {
            id: key,
            sequence: event.sequence,
          });
        }
      } else if ("policy_denied" in data) {
        const denied = data.policy_denied as { reason?: string };
        messages = pushMsg(
          messages,
          "system",
          `policy denied · ${denied?.reason ?? ""}`,
          { id: key, sequence: event.sequence },
        );
      }
    }
  } else if (type === "plan") {
    // PlanEvent { summary } — surface summary only (no CoT).
    const summary = typeof data.summary === "string" ? data.summary.trim() : "";
    if (summary) {
      messages = pushMsg(messages, "system", `plan · ${summary}`, {
        id: key,
        sequence: event.sequence,
      });
    }
  } else if (type === "budget") {
    // BudgetEvent: tag state. Skip noisy Updated; surface limits / compaction.
    const line = budgetLine(data);
    if (line) {
      messages = pushMsg(messages, "system", line, {
        id: key,
        sequence: event.sequence,
      });
    }
  } else if (type === "retry") {
    // RetryEvent: externally tagged (attempting|succeeded|exhausted).
    const line = retryLine(data);
    if (line) {
      const status: ActivityStatus =
        "exhausted" in data ? "error" : "succeeded" in data ? "done" : "running";
      messages = upsertActivity(
        messages,
        {
          phase: "retry",
          title: line.title,
          detail: line.detail,
          status,
          toolName: "retry",
        },
        { id: key, sequence: event.sequence },
      );
    }
  } else if (type === "backend") {
    // BackendEvent: tag state — provider/keychain status only (no secrets).
    const line = backendLine(data);
    if (line) {
      messages = pushMsg(messages, "system", line, {
        id: key,
        sequence: event.sequence,
      });
    }
  }

  return {
    state: {
      messages,
      lastSeq,
      seenIds,
      turnActive,
      pendingApproval,
      approvalId,
      approvalSummary,
      agentMode,
    },
    effects,
  };
}

export function assertHarnessEventReducer(): void {
  let s = emptyTranscriptState();
  const e1: HarnessEvent = {
    id: "a",
    sequence: 1,
    session_id: "s1",
    payload: { type: "intent", data: { text: "hello" } },
  };
  let r = applyHarnessEvent(s, e1, "s1");
  s = r.state;
  if (s.messages.length !== 1 || s.messages[0]?.text !== "hello") {
    throw new Error("intent apply failed");
  }
  // Same text, new id/seq → second user bubble (no text dedupe).
  const e2: HarnessEvent = {
    id: "b",
    sequence: 2,
    session_id: "s1",
    payload: { type: "intent", data: { text: "hello" } },
  };
  r = applyHarnessEvent(s, e2, "s1");
  s = r.state;
  if (s.messages.filter((m) => m.role === "user").length !== 2) {
    throw new Error("duplicate text intents must both appear");
  }
  // Replay same seq → no-op.
  r = applyHarnessEvent(s, e2, "s1");
  if (r.state.messages.length !== s.messages.length) {
    throw new Error("seq gate failed");
  }
  // Other session dropped.
  const e3: HarnessEvent = {
    id: "c",
    sequence: 3,
    session_id: "other",
    payload: { type: "intent", data: { text: "nope" } },
  };
  r = applyHarnessEvent(s, e3, "s1");
  if (r.state.messages.length !== s.messages.length) {
    throw new Error("session filter failed");
  }
  // Chunk merge.
  const c1: HarnessEvent = {
    id: "c1",
    sequence: 4,
    session_id: "s1",
    payload: {
      type: "agent",
      data: { state: "chunk", run_id: "r1", text: "Hi" },
    },
  };
  r = applyHarnessEvent(s, c1, "s1");
  s = r.state;
  const c2: HarnessEvent = {
    id: "c2",
    sequence: 5,
    session_id: "s1",
    payload: {
      type: "agent",
      data: { state: "chunk", run_id: "r1", text: "!" },
    },
  };
  r = applyHarnessEvent(s, c2, "s1");
  s = r.state;
  const last = s.messages[s.messages.length - 1];
  if (!last || last.role !== "assistant" || last.text !== "Hi!") {
    throw new Error(`chunk merge failed: ${last?.text}`);
  }
  if (s.lastSeq !== 5) throw new Error("lastSeq not advanced");

  // Tool started → finished merges into one activity card (by tool_call_id).
  const beforeTools = s.messages.length;
  const tStart: HarnessEvent = {
    id: "t1",
    sequence: 6,
    session_id: "s1",
    payload: {
      type: "tool",
      data: {
        state: "started",
        name: "read_file",
        tool_call_id: "call_1",
      },
    },
  };
  r = applyHarnessEvent(s, tStart, "s1");
  s = r.state;
  if (s.messages.length !== beforeTools + 1) {
    throw new Error("tool started should append one card");
  }
  const running = s.messages[s.messages.length - 1];
  if (
    !running ||
    running.kind !== "activity" ||
    running.activity?.status !== "running" ||
    running.activity?.title !== "● read_file"
  ) {
    throw new Error("tool started activity shape wrong");
  }
  const tFin: HarnessEvent = {
    id: "t2",
    sequence: 7,
    session_id: "s1",
    payload: {
      type: "tool",
      data: {
        state: "finished",
        name: "read_file",
        summary: "12 lines",
        tool_call_id: "call_1",
      },
    },
  };
  r = applyHarnessEvent(s, tFin, "s1");
  s = r.state;
  if (s.messages.length !== beforeTools + 1) {
    throw new Error("tool finished must merge into same card");
  }
  const done = s.messages[s.messages.length - 1];
  if (
    !done ||
    done.kind !== "activity" ||
    done.activity?.status !== "done" ||
    done.activity?.detail !== "12 lines" ||
    done.activity?.toolCallId !== "call_1"
  ) {
    throw new Error("tool finished merge shape wrong");
  }

  // Name-only merge when no tool_call_id.
  const tStart2: HarnessEvent = {
    id: "t3",
    sequence: 8,
    session_id: "s1",
    payload: {
      type: "tool",
      data: { state: "started", name: "grep" },
    },
  };
  r = applyHarnessEvent(s, tStart2, "s1");
  s = r.state;
  const afterStart2 = s.messages.length;
  const tFin2: HarnessEvent = {
    id: "t4",
    sequence: 9,
    session_id: "s1",
    payload: {
      type: "tool",
      data: { state: "finished", name: "grep", summary: "3 hits" },
    },
  };
  r = applyHarnessEvent(s, tFin2, "s1");
  s = r.state;
  if (s.messages.length !== afterStart2) {
    throw new Error("name-only tool finished must merge");
  }
  const grepDone = s.messages[s.messages.length - 1];
  if (grepDone?.activity?.detail !== "3 hits" || grepDone?.activity?.status !== "done") {
    throw new Error("name-only merge detail wrong");
  }

  // Plan summary → system line; empty summary ignored.
  const beforePlan = s.messages.length;
  const planEmpty: HarnessEvent = {
    id: "p0",
    sequence: 10,
    session_id: "s1",
    payload: { type: "plan", data: { summary: "  " } },
  };
  r = applyHarnessEvent(s, planEmpty, "s1");
  s = r.state;
  if (s.messages.length !== beforePlan) {
    throw new Error("empty plan summary must be ignored");
  }
  const planOk: HarnessEvent = {
    id: "p1",
    sequence: 11,
    session_id: "s1",
    payload: { type: "plan", data: { summary: "ship activity cards" } },
  };
  r = applyHarnessEvent(s, planOk, "s1");
  s = r.state;
  const planMsg = s.messages[s.messages.length - 1];
  if (
    !planMsg ||
    planMsg.role !== "system" ||
    planMsg.text !== "plan · ship activity cards"
  ) {
    throw new Error(`plan surface failed: ${planMsg?.text}`);
  }

  // Budget limit + retry attempting → activity; Updated skipped.
  const beforeBudget = s.messages.length;
  const budUpd: HarnessEvent = {
    id: "b0",
    sequence: 12,
    session_id: "s1",
    payload: {
      type: "budget",
      data: {
        state: "updated",
        turns_used: 1,
        tokens_used: 10,
        measured: true,
        compaction_count: 0,
        context_used_percent: 5,
      },
    },
  };
  r = applyHarnessEvent(s, budUpd, "s1");
  s = r.state;
  if (s.messages.length !== beforeBudget) {
    throw new Error("budget updated must stay silent");
  }
  const budLimit: HarnessEvent = {
    id: "b1",
    sequence: 13,
    session_id: "s1",
    payload: {
      type: "budget",
      data: { state: "token_limit_approaching", limit: 1000, used: 900 },
    },
  };
  r = applyHarnessEvent(s, budLimit, "s1");
  s = r.state;
  const budMsg = s.messages[s.messages.length - 1];
  if (
    !budMsg ||
    budMsg.role !== "system" ||
    budMsg.text !== "budget · token limit 900/1000"
  ) {
    throw new Error(`budget surface failed: ${budMsg?.text}`);
  }

  const retryAtt: HarnessEvent = {
    id: "r1",
    sequence: 14,
    session_id: "s1",
    payload: {
      type: "retry",
      data: {
        attempting: {
          attempt: 1,
          max_attempts: 3,
          reason: "timeout",
          backoff_ms: 200,
        },
      },
    },
  };
  r = applyHarnessEvent(s, retryAtt, "s1");
  s = r.state;
  const retryMsg = s.messages[s.messages.length - 1];
  if (
    !retryMsg ||
    retryMsg.kind !== "activity" ||
    retryMsg.activity?.phase !== "retry" ||
    retryMsg.activity?.status !== "running" ||
    retryMsg.activity?.title !== "retry 1/3" ||
    retryMsg.activity?.detail !== "timeout · backoff 200ms"
  ) {
    throw new Error(`retry surface failed: ${retryMsg?.text}`);
  }

  const be: HarnessEvent = {
    id: "be1",
    sequence: 15,
    session_id: "s1",
    payload: {
      type: "backend",
      data: {
        state: "provider_degraded",
        profile: "default",
        reason: "rate limit",
      },
    },
  };
  r = applyHarnessEvent(s, be, "s1");
  s = r.state;
  const beMsg = s.messages[s.messages.length - 1];
  if (
    !beMsg ||
    beMsg.role !== "system" ||
    beMsg.text !== "backend · provider default degraded · rate limit"
  ) {
    throw new Error(`backend surface failed: ${beMsg?.text}`);
  }
}
