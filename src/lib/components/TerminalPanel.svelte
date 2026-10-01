<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { Button, Icon } from "$lib/components/ui";
  import "@xterm/xterm/css/xterm.css";
  import "$lib/components/shell.css";

  type PtySessionDto = {
    pty_id: number;
    owner_session_id: string;
    state: string;
    command: string;
    cols: number;
    rows: number;
    args?: string[];
    working_dir?: string | null;
    created_at_unix_ms?: number | null;
    origin?: string | null;
  };

  type PtyOutputDto = {
    pty_id: number;
    data: number[];
    dropped_total: number;
    eof: boolean;
  };

  let {
    open = $bindable(false),
    sessionId = "",
    workspaceRoot = "",
    connected = false,
  }: {
    open?: boolean;
    sessionId?: string;
    workspaceRoot?: string;
    connected?: boolean;
  } = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let statusText = $state("idle");
  let errorText = $state("");
  let busy = $state(false);
  let ptyId = $state<number | null>(null);
  /** Last detached pty_id for this session — presentation memory. */
  let lastDetachedPtyId = $state<number | null>(null);

  let attachOpen = $state(false);
  let attachBusy = $state(false);
  let attachRows = $state<PtySessionDto[]>([]);
  let attachError = $state("");

  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function errorMessage(err: unknown): string {
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  function ptyRowLabel(row: PtySessionDto): string {
    const cmd = row.command.split("/").pop() || row.command;
    const cwd = row.working_dir
      ? ` · ${row.working_dir.split("/").slice(-2).join("/")}`
      : "";
    const origin = row.origin ? ` · ${row.origin}` : "";
    return `#${row.pty_id} · ${row.state} · ${cmd}${cwd}${origin}`;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function disposeTerm() {
    stopPoll();
    resizeObserver?.disconnect();
    resizeObserver = null;
    term?.dispose();
    term = null;
    fit = null;
  }

  function ensureTerm() {
    if (!hostEl || term) return;
    const next = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "transparent",
        foreground: "var(--text, #e4e4e7)",
        cursor: "var(--accent, #a1a1aa)",
      },
    });
    const addon = new FitAddon();
    next.loadAddon(addon);
    next.open(hostEl);
    addon.fit();
    next.onData((data: string) => {
      void sendInput(data);
    });
    term = next;
    fit = addon;
    resizeObserver = new ResizeObserver(() => {
      void fitAndResize();
    });
    resizeObserver.observe(hostEl);
  }

  async function fitAndResize() {
    if (!term || !fit || !ptyId || !sessionId || !inTauriShell()) {
      fit?.fit();
      return;
    }
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;
    if (cols < 1 || rows < 1) return;
    try {
      await invoke("pty_resize", {
        sessionId,
        ptyId,
        cols,
        rows,
      });
    } catch {
      // Resize is best-effort while daemon drains.
    }
  }

  async function sendInput(data: string) {
    if (!ptyId || !sessionId || !inTauriShell() || !data) return;
    const bytes = Array.from(new TextEncoder().encode(data));
    try {
      await invoke("pty_input", { sessionId, ptyId, data: bytes });
    } catch (err) {
      errorText = errorMessage(err);
    }
  }

  async function drainOnce() {
    if (!ptyId || !sessionId || !inTauriShell() || !term) return;
    try {
      const chunk = await invoke<PtyOutputDto>("pty_output", {
        sessionId,
        ptyId,
        maxBytes: 65536,
      });
      if (chunk.data.length) {
        term.write(Uint8Array.from(chunk.data));
      }
      if (chunk.dropped_total > 0) {
        statusText = `pty ${ptyId} · dropped ${chunk.dropped_total}`;
      }
      if (chunk.eof) {
        stopPoll();
        statusText = `pty ${ptyId} · eof`;
      }
    } catch (err) {
      stopPoll();
      errorText = errorMessage(err);
      statusText = "poll error";
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      void drainOnce();
    }, 50);
  }

  async function startShell() {
    if (!inTauriShell()) {
      errorText = "PTY needs Tauri shell + live Runtime";
      return;
    }
    if (!connected || !sessionId) {
      errorText = "Connect and select a session first";
      return;
    }
    busy = true;
    errorText = "";
    try {
      ensureTerm();
      fit?.fit();
      const cols = term?.cols ?? 80;
      const rows = term?.rows ?? 24;
      const view = await invoke<PtySessionDto>("pty_start", {
        sessionId,
        command: "/bin/zsh",
        // Non-login argv — daemon refuses `-l` / `--login` (password-prompt surface).
        args: [],
        workingDir: workspaceRoot.trim() || null,
        cols,
        rows,
      });
      ptyId = view.pty_id;
      statusText = `pty ${view.pty_id} · ${view.state} · owner ${view.owner_session_id.slice(0, 8)}`;
      term?.reset();
      term?.focus();
      startPoll();
      await drainOnce();
    } catch (err) {
      errorText = errorMessage(err);
      statusText = "start failed";
    } finally {
      busy = false;
    }
  }

  async function detachPty() {
    if (!ptyId || !sessionId || !inTauriShell()) return;
    busy = true;
    errorText = "";
    try {
      await invoke("pty_detach", { sessionId, ptyId });
      stopPoll();
      statusText = `pty ${ptyId} · detached`;
      lastDetachedPtyId = ptyId;
      ptyId = null;
    } catch (err) {
      errorText = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function attachPtyId(targetId: number) {
    if (!sessionId || !inTauriShell()) return;
    busy = true;
    errorText = "";
    attachOpen = false;
    try {
      ensureTerm();
      fit?.fit();
      const view = await invoke<PtySessionDto>("pty_attach", {
        sessionId,
        ptyId: targetId,
      });
      ptyId = view.pty_id;
      if (lastDetachedPtyId === targetId) {
        lastDetachedPtyId = null;
      }
      statusText = `pty ${view.pty_id} · ${view.state} · attached`;
      term?.focus();
      startPoll();
      await drainOnce();
      await fitAndResize();
    } catch (err) {
      errorText = errorMessage(err);
      statusText = "attach failed";
    } finally {
      busy = false;
    }
  }

  async function reattachPty() {
    if (lastDetachedPtyId == null) return;
    await attachPtyId(lastDetachedPtyId);
  }

  async function refreshAttachList() {
    if (!sessionId || !inTauriShell() || !connected) {
      attachRows = [];
      attachError = "Connect and select a session first";
      return;
    }
    attachBusy = true;
    attachError = "";
    try {
      const rows = await invoke<PtySessionDto[]>("pty_list", {
        sessionId,
        liveOnly: true,
      });
      // Omit the PTY already bound to this panel.
      attachRows = rows.filter((row) => row.pty_id !== ptyId);
      if (attachRows.length === 0) {
        attachError = "No other live PTYs for this session";
      }
    } catch (err) {
      attachRows = [];
      attachError = errorMessage(err);
    } finally {
      attachBusy = false;
    }
  }

  async function toggleAttachPicker() {
    if (busy || !connected || !sessionId || ptyId !== null) return;
    if (attachOpen) {
      attachOpen = false;
      return;
    }
    attachOpen = true;
    await refreshAttachList();
  }

  function onAttachDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".pty-attach")) {
      attachOpen = false;
    }
  }

  async function terminatePty() {
    if (!ptyId || !sessionId || !inTauriShell()) return;
    busy = true;
    errorText = "";
    try {
      await invoke("pty_terminate", { sessionId, ptyId });
      stopPoll();
      statusText = `pty ${ptyId} · terminated`;
      ptyId = null;
    } catch (err) {
      errorText = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  let prevSessionId = $state<string | null>(null);

  $effect(() => {
    const sid = sessionId;
    if (prevSessionId !== null && prevSessionId !== sid) {
      stopPoll();
      ptyId = null;
      lastDetachedPtyId = null;
      attachOpen = false;
      attachRows = [];
      statusText = "idle";
      errorText = "";
    }
    prevSessionId = sid;
  });

  $effect(() => {
    if (open) {
      queueMicrotask(() => {
        if (disposed) return;
        ensureTerm();
        void fitAndResize();
      });
    }
  });

  $effect(() => {
    if (!attachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") attachOpen = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onAttachDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onAttachDocClick);
    };
  });

  onMount(() => {
    disposed = false;
    return () => {
      disposed = true;
      disposeTerm();
    };
  });

  onDestroy(() => {
    disposed = true;
    disposeTerm();
  });
</script>

{#if open}
  <section class="pty-panel shell-acrylic" aria-label="Terminal">
    <div class="pty-toolbar">
      <div class="pty-meta">
        <span class="pty-title">Terminal</span>
        <span class="pty-status mono">{statusText}</span>
      </div>
      <div class="pty-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !connected || !sessionId || ptyId !== null}
          title="Start Runtime-owned zsh PTY"
          aria-label="Start Runtime-owned zsh PTY"
          onclick={() => void startShell()}
        >
          <Icon name="terminal" size={14} />
          Start
        </Button>
        <div class="pty-attach">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !connected || !sessionId || ptyId !== null}
            title="Attach a live PTY from Runtime inventory"
            aria-label="Attach PTY"
            aria-expanded={attachOpen}
            aria-haspopup="listbox"
            onclick={() => void toggleAttachPicker()}
          >
            Attach
            <Icon name="chevron-down" size={12} />
          </Button>
          {#if attachOpen}
            <div class="pty-attach-menu" role="listbox" aria-label="Live PTYs">
              {#if attachBusy}
                <p class="pty-attach-empty">Loading…</p>
              {:else if attachError && attachRows.length === 0}
                <p class="pty-attach-empty">{attachError}</p>
              {:else}
                {#each attachRows as row (row.pty_id)}
                  <button
                    type="button"
                    class="pty-attach-row"
                    class:hint={lastDetachedPtyId === row.pty_id}
                    role="option"
                    aria-selected={false}
                    title={ptyRowLabel(row)}
                    onclick={() => void attachPtyId(row.pty_id)}
                  >
                    <span class="pty-attach-id mono">#{row.pty_id}</span>
                    <span class="pty-attach-copy">
                      <span class="pty-attach-state">{row.state}</span>
                      <span class="pty-attach-cmd mono"
                        >{row.command.split("/").pop() || row.command}</span
                      >
                    </span>
                  </button>
                {/each}
              {/if}
              {#if lastDetachedPtyId != null && !attachRows.some((r) => r.pty_id === lastDetachedPtyId)}
                <button
                  type="button"
                  class="pty-attach-row hint"
                  role="option"
                  aria-selected={false}
                  title={`Reattach last detached pty ${lastDetachedPtyId}`}
                  onclick={() => void reattachPty()}
                >
                  <span class="pty-attach-id mono">#{lastDetachedPtyId}</span>
                  <span class="pty-attach-copy">
                    <span class="pty-attach-state">last detached</span>
                    <span class="pty-attach-cmd mono">reattach</span>
                  </span>
                </button>
              {/if}
              <button
                type="button"
                class="pty-attach-refresh"
                disabled={attachBusy}
                onclick={() => void refreshAttachList()}
              >
                Refresh
              </button>
            </div>
          {/if}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={
            busy ||
            !connected ||
            !sessionId ||
            ptyId !== null ||
            lastDetachedPtyId == null
          }
          title={lastDetachedPtyId != null
            ? `Reattach pty ${lastDetachedPtyId}`
            : "No detached PTY in this panel"}
          onclick={() => void reattachPty()}
        >
          Reattach
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || ptyId === null}
          title="Detach PTY (Runtime keeps process)"
          onclick={() => void detachPty()}
        >
          Detach
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || ptyId === null}
          title="Terminate PTY"
          onclick={() => void terminatePty()}
        >
          Kill
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Hide terminal"
          aria-label="Hide terminal"
          onclick={() => (open = false)}
        >
          <Icon name="x" size={14} />
        </Button>
      </div>
    </div>
    {#if errorText}
      <p class="pty-error" role="alert">{errorText}</p>
    {/if}
    <div class="pty-host" bind:this={hostEl}></div>
  </section>
{/if}

<style>
  .pty-panel {
    display: flex;
    flex-direction: column;
    min-height: 14rem;
    max-height: 40vh;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 92%, transparent);
  }

  .pty-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .pty-meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    min-width: 0;
  }

  .pty-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .pty-status {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .pty-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .pty-attach {
    position: relative;
  }

  .pty-attach-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 40;
    min-width: 16rem;
    max-width: 22rem;
    max-height: 14rem;
    overflow-y: auto;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--panel);
    box-shadow: var(--shadow-md, 0 8px 24px rgb(0 0 0 / 0.25));
  }

  .pty-attach-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    width: 100%;
    margin: 0;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pty-attach-row:hover {
    background: var(--elevated);
  }

  .pty-attach-row.hint {
    outline: 1px solid color-mix(in srgb, var(--accent, #a1a1aa) 35%, transparent);
  }

  .pty-attach-id {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .pty-attach-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .pty-attach-state {
    font-size: var(--text-xs);
    color: var(--text);
  }

  .pty-attach-cmd {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .pty-attach-empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .pty-attach-refresh {
    display: block;
    width: 100%;
    margin-top: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .pty-attach-refresh:hover:not(:disabled) {
    color: var(--text);
  }

  .pty-attach-refresh:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .pty-error {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    color: var(--danger, #f87171);
  }

  .pty-host {
    flex: 1;
    min-height: 10rem;
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
  }

  .pty-host :global(.xterm) {
    height: 100%;
  }

  .pty-host :global(.xterm-viewport) {
    overflow-y: auto !important;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
</style>
