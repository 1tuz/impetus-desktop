/**
 * Selfcheck: harness event reducer — seq gate, plan/budget/retry/tool merges.
 */
import {
  applyHarnessEvent,
  assertHarnessEventReducer,
  emptyTranscriptState,
  type HarnessEvent,
} from "../src/lib/harnessEventReducer.ts";

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function ev(
  id: string,
  sequence: number,
  type: string,
  data: Record<string, unknown>,
): HarnessEvent {
  return { id, sequence, session_id: "s1", payload: { type, data } };
}

check("harnessEventReducer baseline", () => {
  assertHarnessEventReducer();
});

check("plan payload → system plan ·", () => {
  let s = emptyTranscriptState();
  let r = applyHarnessEvent(
    s,
    ev("p1", 1, "plan", { summary: "ship activity cards" }),
    "s1",
  );
  s = r.state;
  const msg = s.messages[0];
  if (!msg || msg.role !== "system" || msg.text !== "plan · ship activity cards") {
    throw new Error(`plan surface failed: ${msg?.text}`);
  }
  r = applyHarnessEvent(s, ev("p0", 2, "plan", { summary: "  " }), "s1");
  if (r.state.messages.length !== 1) {
    throw new Error("empty plan summary must be ignored");
  }
});

check("budget compaction_required / turn_limit → system line", () => {
  let s = emptyTranscriptState();
  let r = applyHarnessEvent(
    s,
    ev("b1", 1, "budget", {
      state: "compaction_required",
      used: 8000,
      threshold: 10000,
    }),
    "s1",
  );
  s = r.state;
  const compact = s.messages[0];
  if (
    !compact ||
    compact.role !== "system" ||
    compact.text !== "budget · compaction required 8000/10000 tokens"
  ) {
    throw new Error(`compaction_required failed: ${compact?.text}`);
  }
  r = applyHarnessEvent(
    s,
    ev("b2", 2, "budget", {
      state: "turn_limit_approaching",
      used: 9,
      limit: 10,
    }),
    "s1",
  );
  s = r.state;
  const turn = s.messages[s.messages.length - 1];
  if (
    !turn ||
    turn.role !== "system" ||
    turn.text !== "budget · turn limit 9/10"
  ) {
    throw new Error(`turn_limit failed: ${turn?.text}`);
  }
});

check("budget Updated skipped (no spam)", () => {
  let s = emptyTranscriptState();
  const r = applyHarnessEvent(
    s,
    ev("bu", 1, "budget", {
      state: "updated",
      turns_used: 1,
      tokens_used: 10,
      measured: true,
      compaction_count: 0,
      context_used_percent: 5,
    }),
    "s1",
  );
  if (r.state.messages.length !== 0) {
    throw new Error("budget updated must stay silent");
  }
  if (r.state.lastSeq !== 1) {
    throw new Error("updated still advances lastSeq");
  }
});

check("retry attempting→succeeded activity merge", () => {
  let s = emptyTranscriptState();
  let r = applyHarnessEvent(
    s,
    ev("r1", 1, "retry", {
      attempting: {
        attempt: 1,
        max_attempts: 3,
        reason: "timeout",
        backoff_ms: 200,
      },
    }),
    "s1",
  );
  s = r.state;
  if (s.messages.length !== 1) {
    throw new Error("retry attempting should append one card");
  }
  const running = s.messages[0];
  if (
    !running ||
    running.kind !== "activity" ||
    running.activity?.phase !== "retry" ||
    running.activity?.status !== "running" ||
    running.activity?.title !== "retry 1/3" ||
    running.activity?.detail !== "timeout · backoff 200ms"
  ) {
    throw new Error(`retry attempting shape wrong: ${running?.text}`);
  }
  r = applyHarnessEvent(
    s,
    ev("r2", 2, "retry", { succeeded: { attempt: 2 } }),
    "s1",
  );
  s = r.state;
  if (s.messages.length !== 1) {
    throw new Error("retry succeeded must merge into same card");
  }
  const done = s.messages[0];
  if (
    !done ||
    done.kind !== "activity" ||
    done.activity?.phase !== "retry" ||
    done.activity?.status !== "done" ||
    done.activity?.title !== "retry succeeded" ||
    done.activity?.detail !== "recovered on attempt 2"
  ) {
    throw new Error(`retry succeeded merge wrong: ${done?.text}`);
  }
});

check("tool started→finished merge by tool_call_id", () => {
  let s = emptyTranscriptState();
  let r = applyHarnessEvent(
    s,
    ev("t1", 1, "tool", {
      state: "started",
      name: "read_file",
      tool_call_id: "call_1",
    }),
    "s1",
  );
  s = r.state;
  if (s.messages.length !== 1 || s.messages[0]?.activity?.status !== "running") {
    throw new Error("tool started should append running card");
  }
  r = applyHarnessEvent(
    s,
    ev("t2", 2, "tool", {
      state: "finished",
      name: "read_file",
      summary: "12 lines",
      tool_call_id: "call_1",
    }),
    "s1",
  );
  s = r.state;
  if (s.messages.length !== 1) {
    throw new Error("tool finished must merge by tool_call_id");
  }
  const done = s.messages[0];
  if (
    !done ||
    done.kind !== "activity" ||
    done.activity?.status !== "done" ||
    done.activity?.detail !== "12 lines" ||
    done.activity?.toolCallId !== "call_1"
  ) {
    throw new Error("tool finished merge shape wrong");
  }
});

console.log("event-reducer-selfcheck: all passed");
