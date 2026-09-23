<script lang="ts">
  import { Button, Icon } from "$lib/components/ui";
  import { isLightTheme } from "$lib/themes";

  export type RuntimePhase =
    | "starting"
    | "connected"
    | "reconnecting"
    | "offline"
    | "incompatible"
    | "failed";

  let {
    selectedSessionId = "",
    themeId = "zinc-calm",
    connected = false,
    busy = false,
    runtimePhase = "offline" as RuntimePhase,
    socketPath = "",
    providerKind = "unknown",
    ipcVersion = null,
    /** Parent wires when IPC mismatch; UI-only surface. */
    ipcWarn = null,
    terminalOpen = false,
    sessionModelSummary = "",
    onToggleAppearance,
    onDisconnect,
    onReconnect,
    onToggleTerminal,
  }: {
    selectedSessionId?: string;
    themeId?: string;
    connected?: boolean;
    busy?: boolean;
    runtimePhase?: RuntimePhase;
    socketPath?: string;
    providerKind?: string;
    ipcVersion?: number | null;
    /** TODO: +page passes when daemon IPC incompatible. */
    ipcWarn?: string | null;
    terminalOpen?: boolean;
    /** Compact provider · model · reasoning from ModelSelect when known. */
    sessionModelSummary?: string;
    onToggleAppearance: () => void;
    onDisconnect: () => void;
    onReconnect: () => void;
    onToggleTerminal: () => void;
  } = $props();

  const light = $derived(isLightTheme(themeId));
  const phaseLabel = $derived(
    runtimePhase === "starting"
      ? "Starting"
      : runtimePhase === "connected"
        ? "Connected"
        : runtimePhase === "reconnecting"
          ? "Reconnecting"
          : runtimePhase === "incompatible"
            ? "Incompatible"
            : runtimePhase === "failed"
              ? "Failed"
              : "Offline",
  );
  const statusTitle = $derived(
    [
      `Runtime · ${phaseLabel}`,
      providerKind !== "unknown" ? providerKind : "",
      ipcVersion != null ? `IPC v${ipcVersion}` : "",
      socketPath.trim() || "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const showReconnect = $derived(
    runtimePhase === "offline" || runtimePhase === "failed",
  );
  const providerBadge = $derived(
    providerKind === "mock"
      ? "mock"
      : providerKind === "provider"
        ? "provider"
        : providerKind === "acp"
          ? "acp"
          : "",
  );
</script>

<header class="topbar">
  <div class="left">
    <h1 class="title">
      {#if selectedSessionId}
        Session {selectedSessionId.slice(0, 8)}
      {:else}
        <span class="brand">Impetus</span>
      {/if}
    </h1>
    <div
      class="status"
      class:is-offline={!connected && runtimePhase !== "starting" && runtimePhase !== "reconnecting"}
      class:is-pending={runtimePhase === "starting" || runtimePhase === "reconnecting"}
      class:is-warn={runtimePhase === "incompatible" || runtimePhase === "failed"}
      title={statusTitle}
      aria-label={statusTitle}
    >
      <span class="runtime-word">Runtime</span>
      <span
        class="dot"
        class:on={runtimePhase === "connected"}
        class:pending={runtimePhase === "starting" || runtimePhase === "reconnecting"}
        class:warn={runtimePhase === "incompatible" || runtimePhase === "failed"}
        aria-hidden="true"
      ></span>
      <span class="label">{phaseLabel}</span>
      {#if connected && ipcVersion != null}
        <span class="kind mono" title={statusTitle}>v{ipcVersion}</span>
      {/if}
      {#if ipcWarn}
        <span class="kind mono warn" title={ipcWarn}>{ipcWarn}</span>
      {/if}
      {#if providerBadge}
        <span
          class="kind mono"
          class:mock={providerBadge === "mock"}
          title={providerBadge === "mock"
            ? "Mock provider — set a real profile in Preferences"
            : `Started with ${providerBadge} profile`}
        >
          {providerBadge}
        </span>
      {/if}
      {#if sessionModelSummary.trim() && !sessionModelSummary.trim().toLowerCase().startsWith("mock")}
        <span class="sock mono" title={sessionModelSummary}>{sessionModelSummary}</span>
      {/if}
    </div>
  </div>
  <div class="actions">
    <Button
      variant="ghost"
      size="icon"
      title={terminalOpen ? "Hide terminal" : "Show terminal"}
      aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
      aria-pressed={terminalOpen}
      onclick={onToggleTerminal}
    >
      <Icon name="terminal" size={16} />
    </Button>
    {#if connected}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title="Disconnect from Runtime"
        onclick={onDisconnect}
      >
        <Icon name="unplug" size={14} />
        Disconnect
      </Button>
    {:else if showReconnect}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title="Reconnect to Runtime"
        onclick={onReconnect}
      >
        Reconnect
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      title={light
        ? "Switch to dark (full themes in Preferences)"
        : "Switch to light (full themes in Preferences)"}
      aria-label={light
        ? "Switch to dark appearance — full themes in Preferences"
        : "Switch to light appearance — full themes in Preferences"}
      onclick={onToggleAppearance}
    >
      <Icon name={light ? "moon" : "sun"} size={16} />
    </Button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: var(--space-10);
    padding: var(--space-2) var(--space-5);
  }

  .left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--font-medium);
    color: var(--text);
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-height: 1em;
  }

  .brand {
    color: var(--muted);
    font-weight: var(--font-regular);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    max-width: min(42ch, 46vw);
    color: var(--muted);
    font-size: var(--text-xs);
    flex-shrink: 1;
  }

  .runtime-word {
    color: var(--muted);
    flex-shrink: 0;
  }

  .label {
    color: var(--muted);
    flex-shrink: 0;
  }

  /* Offline word must read as primary chrome, not decoration */
  .status.is-offline .label,
  .status.is-warn .label {
    color: var(--text);
    opacity: 0.78;
  }

  .status.is-pending .label {
    color: var(--text);
    opacity: 0.7;
  }

  .sock {
    max-width: min(28ch, 36vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Secondary identity — never --faint (fails contrast on dark packs) */
    color: var(--muted);
  }

  .kind {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .kind.mock {
    color: var(--warn, #d97706);
    border-color: color-mix(in oklab, var(--warn, #d97706) 40%, var(--border));
  }

  .kind.warn {
    color: color-mix(in oklab, var(--warn, #d97706) 55%, var(--muted));
    border-color: color-mix(in oklab, var(--warn, #d97706) 22%, var(--border));
  }

  .dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.85;
  }

  .dot.on {
    background: var(--success, var(--ok, #4ade80));
    opacity: 1;
  }

  .dot.pending {
    background: var(--warn, #d97706);
    opacity: 0.95;
  }

  .dot.warn {
    background: var(--warn, #d97706);
    opacity: 0.9;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
</style>
