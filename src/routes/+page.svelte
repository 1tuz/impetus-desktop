<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import {
    DEFAULT_APPEARANCE,
    DEFAULT_PACK_ID,
    DEFAULT_THEME_ID,
    applyThemePrefs,
    cyclePackId,
    readStoredPrefs,
    toggleAppearancePref,
    watchSystemAppearance,
    type AppearancePref,
  } from "$lib/themes";
  import { digitIndex, isMod, suppressBrowserChrome } from "$lib/hotkeys";
  import PreferencesPanel from "$lib/PreferencesPanel.svelte";
  import { type AttachActionId } from "$lib/attachMenu";
  import {
    DEFAULT_AGENT_MODE,
    DEFAULT_PROMPT_INTENT,
    cyclePromptIntent,
    isAgentModeId,
    stripModePrefix,
    type AgentModeId,
    type PromptIntentId,
  } from "$lib/agentModes";
  import {
    appendPathsToPrompt,
    dispositionForDrop,
    type DroppedPathInfo,
  } from "$lib/chatDrop";
  import {
    attachmentFromBlob,
    attachmentFromPath,
    ensureImageFile,
    extFromMime,
    isImageMime,
    isImagePath,
    mergeAttachmentsIntoPrompt,
    partitionPaths,
    revokeAttachments,
    toPreviewableImage,
    type ComposerAttachment,
  } from "$lib/composerAttachments";
  import AppTopbar from "$lib/components/AppTopbar.svelte";
  import Composer from "$lib/components/Composer.svelte";
  import SessionRail from "$lib/components/SessionRail.svelte";
  import SetupWizard from "$lib/components/SetupWizard.svelte";
  import Transcript from "$lib/components/Transcript.svelte";
  import "$lib/components/shell.css";

  type HelloInfo = {
    version: number;
    capabilities: string[];
    socket_path: string;
  };

  type SessionDto = {
    id: string;
    created_at_unix_ms: number;
    updated_at_unix_ms: number;
    parent_session_id: string | null;
    fork_sequence: number | null;
  };

  type StatusInfo = {
    connected: boolean;
    socket_path: string;
    session_id: string | null;
    runtime_status: string | null;
  };

  type DaemonProbe = {
    socket_path: string;
    socket_exists: boolean;
    reachable: boolean;
    detail: string;
  };

  type ApprovalDetailDto = {
    approval_id: string;
    reason: string;
    state: string;
    diff_preview: string | null;
    affected_files: string[];
    estimated_scope: string | null;
  };

  /** Durable harness Event (subset used by the shell). */
  type HarnessEvent = {
    sequence: number;
    session_id: string;
    payload: {
      type: string;
      data: Record<string, unknown>;
    };
  };

  type SessionEventsPayload = {
    session_id: string;
    events: HarnessEvent[];
  };

  type Role = "system" | "user" | "assistant" | "tool";
  type Msg = { id: string; role: Role; text: string; ts: number; runId?: string };

  const SETUP_KEY = "impetus.desktop.setup.v1";
  const RAIL_KEY = "impetus.desktop.rail";
  const WORKSPACE_KEY = "impetus.desktop.workspace";

  /** Vite browser has no Tauri IPC — invoke() throws TypeError. */
  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  let connected = $state(false);
  let socketPath = $state("");
  let sessions = $state<SessionDto[]>([]);
  let selectedSessionId = $state("");
  let workspaceRoot = $state(
    typeof localStorage !== "undefined" ? localStorage.getItem(WORKSPACE_KEY) ?? "" : "",
  );
  let promptText = $state("");
  let approvalId = $state("");
  let approvalSummary = $state("");
  let pendingApproval = $state(false);
  let busy = $state(false);
  let turnActive = $state(false);
  let messages = $state<Msg[]>([]);
  let promptIntent = $state<PromptIntentId>(DEFAULT_PROMPT_INTENT);
  let eventsUnlisten: UnlistenFn | null = null;
  let railOpen = $state(
    typeof localStorage !== "undefined" ? localStorage.getItem(RAIL_KEY) !== "0" : true,
  );
  let showSetup = $state(false);
  let setupStep = $state(0);
  let probe = $state<DaemonProbe | null>(null);
  let transcriptEl = $state<HTMLElement | null>(null);
  let promptEl = $state<HTMLTextAreaElement | null>(null);
  let attachOpen = $state(false);
  let modeOpen = $state(false);
  let agentMode = $state<AgentModeId>(DEFAULT_AGENT_MODE);
  let dropActive = $state(false);
  let attachments = $state<ComposerAttachment[]>([]);

  let packId = $state(DEFAULT_PACK_ID);
  let appearance = $state<AppearancePref>(DEFAULT_APPEARANCE);
  let themeId = $state(DEFAULT_THEME_ID);
  let showPrefs = $state(false);

  function applyCurrentTheme() {
    const next = applyThemePrefs(packId, appearance);
    packId = next.packId;
    appearance = next.appearance;
    themeId = next.themeId;
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function push(role: Role, text: string, runId?: string) {
    messages = [...messages, { id: uid(), role, text, ts: Date.now(), runId }];
    queueMicrotask(() => {
      if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
    });
  }

  function appendAssistantChunk(runId: string, text: string) {
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && last.runId === runId) {
      messages = [
        ...messages.slice(0, -1),
        { ...last, text: last.text + text, ts: Date.now() },
      ];
    } else {
      push("assistant", text, runId);
    }
    queueMicrotask(() => {
      if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
    });
  }

  function errorMessage(err: unknown): string {
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  async function startLiveSubscribe(sessionId: string) {
    if (!inTauriShell() || !sessionId) return;
    try {
      await invoke("subscribe_session_events", {
        sessionId,
        afterSeq: 0,
      });
    } catch (err) {
      push("system", `subscribe: ${errorMessage(err)}`);
    }
  }

  async function stopLiveSubscribe() {
    if (!inTauriShell()) return;
    try {
      await invoke("unsubscribe_session_events");
    } catch {
      /* ignore */
    }
  }

  async function syncExecutionMode(sessionId: string) {
    if (!inTauriShell() || !sessionId) return;
    try {
      const mode = await invoke<string>("get_execution_mode", { sessionId });
      if (isAgentModeId(mode)) agentMode = mode;
    } catch {
      /* fresh session / older daemon — keep UI default */
    }
  }

  async function changeAgentMode(id: AgentModeId) {
    agentMode = id;
    if (!inTauriShell() || !connected || !selectedSessionId) return;
    try {
      const confirmed = await invoke<string>("set_execution_mode", {
        sessionId: selectedSessionId,
        mode: id,
      });
      if (isAgentModeId(confirmed)) agentMode = confirmed;
      push("system", `mode · ${confirmed}`);
    } catch (err) {
      push("system", `mode: ${errorMessage(err)}`);
    }
  }

  async function surfaceApproval(id: string, summary: string) {
    approvalId = id;
    approvalSummary = summary;
    pendingApproval = true;
    push("tool", summary ? `approval · ${summary}` : `approval · ${id.slice(0, 8)}…`);
    if (!inTauriShell() || !selectedSessionId) return;
    try {
      const detail = await invoke<ApprovalDetailDto>("get_approval_detail", {
        sessionId: selectedSessionId,
        approvalId: id,
      });
      const bits = [
        detail.reason,
        detail.affected_files.length
          ? `files: ${detail.affected_files.slice(0, 3).join(", ")}`
          : "",
        detail.estimated_scope ?? "",
      ].filter(Boolean);
      if (bits.length) approvalSummary = bits.join(" · ");
      if (detail.diff_preview) {
        push("tool", detail.diff_preview.slice(0, 800));
      }
    } catch {
      /* detail optional — id already surfaced */
    }
  }

  function handleHarnessEvent(event: HarnessEvent) {
    if (event.session_id && selectedSessionId && event.session_id !== selectedSessionId) {
      return;
    }
    const { type, data } = event.payload;
    const state = typeof data?.state === "string" ? data.state : "";

    if (type === "agent") {
      const runId = String(data.run_id ?? "");
      const text = String(data.text ?? "");
      if (state === "chunk" && text) {
        appendAssistantChunk(runId, text);
        turnActive = true;
      } else if (state === "final" && text) {
        const last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.runId === runId) {
          messages = [
            ...messages.slice(0, -1),
            { ...last, text, ts: Date.now() },
          ];
        } else {
          push("assistant", text, runId);
        }
      }
      return;
    }

    if (type === "run") {
      if (state === "started") turnActive = true;
      if (
        state === "completed" ||
        state === "failed" ||
        state === "cancelled" ||
        state === "interrupted_unknown"
      ) {
        turnActive = false;
        if (state === "failed") {
          push("system", `run failed · ${String(data.reason ?? "")}`);
        } else if (state === "cancelled") {
          push("system", "run cancelled");
        }
      }
      return;
    }

    if (type === "tool") {
      const name = String(data.name ?? data.tool_name ?? "tool");
      if (state === "started") {
        push("tool", `${name}…`);
      } else if (state === "finished") {
        push("tool", `${name} · ${String(data.summary ?? "done")}`);
      } else if (state === "observed") {
        push("tool", `${name} · ${String(data.preview ?? data.outcome ?? "")}`);
      } else if (state === "deferred") {
        const id = String(data.approval_id ?? "");
        if (id) void surfaceApproval(id, `${name} needs approval`);
      }
      return;
    }

    if (type === "approval") {
      const request = data.request as { id?: string; reason?: string } | undefined;
      if (state === "requested" && request?.id) {
        void surfaceApproval(request.id, request.reason ?? "approval required");
      } else if (state === "resolved") {
        pendingApproval = false;
        approvalSummary = "";
      }
      return;
    }

    if (type === "intent") {
      const text = String(data.text ?? "");
      if (text && !messages.some((m) => m.role === "user" && m.text === text)) {
        push("user", text);
      }
      return;
    }

    if (type === "session") {
      // SessionEvent is externally tagged (not state-tagged).
      const modeChanged = data.execution_mode_changed as { mode?: string } | undefined;
      if (modeChanged && typeof modeChanged.mode === "string" && isAgentModeId(modeChanged.mode)) {
        agentMode = modeChanged.mode;
      }
      return;
    }

    if (type === "notice") {
      if (typeof data === "object" && data) {
        if ("runtime" in data) {
          const runtime = data.runtime as { message?: string };
          if (runtime?.message) push("system", runtime.message);
        } else if ("policy_denied" in data) {
          const denied = data.policy_denied as { reason?: string };
          push("system", `policy denied · ${denied?.reason ?? ""}`);
        }
      }
      return;
    }
  }

  function onSessionEvents(payload: SessionEventsPayload) {
    if (payload.session_id !== selectedSessionId) return;
    for (const event of payload.events) {
      handleHarnessEvent(event);
    }
  }

  async function withBusy(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      push("system", `${label}: ${errorMessage(err)}`);
    } finally {
      busy = false;
    }
  }

  async function runProbe() {
    if (!inTauriShell()) {
      probe = {
        socket_path: "(web preview — use Impetus Desktop.app)",
        socket_exists: false,
        reachable: false,
        detail: "IPC unavailable in browser",
      };
      socketPath = probe.socket_path;
      return probe;
    }
    probe = await invoke<DaemonProbe>("probe_daemon");
    socketPath = probe.socket_path;
    return probe;
  }

  async function connect(): Promise<boolean> {
    if (!inTauriShell()) return false;
    let ok = false;
    await withBusy("connect", async () => {
      const hello = await invoke<HelloInfo>("harness_hello");
      connected = true;
      socketPath = hello.socket_path;
      push(
        "system",
        `connected · ${hello.socket_path}\ncaps: ${hello.capabilities.join(", ") || "(none)"}`,
      );
      await refreshSessions();
      ok = true;
    });
    return ok;
  }

  async function disconnect() {
    if (!inTauriShell()) return;
    await withBusy("disconnect", async () => {
      await stopLiveSubscribe();
      await invoke("disconnect");
      connected = false;
      sessions = [];
      selectedSessionId = "";
      pendingApproval = false;
      approvalSummary = "";
      turnActive = false;
      push("system", "disconnected");
    });
  }

  async function startDaemon() {
    if (!inTauriShell()) {
      push("system", "Web preview — Start daemon needs Impetus Desktop.app");
      return;
    }
    await withBusy("start daemon", async () => {
      const p = await invoke<DaemonProbe>("start_daemon");
      probe = p;
      socketPath = p.socket_path;
      push("system", p.detail);
    });
    if (probe?.reachable && !connected) {
      await connect();
    }
  }

  const daemonReachable = $derived(probe?.reachable ?? false);

  async function refreshSessions() {
    if (!inTauriShell()) return;
    const list = await invoke<SessionDto[]>("list_sessions");
    sessions = list;
    if (selectedSessionId && !list.some((s) => s.id === selectedSessionId)) {
      selectedSessionId = "";
      pendingApproval = false;
    }
  }

  async function createSession(opts: { pickIfMissing?: boolean } = {}) {
    const pickIfMissing = opts.pickIfMissing ?? false;
    if (!inTauriShell()) {
      push(
        "system",
        "Web preview — New Chat needs Impetus Desktop.app (browser has no daemon IPC)",
      );
      return;
    }
    if (!connected) {
      const ok = await connect();
      if (!ok) {
        push("system", "impetusd unreachable — start the daemon, then try New Chat again");
        return;
      }
    }
    await withBusy("create session", async () => {
      let root = workspaceRoot.trim();
      if (!root) {
        if (!pickIfMissing) {
          push("system", "Open a workspace first (folder + in the sidebar)");
          return;
        }
        const picked = await invoke<string | null>("pick_folder");
        if (!picked) {
          push("system", "no folder selected");
          return;
        }
        workspaceRoot = picked;
        root = picked;
      }
      const id = await invoke<string>("create_session", { workspaceRoot: root });
      selectedSessionId = id;
      messages = [];
      pendingApproval = false;
      approvalSummary = "";
      turnActive = false;
      push("system", `session ${id.slice(0, 8)}… · ${root}`);
      await refreshSessions();
      await syncExecutionMode(id);
      await startLiveSubscribe(id);
    });
  }

  async function pickWorkspaceFolder(): Promise<string | null> {
    if (!inTauriShell()) {
      push("system", "Web preview — folder picker needs Impetus Desktop.app");
      return null;
    }
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (!picked) return null;
      workspaceRoot = picked;
      push("system", `workspace · ${picked}`);
      return picked;
    } catch (err) {
      push("system", `folder pick: ${errorMessage(err)}`);
      return null;
    }
  }

  async function addImageFiles(files: File[]) {
    const next: ComposerAttachment[] = [];
    const tauri = inTauriShell();
    for (const raw of files) {
      const file = await toPreviewableImage(
        isImageMime(raw.type) ? raw : ensureImageFile(raw),
      );
      if (!isImageMime(file.type)) continue;
      const ext = extFromMime(file.type || "image/png");
      const name = file.name || `paste.${ext}`;
      let path: string | undefined;
      // Browser vite has no Rust host — preview-only chips, no temp path.
      if (tauri) {
        try {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          path = await invoke<string>("save_temp_image", { bytes, ext });
        } catch (err) {
          push("system", `image save: ${errorMessage(err)}`);
        }
      }
      next.push(attachmentFromBlob(file, name, path));
    }
    if (!next.length) {
      push("system", "paste: no image data in clipboard");
      return;
    }
    attachments = [...attachments, ...next];
    focusPrompt();
  }

  async function addImagePaths(paths: string[]) {
    if (!paths.length) return;
    const next: ComposerAttachment[] = [];
    for (const path of paths) {
      const name = path.split("/").filter(Boolean).pop() ?? path;
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "png";
      try {
        const bytes = await invoke<number[]>("read_image_bytes", { path });
        const mime = `image/${ext === "jpg" || ext === "jpeg" ? "jpeg" : ext}`;
        const blob = new Blob([new Uint8Array(bytes)], { type: mime });
        next.push(attachmentFromBlob(blob, name, path));
      } catch (err) {
        // Preview failed — still keep path chip via empty 1×1? Better: path-only thumb placeholder.
        push("system", `image preview: ${errorMessage(err)}`);
        next.push(attachmentFromPath(path, ""));
      }
    }
    if (!next.length) return;
    attachments = [...attachments, ...next];
    focusPrompt();
  }

  function removeAttachment(id: string) {
    const gone = attachments.find((a) => a.id === id);
    if (gone?.revokeOnClear) URL.revokeObjectURL(gone.previewUrl);
    attachments = attachments.filter((a) => a.id !== id);
  }

  function clearAttachments() {
    revokeAttachments(attachments);
    attachments = [];
  }

  async function sendPrompt() {
    const raw = promptText.trim();
    if (!raw && attachments.length === 0) return;

    if (!inTauriShell()) {
      push(
        "system",
        "Web preview — send needs Impetus Desktop.app (browser has no daemon IPC)",
      );
      return;
    }

    if (!connected) {
      const ok = await connect();
      if (!ok) {
        push("system", "impetusd unreachable — start the daemon, then send again");
        return;
      }
    }

    if (!selectedSessionId) {
      await createSession({ pickIfMissing: true });
      if (!selectedSessionId) return;
    }

    // Images: harness is text-only for now — paths land in the prompt body.
    // Execution mode is daemon-owned (set_execution_mode); no prompt banners.
    const body = stripModePrefix(mergeAttachmentsIntoPrompt(raw, attachments));
    const intent = promptIntent;
    push("user", body);
    promptText = "";
    clearAttachments();
    await withBusy("send", async () => {
      await invoke<string>("send_prompt", {
        sessionId: selectedSessionId,
        text: body,
        intent,
      });
      // Streaming arrives via harness://events — do not fake status-as-assistant.
      if (intent === "prompt" || intent === "steer") turnActive = true;
      await refreshStatus();
    });
  }

  async function refreshStatus() {
    if (!inTauriShell()) return;
    await withBusy("status", async () => {
      const status = await invoke<StatusInfo>("get_status", {
        sessionId: selectedSessionId || null,
      });
      connected = status.connected;
      socketPath = status.socket_path || socketPath;
      if (status.runtime_status) {
        pendingApproval = status.runtime_status.includes("AwaitingApproval");
      }
    });
  }

  async function resolve(accept: boolean) {
    if (!selectedSessionId || !approvalId.trim()) {
      push("system", "need session + approval id");
      return;
    }
    await withBusy("approval", async () => {
      await invoke("resolve_approval", {
        sessionId: selectedSessionId,
        approvalId: approvalId.trim(),
        accept,
      });
      push("tool", accept ? "approval accepted" : "approval denied");
      pendingApproval = false;
      approvalId = "";
      approvalSummary = "";
      await refreshStatus();
    });
  }

  function finishSetup() {
    localStorage.setItem(SETUP_KEY, "done");
    showSetup = false;
    push("system", "ready — connect to impetusd, then prompt");
  }

  function skipSetup() {
    localStorage.setItem(SETUP_KEY, "done");
    showSetup = false;
  }

  /** Explicit user action only — never call from onMount / setup auto-flow. */
  async function openSecuritySettings() {
    await invoke("open_external", {
      url: "x-apple.systempreferences:com.apple.preference.security",
    });
  }

  function resetSetupWizard() {
    localStorage.removeItem(SETUP_KEY);
    showPrefs = false;
    showSetup = true;
    setupStep = 0;
    void runProbe();
  }

  function cycleTheme() {
    packId = cyclePackId(packId);
    applyCurrentTheme();
  }

  function toggleAppearance() {
    appearance = toggleAppearancePref(appearance);
    applyCurrentTheme();
  }

  function clearTranscript() {
    messages = [];
  }

  function setRailOpen(next: boolean) {
    railOpen = next;
    localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  }

  function toggleRail() {
    setRailOpen(!railOpen);
  }

  function focusPrompt() {
    setRailOpen(true);
    queueMicrotask(() => promptEl?.focus());
  }

  async function addAttachedFiles(files: File[]) {
    if (!files.length) return;
    const images = files.filter((f) => isImageMime(f.type) || isImagePath(f.name));
    const other = files.filter((f) => !isImageMime(f.type) && !isImagePath(f.name));
    if (images.length) await addImageFiles(images);
    if (other.length) {
      const names = other.map((f) => f.name).filter(Boolean);
      promptText = appendPathsToPrompt(promptText, names);
      push(
        "system",
        names.length === 1 ? `attached · ${names[0]}` : `attached · ${names.length} files`,
      );
      focusPrompt();
    }
  }

  function pickAttachedFiles() {
    if (inTauriShell()) {
      void (async () => {
        try {
          const paths = await invoke<string[]>("pick_files");
          if (!paths.length) return;
          const { images, other } = partitionPaths(paths);
          if (images.length) await addImagePaths(images);
          if (other.length) {
            promptText = appendPathsToPrompt(promptText, other);
            push(
              "system",
              other.length === 1
                ? `attached · ${other[0]}`
                : `attached · ${other.length} paths`,
            );
            focusPrompt();
          }
        } catch (err) {
          push("system", `file pick: ${errorMessage(err)}`);
        }
      })();
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const list = [...(input.files ?? [])];
      if (list.length) void addAttachedFiles(list);
    };
    input.click();
  }

  async function cancelTurn() {
    if (!selectedSessionId || !inTauriShell()) return;
    // Must work while send is in-flight — do not gate on `busy`.
    try {
      const status = await invoke<string>("cancel_session", {
        sessionId: selectedSessionId,
      });
      turnActive = false;
      push("system", `cancelled · ${status}`);
      await refreshStatus();
    } catch (err) {
      push("system", `cancel: ${errorMessage(err)}`);
    }
  }

  function selectSessionByIndex(index: number) {
    const session = sessions[index];
    if (!session) return;
    void activateSession(session.id);
  }

  async function activateSession(id: string) {
    selectedSessionId = id;
    pendingApproval = false;
    approvalSummary = "";
    approvalId = "";
    turnActive = false;
    messages = [];
    if (!connected || !inTauriShell()) return;
    await syncExecutionMode(id);
    await startLiveSubscribe(id);
  }

  function selectSession(id: string) {
    void activateSession(id);
  }

  async function handleAttachAction(id: AttachActionId) {
    if (id === "files") {
      pickAttachedFiles();
      return;
    }
    if (id === "workspace") {
      await pickWorkspaceFolder();
      return;
    }
    if (id === "new_chat") {
      await createSession();
      return;
    }
    if (id === "mcp") {
      // AttachMenu opens MCP list via list_mcp_servers — no stub here.
      return;
    }
    if (id === "model") {
      push("system", "Model: Auto (daemon default)");
    }
  }

  function handleMcpSelect(id: string) {
    const mention = `MCP: ${id}`;
    const trimmed = promptText.trimEnd();
    promptText = trimmed ? `${trimmed}\n${mention}` : mention;
    push("system", `MCP mention · ${id}`);
    focusPrompt();
  }

  async function handleDroppedPaths(paths: string[]) {
    if (!paths.length) return;
    let infos: DroppedPathInfo[];
    try {
      infos = await invoke<DroppedPathInfo[]>("classify_paths", { paths });
    } catch (err) {
      // Fallback when not in Tauri / classify missing — treat as files.
      infos = paths.map((path) => ({ path, is_dir: false }));
      push("system", `drop classify: ${errorMessage(err)}`);
    }
    const disp = dispositionForDrop(infos);
    if (disp.kind === "empty") return;
    if (disp.kind === "workspace") {
      workspaceRoot = disp.path;
      push("system", `workspace · ${disp.path}`);
      if (connected) {
        await createSession();
      }
      return;
    }
    const { images, other } = partitionPaths(disp.paths);
    if (images.length) await addImagePaths(images);
    if (other.length) {
      promptText = appendPathsToPrompt(promptText, other);
      push(
        "system",
        other.length === 1
          ? `attached · ${other[0]}`
          : `attached · ${other.length} paths`,
      );
    }
    focusPrompt();
  }

  $effect(() => {
    try {
      localStorage.setItem(WORKSPACE_KEY, workspaceRoot);
    } catch {
      /* ignore */
    }
  });

  function closeOverlays(): boolean {
    if (attachOpen) {
      attachOpen = false;
      return true;
    }
    if (modeOpen) {
      modeOpen = false;
      return true;
    }
    if (showPrefs) {
      showPrefs = false;
      return true;
    }
    if (showSetup) {
      showSetup = false;
      return true;
    }
    return false;
  }

  function onKeydown(event: KeyboardEvent) {
    suppressBrowserChrome(event);

    if (event.key === "Escape") {
      if (closeOverlays()) {
        event.preventDefault();
        return;
      }
      if (turnActive) {
        event.preventDefault();
        void cancelTurn();
      }
      return;
    }

    // TUI: Ctrl+Shift+P cycles Prompt → Steer → FollowUp
    if (
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === "p" || event.key === "P")
    ) {
      event.preventDefault();
      promptIntent = cyclePromptIntent(promptIntent);
      push("system", `intent · ${promptIntent}`);
      return;
    }

    // TUI: Ctrl+T sets Steer
    if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      promptIntent = "steer";
      push("system", "intent · steer");
      return;
    }

    // Cursor: Keyboard Shortcuts ⌃⇧/
    if (
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === "/" || event.key === "?" || event.code === "Slash")
    ) {
      event.preventDefault();
      showPrefs = true;
      return;
    }

    // Stop turn: ⌘. / Ctrl+.
    if (isMod(event) && event.key === ".") {
      event.preventDefault();
      void cancelTurn();
      return;
    }

    if (!isMod(event)) return;

    const k = event.key.toLowerCase();
    const shift = event.shiftKey;

    if (shift && k === "t") {
      event.preventDefault();
      cycleTheme();
      return;
    }

    // Cursor Settings is ⇧⌘, — we accept both ⌘, and ⇧⌘,
    if (k === ",") {
      event.preventDefault();
      showPrefs = !showPrefs;
      return;
    }

    if (k === "b" && !shift) {
      event.preventDefault();
      toggleRail();
      return;
    }

    if (k === "k" && !shift) {
      event.preventDefault();
      focusPrompt();
      return;
    }

    // Cursor New Agent
    if (k === "n" && !shift) {
      event.preventDefault();
      void createSession();
      return;
    }

    // Cursor Open Folder
    if (k === "o" && !shift) {
      event.preventDefault();
      void pickWorkspaceFolder();
      return;
    }

    // Cursor Files
    if (k === "g" && !shift) {
      event.preventDefault();
      pickAttachedFiles();
      return;
    }

    if (k === "l" && !shift) {
      event.preventDefault();
      clearTranscript();
      return;
    }

    if (k === "enter") {
      event.preventDefault();
      void sendPrompt();
      return;
    }

    const idx = digitIndex(event);
    if (idx !== null && !shift) {
      event.preventDefault();
      selectSessionByIndex(idx);
    }
  }

  onMount(() => {
    const stored = readStoredPrefs();
    packId = stored.packId;
    appearance = stored.appearance;
    applyCurrentTheme();

    const stopWatch = watchSystemAppearance(() => {
      if (appearance === "system") applyCurrentTheme();
    });

    let stopDrag: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        stopDrag = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            dropActive = true;
            return;
          }
          if (payload.type === "leave") {
            dropActive = false;
            return;
          }
          if (payload.type === "drop") {
            dropActive = false;
            void handleDroppedPaths(payload.paths);
          }
        });
      } catch {
        /* browser / non-Tauri — HTML5 DnD on shell below */
      }
    })();

    void (async () => {
      try {
        eventsUnlisten = await listen<SessionEventsPayload>("harness://events", (event) => {
          onSessionEvents(event.payload);
        });
      } catch {
        /* browser preview */
      }
    })();

    const done = localStorage.getItem(SETUP_KEY);
    if (!done) {
      showSetup = true;
      void runProbe();
    } else {
      void runProbe().then((p) => {
        if (p?.reachable) {
          void connect();
        }
      });
    }

    return () => {
      stopWatch();
      stopDrag?.();
      eventsUnlisten?.();
      void stopLiveSubscribe();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<SetupWizard
  bind:open={showSetup}
  bind:step={setupStep}
  {probe}
  {busy}
  onProbe={runProbe}
  onConnect={connect}
  onFinish={finishSetup}
  onSkip={skipSetup}
/>

<PreferencesPanel
  bind:open={showPrefs}
  bind:packId
  bind:appearance
  bind:themeId
  bind:workspaceRoot
  {socketPath}
  {connected}
  {busy}
  onOpenSecurity={openSecuritySettings}
  onResetSetup={resetSetupWizard}
  onConnect={connect}
  onDisconnect={disconnect}
/>

<div
  class="shell"
  class:drop-active={dropActive}
  ondragenter={(e) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("Files")) dropActive = true;
  }}
  ondragover={(e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }}
  ondragleave={(e) => {
    if (e.currentTarget === e.target) dropActive = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dropActive = false;
    // Browser-only fallback — Tauri uses onDragDropEvent with real paths.
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    void addAttachedFiles(files);
  }}
  role="application"
>
  {#if dropActive}
    <div class="drop-overlay" aria-hidden="true">
      <p class="drop-title">Drop into chat</p>
      <p class="drop-hint">Folder → workspace · files/images → attach to the message</p>
    </div>
  {/if}
  <SessionRail
    bind:open={railOpen}
    {sessions}
    bind:selectedSessionId
    {workspaceRoot}
    {busy}
    {connected}
    {daemonReachable}
    onCreateSession={() => void createSession()}
    onOpenWorkspace={() => void pickWorkspaceFolder()}
    onSelectSession={selectSession}
    onPrefs={() => (showPrefs = !showPrefs)}
    onConnect={() => void connect()}
    onStartDaemon={() => void startDaemon()}
  />

  <main class="stage">
    <AppTopbar
      {selectedSessionId}
      {themeId}
      {connected}
      {busy}
      {daemonReachable}
      {socketPath}
      onToggleAppearance={toggleAppearance}
      onConnect={() => void connect()}
      onDisconnect={() => void disconnect()}
      onStartDaemon={() => void startDaemon()}
    />

    <Transcript
      {messages}
      {connected}
      hasSession={!!selectedSessionId}
      bind:scrollEl={transcriptEl}
    />

    <Composer
      bind:promptText
      bind:approvalId
      bind:agentMode
      bind:promptIntent
      bind:attachments
      bind:attachOpen
      bind:modeOpen
      {workspaceRoot}
      {approvalSummary}
      {pendingApproval}
      {busy}
      {turnActive}
      {connected}
      {selectedSessionId}
      dropActive={dropActive}
      bind:promptEl
      onSend={() => void sendPrompt()}
      onCancel={() => void cancelTurn()}
      onResolve={(accept) => void resolve(accept)}
      onAttachAction={handleAttachAction}
      onMcpSelect={handleMcpSelect}
      onPasteImages={(files) => void addImageFiles(files)}
      onRemoveAttachment={removeAttachment}
      onModeChange={(id) => void changeAgentMode(id)}
    />
  </main>
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: grid;
    place-content: center;
    gap: var(--space-2);
    pointer-events: none;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 2px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
    margin: var(--space-3);
    border-radius: var(--radius-xl);
  }

  .drop-title {
    margin: 0;
    text-align: center;
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .drop-hint {
    margin: 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  :global(.shell.drop-active) {
    outline: none;
  }
</style>
