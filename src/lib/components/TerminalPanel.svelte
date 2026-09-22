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
    next.onData((data) => {
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
      errorText = "PTY needs Tauri shell + live impetusd";
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
        args: ["-l"],
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
      ptyId = null;
    } catch (err) {
      errorText = errorMessage(err);
    } finally {
      busy = false;
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

  $effect(() => {
    if (open) {
      queueMicrotask(() => {
        if (disposed) return;
        ensureTerm();
        void fitAndResize();
      });
    }
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
          title="Start daemon-owned zsh PTY"
          onclick={() => void startShell()}
        >
          <Icon name="terminal" size={14} />
          Start
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || ptyId === null}
          title="Detach PTY (daemon keeps process)"
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
