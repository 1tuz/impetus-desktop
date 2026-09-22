<script lang="ts">
  import { Button, Icon } from "$lib/components/ui";
  import { isLightTheme } from "$lib/themes";

  let {
    selectedSessionId = "",
    themeId = "zinc-calm",
    connected = false,
    busy = false,
    daemonReachable = false,
    socketPath = "",
    onToggleAppearance,
    onConnect,
    onDisconnect,
    onStartDaemon,
  }: {
    selectedSessionId?: string;
    themeId?: string;
    connected?: boolean;
    busy?: boolean;
    daemonReachable?: boolean;
    socketPath?: string;
    onToggleAppearance: () => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onStartDaemon: () => void;
  } = $props();

  const light = $derived(isLightTheme(themeId));
  const socketBase = $derived(
    socketPath.trim()
      ? (socketPath.split("/").filter(Boolean).pop() ?? socketPath)
      : "",
  );
  const statusTitle = $derived(
    connected
      ? `Connected${socketPath ? ` · ${socketPath}` : ""}`
      : "Offline — Connect or start impetusd",
  );
  const offlineAction = $derived(daemonReachable ? "connect" : "start");
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
    <div class="status" title={statusTitle}>
      <span class="dot" class:on={connected} aria-hidden="true"></span>
      <span class="label">{connected ? "connected" : "offline"}</span>
      {#if socketBase}
        <span class="sock mono">{socketBase}</span>
      {/if}
    </div>
  </div>
  <div class="actions">
    {#if connected}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title="Disconnect from impetusd"
        onclick={onDisconnect}
      >
        <Icon name="unplug" size={14} />
        Disconnect
      </Button>
    {:else if offlineAction === "start"}
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        title="Start impetusd then connect"
        onclick={onStartDaemon}
      >
        <Icon name="plug" size={14} />
        Start daemon
      </Button>
    {:else}
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        title="Connect to impetusd"
        onclick={onConnect}
      >
        <Icon name="plug" size={14} />
        Connect
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      title={light ? "Switch to dark" : "Switch to light"}
      aria-label={light ? "Switch to dark appearance" : "Switch to light appearance"}
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
    color: var(--muted);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .sock {
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--faint);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--faint);
  }

  .dot.on {
    background: var(--success, var(--ok, #4ade80));
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
</style>
