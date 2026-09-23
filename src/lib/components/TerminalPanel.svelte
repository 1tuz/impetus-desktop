<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import TerminalTabBar from "$lib/components/TerminalTabBar.svelte";
  import { Button, EmptyState } from "$lib/components/ui";
  import {
    DOCK_HEIGHT_DEFAULT,
    MAX_TERMINAL_TABS,
    clampDockHeight,
    loadDockBlob,
    loadSessionBook,
    newTabId,
    nextSessionTitle,
    pickNeighborTabId,
    ptyStateLooksAlive,
    reorderTabIds,
    saveDockChrome,
    saveSessionBook,
    type SessionTerminalBook,
    type TerminalTabPersist,
  } from "$lib/terminalDockPrefs";
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

  type TerminalEnvDto = {
    default_shell: string;
    shells: string[];
    home_dir: string | null;
  };

  type TabRuntime = {
    id: string;
    ptyId: number;
    title: string;
    shellPath: string;
    cwdHint: string | null;
    createdAtMs: number;
    titleCustom: boolean;
    term: Terminal | null;
    fit: FitAddon | null;
    hostEl: HTMLDivElement | null;
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

  let heightPx = $state(DOCK_HEIGHT_DEFAULT);
  let errorText = $state("");
  let busy = $state(false);
  let menuOpen = $state(false);
  let tabOrder = $state<string[]>([]);
  let activeTabId = $state<string | null>(null);
  let runtimes = $state<Record<string, TabRuntime>>({});
  let env = $state<TerminalEnvDto | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let restoring = false;
  /** One auto-create attempt per dock-open (avoid error retry loops). */
  let autoCreateTried = false;
  /** Bumps on session clear/switch so in-flight restore/create can abort. */
  let lifecycleGen = 0;
  let resizeDrag = $state(false);
  let prefsReady = false;
  let boundSessionId: string | null = null;

  const tabBarItems = $derived(
    tabOrder
      .map((id) => {
        const rt = runtimes[id];
        return rt ? { id: rt.id, title: rt.title } : null;
      })
      .filter((t): t is { id: string; title: string } => t != null),
  );

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

  function persistBook(forSessionId: string | null = sessionId) {
    if (!forSessionId) return;
    // Never write another session's book after a mid-flight switch.
    if (forSessionId !== sessionId) return;
    const tabs: Record<string, TerminalTabPersist> = {};
    for (const id of tabOrder) {
      const rt = runtimes[id];
      if (!rt) continue;
      tabs[id] = {
        id: rt.id,
        ptyId: rt.ptyId,
        title: rt.title,
        shellPath: rt.shellPath,
        cwdHint: rt.cwdHint,
        createdAtMs: rt.createdAtMs,
      };
    }
    const book: SessionTerminalBook = {
      activeTabId:
        activeTabId && tabs[activeTabId] ? activeTabId : (tabOrder[0] ?? null),
      tabOrder: tabOrder.filter((id) => tabs[id]),
      tabs,
    };
    saveSessionBook(forSessionId, book);
  }

  function disposeRuntimeTerm(rt: TabRuntime) {
    rt.term?.dispose();
    rt.term = null;
    rt.fit = null;
  }

  function disposeAllTerms() {
    stopPoll();
    for (const rt of Object.values(runtimes)) {
      disposeRuntimeTerm(rt);
    }
  }

  function clearAllTabs() {
    lifecycleGen += 1;
    restoring = false;
    autoCreateTried = false;
    disposeAllTerms();
    runtimes = {};
    tabOrder = [];
    activeTabId = null;
  }

  function hostAction(node: HTMLDivElement, id: string) {
    const rt = runtimes[id];
    if (rt) {
      rt.hostEl = node;
      if (!rt.term) ensureTerm(rt);
      else if (rt.term.element?.parentElement !== node) {
        // Host remounted after collapse — reopen into new node.
        disposeRuntimeTerm(rt);
        ensureTerm(rt);
      }
      if (id === activeTabId) {
        void fitAndResize(rt);
        rt.term?.focus();
      }
    }
    return {
      destroy() {
        const cur = runtimes[id];
        if (cur && cur.hostEl === node) cur.hostEl = null;
      },
    };
  }

  function ensureTerm(rt: TabRuntime) {
    if (!rt.hostEl || rt.term) return;
    // Prefer Nerd Font when installed — glyphs for Starship/Powerlevel10k;
    // fall back to system monospace. No theme-specific hacks.
    const next = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
      // xterm-256color / truecolor + OSC title handled by xterm protocol.
      fontFamily:
        '"MesloLGS NF", "MesloLGS Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", Menlo, Monaco, "SF Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: {
        background: "transparent",
        foreground: "var(--text, #e4e4e7)",
        cursor: "var(--accent, #a1a1aa)",
        selectionBackground: "color-mix(in srgb, var(--accent, #a1a1aa) 35%, transparent)",
      },
    });
    const addon = new FitAddon();
    next.loadAddon(addon);
    next.open(rt.hostEl);
    addon.fit();
    next.onData((data: string) => {
      void sendInput(rt, data);
    });
    next.onTitleChange((title: string) => {
      const t = title.trim();
      if (!t) return;
      // OSC title from shell/prompt — keep as display name.
      rt.title = t;
      rt.titleCustom = true;
      runtimes = { ...runtimes };
      persistBook();
    });
    rt.term = next;
    rt.fit = addon;
  }

  async function fitAndResize(rt: TabRuntime | null = null) {
    const target =
      rt ?? (activeTabId ? (runtimes[activeTabId] ?? null) : null);
    if (!target?.term || !target.fit) return;
    target.fit.fit();
    if (!sessionId || !inTauriShell() || target.ptyId < 1) return;
    const cols = target.term.cols;
    const rows = target.term.rows;
    if (cols < 1 || rows < 1) return;
    try {
      await invoke("pty_resize", {
        sessionId,
        ptyId: target.ptyId,
        cols,
        rows,
      });
    } catch {
      // Resize is best-effort while daemon drains.
    }
  }

  async function sendInput(rt: TabRuntime, data: string) {
    if (!sessionId || !inTauriShell() || !data || rt.ptyId < 1) return;
    const bytes = Array.from(new TextEncoder().encode(data));
    try {
      await invoke("pty_input", {
        sessionId,
        ptyId: rt.ptyId,
        data: bytes,
      });
    } catch (err) {
      errorText = errorMessage(err);
    }
  }

  async function drainTab(rt: TabRuntime) {
    if (!sessionId || !inTauriShell() || !rt.term || rt.eof || rt.ptyId < 1) {
      return;
    }
    try {
      const chunk = await invoke<PtyOutputDto>("pty_output", {
        sessionId,
        ptyId: rt.ptyId,
        maxBytes: 65536,
      });
      if (chunk.data.length) {
        rt.term.write(Uint8Array.from(chunk.data));
      }
      if (chunk.eof) {
        rt.eof = true;
      }
    } catch (err) {
      // Transient IPC blip — keep polling; permanent death shows via status/reconnect.
      errorText = errorMessage(err);
    }
  }

  async function drainAll() {
    const list = Object.values(runtimes).filter((rt) => !rt.eof && rt.ptyId > 0);
    await Promise.all(list.map((rt) => drainTab(rt)));
  }

  function startPoll() {
    stopPoll();
    if (!open) return;
    pollTimer = setInterval(() => {
      void drainAll();
    }, 50);
  }

  async function loadEnv() {
    if (!inTauriShell()) {
      env = {
        default_shell: "/bin/zsh",
        shells: ["/bin/zsh"],
        home_dir: null,
      };
      return;
    }
    try {
      env = await invoke<TerminalEnvDto>("terminal_env");
    } catch {
      env = {
        default_shell: "/bin/zsh",
        shells: ["/bin/zsh"],
        home_dir: null,
      };
    }
  }

  function resolveShell(shellPath?: string): string {
    const path = shellPath?.trim();
    if (path) return path;
    return env?.default_shell?.trim() || "/bin/zsh";
  }

  function resolveCwd(kind: "workspace" | "home"): string | null {
    if (kind === "home") {
      return env?.home_dir?.trim() || null;
    }
    return workspaceRoot.trim() || null;
  }

  async function createTerminal(
    shellPath?: string,
    cwdKind: "workspace" | "home" = "workspace",
  ) {
    if (!inTauriShell()) {
      errorText = "PTY needs Tauri shell + live Runtime";
      return;
    }
    if (!connected || !sessionId) {
      errorText = "Connect and select a session first";
      return;
    }
    if (tabOrder.length >= MAX_TERMINAL_TABS) {
      errorText = `Soft cap ${MAX_TERMINAL_TABS} terminals`;
      return;
    }
    busy = true;
    errorText = "";
    const shell = resolveShell(shellPath);
    const cwd = resolveCwd(cwdKind);
    const id = newTabId();
    const createdAtMs = Date.now();
    const title = nextSessionTitle(
      Object.values(runtimes).map((r) => r.title),
    );
    try {
      // Placeholder runtime so host mounts before pty_start sizing.
      const placeholder: TabRuntime = {
        id,
        ptyId: 0,
        title,
        shellPath: shell,
        cwdHint: cwd,
        createdAtMs,
        titleCustom: false,
        term: null,
        fit: null,
        hostEl: null,
        eof: false,
      };
      runtimes = { ...runtimes, [id]: placeholder };
      tabOrder = [...tabOrder, id];
      activeTabId = id;
      // Wait a frame for host action to bind + open xterm.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const rt = runtimes[id];
      if (!rt) return;
      ensureTerm(rt);
      rt.fit?.fit();
      const cols = rt.term?.cols ?? 80;
      const rows = rt.term?.rows ?? 24;
      const startSid = sessionId;
      const startGen = lifecycleGen;
      const view = await invoke<PtySessionDto>("pty_start", {
        sessionId: startSid,
        command: shell,
        // Non-login argv — daemon refuses `-l` / `--login`.
        args: [],
        workingDir: cwd,
        cols,
        rows,
      });
      // Session switched or tab cleared while start was in flight — kill orphan.
      if (
        disposed ||
        startGen !== lifecycleGen ||
        startSid !== sessionId ||
        !runtimes[id]
      ) {
        try {
          await invoke("pty_terminate", {
            sessionId: startSid,
            ptyId: view.pty_id,
          });
        } catch {
          // Best-effort orphan cleanup.
        }
        return;
      }
      rt.ptyId = view.pty_id;
      runtimes = { ...runtimes };
      persistBook(startSid);
      rt.term?.focus();
      startPoll();
      await drainTab(rt);
      await fitAndResize(rt);
    } catch (err) {
      // Roll back failed tab.
      const failed = runtimes[id];
      if (failed) disposeRuntimeTerm(failed);
      const next = { ...runtimes };
      delete next[id];
      runtimes = next;
      tabOrder = tabOrder.filter((t) => t !== id);
      if (activeTabId === id) {
        activeTabId = tabOrder[tabOrder.length - 1] ?? null;
      }
      errorText = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function closeTab(id: string) {
    const rt = runtimes[id];
    if (!rt) return;
    busy = true;
    errorText = "";
    const neighbor =
      activeTabId === id ? pickNeighborTabId(tabOrder, id) : activeTabId;
    try {
      if (rt.ptyId > 0 && sessionId && inTauriShell()) {
        await invoke("pty_terminate", { sessionId, ptyId: rt.ptyId });
      }
    } catch (err) {
      errorText = errorMessage(err);
    } finally {
      disposeRuntimeTerm(rt);
      const next = { ...runtimes };
      delete next[id];
      runtimes = next;
      tabOrder = tabOrder.filter((t) => t !== id);
      if (activeTabId === id) {
        activeTabId = neighbor && runtimes[neighbor] ? neighbor : null;
      }
      persistBook();
      busy = false;
      if (activeTabId) {
        const active = runtimes[activeTabId];
        if (active) {
          void fitAndResize(active);
          active.term?.focus();
        }
      } else {
        // Last session closed — dock may stay open with empty state.
        // Next ⌘J (hide→show) or + creates a working terminal.
        autoCreateTried = false;
      }
    }
  }

  function selectTab(id: string) {
    if (!runtimes[id]) return;
    activeTabId = id;
    persistBook();
    voidMicrotaskFit(id);
  }

  function voidMicrotaskFit(id: string) {
    queueMicrotask(() => {
      const rt = runtimes[id];
      if (!rt) return;
      ensureTerm(rt);
      void fitAndResize(rt);
      rt.term?.focus();
    });
  }

  function reorderTabs(fromId: string, toId: string) {
    tabOrder = reorderTabIds(tabOrder, fromId, toId);
    persistBook();
  }

  async function restoreFromBook(sid: string) {
    if (!sid || !connected || !inTauriShell()) return;
    const gen = lifecycleGen;
    restoring = true;
    errorText = "";
    try {
      await loadEnv();
      if (disposed || gen !== lifecycleGen || sid !== sessionId) return;
      const book = loadSessionBook(sid);
      const nextOrder: string[] = [];
      const nextRuntimes: Record<string, TabRuntime> = {};
      for (const id of book.tabOrder.slice(0, MAX_TERMINAL_TABS)) {
        if (disposed || gen !== lifecycleGen || sid !== sessionId) return;
        const tab = book.tabs[id];
        if (!tab) continue;
        try {
          const status = await invoke<PtySessionDto>("pty_status", {
            sessionId: sid,
            ptyId: tab.ptyId,
          });
          if (!ptyStateLooksAlive(status.state)) continue;
          await invoke<PtySessionDto>("pty_attach", {
            sessionId: sid,
            ptyId: tab.ptyId,
          });
          nextRuntimes[id] = {
            id: tab.id,
            ptyId: tab.ptyId,
            title: tab.title || nextSessionTitle(
              Object.values(nextRuntimes).map((r) => r.title),
            ),
            shellPath: tab.shellPath,
            cwdHint: tab.cwdHint,
            createdAtMs: tab.createdAtMs,
            titleCustom: false,
            term: null,
            fit: null,
            hostEl: null,
            eof: false,
          };
          nextOrder.push(id);
        } catch {
          // Dead or unreachable — prune from book.
        }
      }
      if (disposed || gen !== lifecycleGen || sid !== sessionId) return;
      disposeAllTerms();
      runtimes = nextRuntimes;
      tabOrder = nextOrder;
      activeTabId =
        book.activeTabId && nextRuntimes[book.activeTabId]
          ? book.activeTabId
          : (nextOrder[0] ?? null);
      persistBook(sid);
      if (open && nextOrder.length) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (disposed || gen !== lifecycleGen || sid !== sessionId) return;
        for (const id of nextOrder) {
          const rt = runtimes[id];
          if (rt) ensureTerm(rt);
        }
        if (activeTabId) voidMicrotaskFit(activeTabId);
        startPoll();
        await drainAll();
      }
    } finally {
      if (gen === lifecycleGen) restoring = false;
    }
  }

  function onMenuAction(
    action:
      | { kind: "shell"; shellPath: string }
      | { kind: "cwd"; cwd: "workspace" | "home" },
  ) {
    if (action.kind === "shell") {
      void createTerminal(action.shellPath || undefined, "workspace");
    } else {
      void createTerminal(undefined, action.cwd);
    }
  }

  function onResizePointerDown(e: PointerEvent) {
    e.preventDefault();
    resizeDrag = true;
    const startY = e.clientY;
    const startH = heightPx;
    const onMove = (ev: PointerEvent) => {
      // Drag handle is above the dock — moving up grows height.
      const next = clampDockHeight(startH + (startY - ev.clientY));
      heightPx = next;
    };
    const onUp = () => {
      resizeDrag = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      saveDockChrome(heightPx, open);
      if (activeTabId) void fitAndResize(runtimes[activeTabId] ?? null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Hide collapses chrome only — never terminates PTYs.
  function hideDock() {
    open = false;
    autoCreateTried = false;
  }

  $effect(() => {
    if (!prefsReady) return;
    saveDockChrome(heightPx, open);
  });

  $effect(() => {
    if (open) {
      startPoll();
      queueMicrotask(() => {
        if (disposed) return;
        for (const id of tabOrder) {
          const rt = runtimes[id];
          if (rt?.hostEl) ensureTerm(rt);
        }
        if (activeTabId) {
          const rt = runtimes[activeTabId];
          if (rt) {
            void fitAndResize(rt);
            rt.term?.focus();
          }
        } else if (
          !autoCreateTried &&
          tabOrder.length === 0 &&
          connected &&
          sessionId &&
          inTauriShell() &&
          !busy &&
          !restoring
        ) {
          // Open dock with no tabs → start one shell immediately.
          autoCreateTried = true;
          void createTerminal();
        }
      });
    } else {
      // Collapse: pause poll + dispose xterm views; keep pty ids (no terminate).
      stopPoll();
      for (const rt of Object.values(runtimes)) {
        disposeRuntimeTerm(rt);
        rt.hostEl = null;
      }
    }
  });

  $effect(() => {
    const sid = sessionId;
    const ok = connected;
    if (!prefsReady || disposed) return;
    if (!sid || !ok) {
      if (boundSessionId !== null) {
        clearAllTabs();
        boundSessionId = null;
      }
      return;
    }
    if (boundSessionId === sid) return;
    boundSessionId = sid;
    clearAllTabs();
    void restoreFromBook(sid);
  });

  onMount(() => {
    disposed = false;
    const blob = loadDockBlob();
    heightPx = blob.dock.heightPx;
    // Restore presentation visibility exactly (hidden stays hidden).
    open = blob.dock.open;
    prefsReady = true;
    void loadEnv();
    return () => {
      disposed = true;
      stopPoll();
      disposeAllTerms();
    };
  });

  onDestroy(() => {
    disposed = true;
    stopPoll();
    disposeAllTerms();
  });
</script>

{#if open}
  <section
    class="pty-panel shell-acrylic"
    class:resizing={resizeDrag}
    style:height="{heightPx}px"
    aria-label="Terminal"
  >
    <div
      class="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      onpointerdown={onResizePointerDown}
    ></div>

    <TerminalTabBar
      tabs={tabBarItems}
      activeId={activeTabId}
      bind:menuOpen
      canCreate={!busy && tabOrder.length < MAX_TERMINAL_TABS}
      shells={env?.shells ?? []}
      onSelect={selectTab}
      onClose={(id) => void closeTab(id)}
      onCreate={() => void createTerminal()}
      onReorder={reorderTabs}
      onMenuAction={onMenuAction}
      onHide={hideDock}
    />

    {#if errorText}
      <p class="pty-error" role="alert">{errorText}</p>
    {/if}

    <div class="pty-stack">
      {#each tabOrder as id (id)}
        <div
          class="pty-host"
          class:active={id === activeTabId}
          hidden={id !== activeTabId}
          role="tabpanel"
          tabindex="-1"
          aria-labelledby={`terminal-tab-${id}`}
          use:hostAction={id}
          onclick={() => {
            selectTab(id);
            runtimes[id]?.term?.focus();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              selectTab(id);
              runtimes[id]?.term?.focus();
            }
          }}
        ></div>
      {/each}
      {#if tabOrder.length === 0}
        <div class="pty-empty">
          <EmptyState
            icon="terminal"
            title="No terminals"
            description="Press + or ⌘J to start a shell."
            compact
          >
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !connected || !sessionId}
              onclick={() => void createTerminal()}
            >
              New terminal
            </Button>
          </EmptyState>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .pty-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 92%, transparent);
  }

  .pty-panel.resizing {
    user-select: none;
  }

  .resize-handle {
    position: absolute;
    top: -2px;
    left: 0;
    right: 0;
    height: 4px;
    cursor: ns-resize;
    z-index: 1;
  }

  .resize-handle:hover,
  .pty-panel.resizing .resize-handle {
    background: color-mix(in srgb, var(--accent, var(--border)) 45%, transparent);
  }

  .pty-panel :global(.tab-bar) {
    position: relative;
    z-index: 5;
  }


  .pty-error {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    color: var(--danger, #f87171);
  }

  .pty-stack {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .pty-host {
    position: absolute;
    inset: 0;
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
  }

  .pty-host:not(.active) {
    visibility: hidden;
    pointer-events: none;
  }

  .pty-host.active {
    pointer-events: auto;
    cursor: text;
  }

  .pty-host :global(.xterm) {
    height: 100%;
  }

  .pty-host :global(.xterm-viewport) {
    overflow-y: auto !important;
  }

  .pty-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
  }
</style>
