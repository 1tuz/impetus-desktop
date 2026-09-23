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
    attachmentFromFilePath,
    attachmentFromPath,
    ensureImageFile,
    extFromMime,
    isImageMime,
    isImagePath,
    mergeAttachmentsIntoPrompt,
    partitionPaths,
    revokeAttachments,
    shouldUploadArtifact,
    toPreviewableImage,
    userMsgWithAttachments,
    type ComposerAttachment,
  } from "$lib/composerAttachments";
  import { type HarnessEvent, type Msg, type Role } from "$lib/harnessEventReducer";
  import { createSessionTranscript } from "$lib/session.svelte";
  import AppTopbar from "$lib/components/AppTopbar.svelte";
  import Composer from "$lib/components/Composer.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import SessionRail from "$lib/components/SessionRail.svelte";
  import SetupWizard from "$lib/components/SetupWizard.svelte";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import Transcript from "$lib/components/Transcript.svelte";
  import "$lib/components/shell.css";

  type ArtifactRefDto = { id: string; byte_count: number };

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
    provider_kind: string;
    failure_kind?: string;
  };

  type RuntimePhase =
    | "starting"
    | "connected"
    | "reconnecting"
    | "offline"
    | "incompatible"
    | "failed";

  type ApprovalDetailDto = {
    approval_id: string;
    reason: string;
    state: string;
    diff_preview: string | null;
    affected_files: string[];
    estimated_scope: string | null;
  };

  type SessionEventsPayload = {
    session_id: string;
    events: HarnessEvent[];
  };

  const SETUP_KEY = "impetus.desktop.setup.v1";
  const RAIL_KEY = "impetus.desktop.rail";
  const WORKSPACE_KEY = "impetus.desktop.workspace";
  const PROVIDER_PROFILE_KEY = "impetus.desktop.provider_profile";
  const ACP_PROFILE_KEY = "impetus.desktop.acp_profile";

  /** Vite browser has no Tauri IPC — invoke() throws TypeError. */
  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  let connected = $state(false);
  let runtimePhase = $state<RuntimePhase>("offline");
  let socketPath = $state("");
  let sessions = $state<SessionDto[]>([]);
  let selectedSessionId = $state("");
  let workspaceRoot = $state(
    typeof localStorage !== "undefined" ? localStorage.getItem(WORKSPACE_KEY) ?? "" : "",
  );
  let promptText = $state("");
  let busy = $state(false);
  const session = createSessionTranscript();
  let providerKind = $state("unknown");
  let ipcVersion = $state<number | null>(null);
  let ipcWarn = $state<string | null>(null);
  let sessionModelSummary = $state("");
  let providerProfilePath = $state(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(PROVIDER_PROFILE_KEY) ?? ""
      : "",
  );
  let acpProfilePath = $state(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(ACP_PROFILE_KEY) ?? ""
      : "",
  );
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
  let dropActive = $state(false);
  let attachments = $state<ComposerAttachment[]>([]);

  let packId = $state(DEFAULT_PACK_ID);
  let appearance = $state<AppearancePref>(DEFAULT_APPEARANCE);
  let themeId = $state(DEFAULT_THEME_ID);
  let showPrefs = $state(false);
  let terminalOpen = $state(true);
  let rightPanelOpen = $state(true);
  let rightPanelTab = $state<"files" | "review" | "agents">("files");


  function applyCurrentTheme() {
    const next = applyThemePrefs(packId, appearance);
    packId = next.packId;
    appearance = next.appearance;
    themeId = next.themeId;
  }

  function scrollTranscript() {
    queueMicrotask(() => {
      if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
    });
  }

  function push(
    role: Role,
    text: string,
    runId?: string,
    msgAttachments?: Msg["attachments"],
  ) {
    session.push(role, text, {
      ...(runId !== undefined ? { runId } : {}),
      ...(msgAttachments !== undefined ? { attachments: msgAttachments } : {}),
    });
    scrollTranscript();
  }

  function errorMessage(err: unknown): string {
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  async function startLiveSubscribe(sessionId: string, afterSeq: number) {
    if (!inTauriShell() || !sessionId) return;
    try {
      await invoke("subscribe_session_events", {
        sessionId,
        afterSeq,
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
      if (isAgentModeId(mode)) session.agentMode = mode;
    } catch {
      /* fresh session / older daemon — keep UI default */
    }
  }

  async function changeAgentMode(id: AgentModeId) {
    session.agentMode = id;
    if (!inTauriShell() || !connected || !selectedSessionId) return;
    try {
      const confirmed = await invoke<string>("set_execution_mode", {
        sessionId: selectedSessionId,
        mode: id,
      });
      if (isAgentModeId(confirmed)) session.agentMode = confirmed;
    } catch (err) {
      push("system", `Could not change mode: ${errorMessage(err)}`);
    }
  }

  async function fetchApprovalDetail(id: string, summary: string) {
    session.approvalId = id;
    session.approvalSummary = summary;
    session.pendingApproval = true;
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
      if (bits.length) session.approvalSummary = bits.join(" · ");
      if (detail.diff_preview) {
        push("tool", detail.diff_preview.slice(0, 800));
      }
    } catch {
      /* detail optional — id already surfaced */
    }
  }

  function handleHarnessEvent(event: HarnessEvent) {
    const effects = session.applyEvent(event, selectedSessionId);
    for (const effect of effects) {
      if (effect.kind === "approval") {
        void fetchApprovalDetail(effect.id, effect.summary);
      }
    }
    scrollTranscript();
  }

  function onSessionEvents(payload: SessionEventsPayload) {
    if (payload.session_id && selectedSessionId && payload.session_id !== selectedSessionId) {
      return;
    }
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
        provider_kind: "unknown",
      };
      socketPath = probe.socket_path;
      return probe;
    }
    probe = await invoke<DaemonProbe>("probe_daemon");
    socketPath = probe.socket_path;
    if (probe.provider_kind) providerKind = probe.provider_kind;
    return probe;
  }

  async function connectInner(): Promise<boolean> {
    ipcVersion = null;
    try {
      const hello = await invoke<HelloInfo>("harness_hello");
      connected = true;
      socketPath = hello.socket_path;
      ipcVersion = hello.version;
      ipcWarn = null;
      const capsLower = hello.capabilities.map((c) => c.toLowerCase());
      if (capsLower.some((c) => c.includes("incompatible"))) {
        ipcWarn = "Incompatible";
        runtimePhase = "incompatible";
        connected = false;
        return false;
      }
      runtimePhase = "connected";
      // Status lives in topbar (Connected · v14 · mock). Do not dump socket/caps into chat.
      await refreshSessions();
      return true;
    } catch (err) {
      const msg = errorMessage(err);
      if (/incompatible|version/i.test(msg)) {
        ipcWarn = "Incompatible";
        runtimePhase = "incompatible";
      }
      throw err;
    }
  }

  async function connect(): Promise<boolean> {
    if (!inTauriShell()) return false;
    let ok = false;
    await withBusy("connect", async () => {
      ok = await connectInner();
    });
    return ok;
  }

  function profileArgs(): { provider: string; acp: string } {
    const provider =
      providerProfilePath.trim() ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem(PROVIDER_PROFILE_KEY) ?? ""
        : "");
    const acp =
      acpProfilePath.trim() ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem(ACP_PROFILE_KEY) ?? ""
        : "");
    return { provider, acp };
  }

  /** Prefer ensure_runtime; fall back to start_daemon if command not registered yet. */
  async function invokeEnsureOrStart(
    provider: string,
    acp: string,
  ): Promise<DaemonProbe> {
    const args = {
      providerProfile: provider || null,
      acpProfile: acp || null,
    };
    try {
      return await invoke<DaemonProbe>("ensure_runtime", args);
    } catch {
      // Coordinator lands ensure_runtime; older builds only have start_daemon.
      return await invoke<DaemonProbe>("start_daemon", args);
    }
  }

  async function ensureRuntimeThenConnect(
    opts: { reconnecting?: boolean } = {},
  ): Promise<boolean> {
    if (!inTauriShell()) {
      runtimePhase = "offline";
      push("system", "Web preview — Runtime needs Impetus Desktop.app");
      return false;
    }
    const { provider, acp } = profileArgs();
    if (provider && acp) {
      runtimePhase = "failed";
      push(
        "system",
        "config: set only one of provider profile or ACP profile in Preferences",
      );
      return false;
    }

    runtimePhase = opts.reconnecting ? "reconnecting" : "starting";
    let ok = false;
    await withBusy("runtime", async () => {
      let p = await runProbe();
      if (p.failure_kind === "incompatible") {
        runtimePhase = "incompatible";
        ipcWarn = "Incompatible";
        push("system", p.detail || "Runtime protocol incompatible");
        return;
      }
      if (!p.reachable) {
        try {
          p = await invokeEnsureOrStart(provider, acp);
          probe = p;
          socketPath = p.socket_path;
          providerKind = p.provider_kind || "unknown";
          // Keep ensure detail out of chat — topbar shows Connected / mock badge.
        } catch (err) {
          const msg = errorMessage(err);
          if (/incompatible|version/i.test(msg)) {
            runtimePhase = "incompatible";
            ipcWarn = "Incompatible";
          } else {
            runtimePhase = "failed";
          }
          push("system", `runtime: ${msg}`);
          return;
        }
      }
      if (p.failure_kind === "incompatible") {
        runtimePhase = "incompatible";
        ipcWarn = "Incompatible";
        push("system", p.detail || "Runtime protocol incompatible");
        return;
      }
      if (!p.reachable) {
        runtimePhase = "failed";
        push("system", "Runtime unreachable after ensure");
        return;
      }
      try {
        ok = await connectInner();
        if (!ok && runtimePhase !== "incompatible") {
          runtimePhase = "failed";
        }
      } catch (err) {
        if (runtimePhase !== "incompatible") {
          runtimePhase = "failed";
        }
        throw err;
      }
    });
    if (!ok && runtimePhase === "starting") {
      runtimePhase = "offline";
    }
    if (!ok && runtimePhase === "reconnecting") {
      runtimePhase = "offline";
    }
    return ok;
  }

  async function reconnect() {
    const resumeId = selectedSessionId;
    const resumeSeq = session.lastSeq;
    if (connected) {
      try {
        await stopLiveSubscribe();
        await invoke("disconnect");
      } catch {
        /* ignore */
      }
      connected = false;
    }
    const ok = await ensureRuntimeThenConnect({ reconnecting: true });
    if (!ok || !resumeId || !inTauriShell()) return;
    // Keep transcript; resume live cursor from lastSeq (do not wipe via activateSession).
    selectedSessionId = resumeId;
    await syncExecutionMode(resumeId);
    await startLiveSubscribe(resumeId, resumeSeq);
    try {
      await refreshSessions();
    } catch {
      /* ignore */
    }
  }

  /** Recovery alias — Prefs Advanced "Restart Runtime". */
  async function restartRuntime() {
    if (connected) {
      try {
        await stopLiveSubscribe();
        await invoke("disconnect");
      } catch {
        /* ignore */
      }
      connected = false;
      sessions = [];
      selectedSessionId = "";
      sessionModelSummary = "";
      session.pendingApproval = false;
      session.approvalSummary = "";
      session.turnActive = false;
      ipcVersion = null;
      ipcWarn = null;
    }
    await ensureRuntimeThenConnect();
  }

  async function disconnect() {
    if (!inTauriShell()) return;
    await withBusy("disconnect", async () => {
      await stopLiveSubscribe();
      await invoke("disconnect");
      connected = false;
      runtimePhase = "offline";
      sessions = [];
      selectedSessionId = "";
      sessionModelSummary = "";
      session.pendingApproval = false;
      session.approvalSummary = "";
      session.turnActive = false;
      providerKind = "unknown";
      ipcVersion = null;
      ipcWarn = null;
    });
  }

  const daemonReachable = $derived(probe?.reachable ?? false);

  async function refreshSessions() {
    if (!inTauriShell()) return;
    const list = await invoke<SessionDto[]>("list_sessions");
    sessions = list;
    if (selectedSessionId && !list.some((s) => s.id === selectedSessionId)) {
      selectedSessionId = "";
      session.pendingApproval = false;
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
      const ok = await ensureRuntimeThenConnect();
      if (!ok) {
        push(
          "system",
          "Runtime offline — try Reconnect in the topbar, or Preferences → Restart Runtime",
        );
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
          push("system", "No folder selected");
          return;
        }
        workspaceRoot = picked;
        root = picked;
      }
      const id = await invoke<string>("create_session", { workspaceRoot: root });
      selectedSessionId = id;
      session.reset();
      session.pendingApproval = false;
      session.approvalSummary = "";
      const gen = session.bumpSubscribeGen();
      await refreshSessions();
      if (gen !== session.subscribeGen) return;
      await syncExecutionMode(id);
      if (gen !== session.subscribeGen) return;
      await startLiveSubscribe(id, 0);
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


  function attLabel(atts: ComposerAttachment[]): string {
    return atts.map((a) => a.path ?? a.name).join("\n");
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
      const ok = await ensureRuntimeThenConnect();
      if (!ok) {
        push(
          "system",
          "Runtime offline — try Reconnect, or Preferences → Restart Runtime",
        );
        return;
      }
    }

    if (!selectedSessionId) {
      await createSession({ pickIfMissing: true });
      if (!selectedSessionId) return;
    }

    // Prefer path-based upload_artifact for large/file chips; else path-in-prompt.
    // Execution mode is daemon-owned (set_execution_mode); no prompt banners.
    const toUpload = attachments.filter(
      (a) => a.path && shouldUploadArtifact(a),
    );
    const rest = attachments.filter((a) => !toUpload.includes(a));
    const body = stripModePrefix(mergeAttachmentsIntoPrompt(raw, rest));
    const intent = promptIntent;
    const savedPrompt = promptText;
    const savedAttachments = attachments;
    const display = body || (toUpload.length ? `(artifact ×${toUpload.length})` : "");
    const sent = userMsgWithAttachments(display, savedAttachments);
    push("user", sent.text, undefined, sent.attachments);
    promptText = "";
    attachments = [];
    let sendOk = false;
    await withBusy("send", async () => {
      let uploaded: ArtifactRefDto[] = [];
      for (const att of toUpload) {
        if (!att.path) continue;
        uploaded.push(
          await invoke<ArtifactRefDto>("upload_artifact", {
            sessionId: selectedSessionId,
            path: att.path,
            contentType: att.mime || null,
            workspaceRoot: workspaceRoot.trim() || null,
          }),
        );
      }
      // Core SendPrompt takes one artifact; extras named in text until multi-ref lands.
      const artifact = uploaded.length ? uploaded[uploaded.length - 1]! : null;
      const extraNote =
        uploaded.length > 1
          ? `\n[artifacts ×${uploaded.length}: ${uploaded.map((a) => a.id.slice(0, 8)).join(", ")}]`
          : "";
      await invoke<string>("send_prompt", {
        sessionId: selectedSessionId,
        text: (body || (artifact ? attLabel(toUpload) : "")) + extraNote,
        intent,
        artifact,
      });
      sendOk = true;
      // Streaming arrives via harness://events — do not fake status-as-assistant.
      if (intent === "prompt" || intent === "steer" || intent === "follow_up") {
        session.turnActive = true;
      }
      await refreshStatus();
    });
    if (sendOk) {
      revokeAttachments(savedAttachments);
    } else {
      // Restore composer; drop optimistic user bubble on failure.
      promptText = savedPrompt;
      attachments = savedAttachments;
      const last = session.messages[session.messages.length - 1];
      if (last && last.role === "user" && last.text === display) {
        session.messages = session.messages.slice(0, -1);
      }
    }
  }

  async function refreshStatus() {
    if (!inTauriShell()) return;
    await withBusy("status", async () => {
      const status = await invoke<StatusInfo>("get_status", {
        sessionId: selectedSessionId || null,
      });
      connected = status.connected;
      socketPath = status.socket_path || socketPath;
      if (status.connected) {
        if (runtimePhase !== "incompatible") runtimePhase = "connected";
      } else if (runtimePhase === "connected") {
        runtimePhase = "offline";
      }
      if (status.runtime_status) {
        session.pendingApproval = status.runtime_status.includes("AwaitingApproval");
      }
    });
  }

  async function resolve(accept: boolean) {
    if (!selectedSessionId || !session.approvalId.trim()) {
      push("system", "need session + approval id");
      return;
    }
    await withBusy("approval", async () => {
      await invoke("resolve_approval", {
        sessionId: selectedSessionId,
        approvalId: session.approvalId.trim(),
        accept,
      });
      push("tool", accept ? "approval accepted" : "approval denied");
      session.pendingApproval = false;
      session.approvalId = "";
      session.approvalSummary = "";
      await refreshStatus();
    });
  }

  function finishSetup() {
    localStorage.setItem(SETUP_KEY, "done");
    showSetup = false;
    if (!connected) void ensureRuntimeThenConnect();
  }

  function skipSetup() {
    localStorage.setItem(SETUP_KEY, "done");
    showSetup = false;
    void ensureRuntimeThenConnect();
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
    session.reset();
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
      const chips = other.map((f) =>
        attachmentFromFilePath(f.name, f.size, f.type || undefined),
      );
      attachments = [...attachments, ...chips];
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
            attachments = [
              ...attachments,
              ...other.map((p) => attachmentFromFilePath(p)),
            ];
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
      session.turnActive = false;
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
    const gen = session.bumpSubscribeGen();
    selectedSessionId = id;
    session.pendingApproval = false;
    session.approvalSummary = "";
    session.approvalId = "";
    session.reset();
    if (!connected || !inTauriShell()) return;
    await syncExecutionMode(id);
    if (gen !== session.subscribeGen) return;
    // Fresh session view: replay from 0 once, then cursor advances via lastSeq.
    await startLiveSubscribe(id, 0);
  }

  function selectSession(id: string) {
    if (!id) sessionModelSummary = "";
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
      // Model picker lives in Composer (Provider/Model/Reasoning) — not Attach.
      focusPrompt();
      return;
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
      attachments = [
        ...attachments,
        ...other.map((p) => attachmentFromFilePath(p)),
      ];
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
    if (terminalOpen) {
      terminalOpen = false;
      return true;
    }
    return false;
  }

  function onKeydown(event: KeyboardEvent) {
    suppressBrowserChrome(event);

    // ⌘J / Ctrl+` toggle bottom terminal dock (collapse keeps PTYs).
    if (
      (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "j") ||
      (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "`")
    ) {
      event.preventDefault();
      terminalOpen = !terminalOpen;
      return;
    }

    if (event.key === "Escape") {
      if (closeOverlays()) {
        event.preventDefault();
        return;
      }
      if (session.turnActive) {
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
      void ensureRuntimeThenConnect();
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
  onConnect={ensureRuntimeThenConnect}
  onFinish={finishSetup}
  onSkip={skipSetup}
/>

<PreferencesPanel
  bind:open={showPrefs}
  bind:packId
  bind:appearance
  bind:themeId
  bind:workspaceRoot
  bind:providerProfilePath
  bind:acpProfilePath
  {socketPath}
  {connected}
  {busy}
  {providerKind}
  onOpenSecurity={openSecuritySettings}
  onResetSetup={resetSetupWizard}
  onConnect={() => void ensureRuntimeThenConnect()}
  onDisconnect={disconnect}
  onRestartRuntime={() => void restartRuntime()}
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
  />

  <main class="stage">
    <AppTopbar
      {selectedSessionId}
      {themeId}
      {connected}
      {busy}
      {runtimePhase}
      {socketPath}
      {providerKind}
      {ipcVersion}
      {ipcWarn}
      {terminalOpen}
      {sessionModelSummary}
      onToggleAppearance={toggleAppearance}
      onDisconnect={() => void disconnect()}
      onReconnect={() => void reconnect()}
      onToggleTerminal={() => (terminalOpen = !terminalOpen)}
    />

    <div class="stage-row">
      <div class="stage-main">
    <Transcript
      messages={session.messages}
      {connected}
      {runtimePhase}
      hasSession={!!selectedSessionId}
      bind:scrollEl={transcriptEl}
    />

    <Composer
      bind:promptText
      bind:approvalId={session.approvalId}
      bind:agentMode={session.agentMode}
      bind:promptIntent
      bind:attachments
      bind:attachOpen
      bind:modeOpen
      {workspaceRoot}
      approvalSummary={session.approvalSummary}
      pendingApproval={session.pendingApproval}
      {busy}
      turnActive={session.turnActive}
      {connected}
      {runtimePhase}
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
      onModelChanged={(sel) => {
        const parts = [sel.provider_id, sel.model_id];
        if (sel.reasoning_effort) parts.push(sel.reasoning_effort);
        if (sel.service_tier) parts.push(sel.service_tier);
        sessionModelSummary = parts.filter(Boolean).join(" · ");
      }}
    />
      </div>
      <RightPanel
        bind:open={rightPanelOpen}
        bind:activeTab={rightPanelTab}
        sessionId={selectedSessionId}
        {workspaceRoot}
        {connected}
        {busy}
      />
    </div>

    <TerminalPanel
      bind:open={terminalOpen}
      sessionId={selectedSessionId}
      {workspaceRoot}
      {connected}
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
