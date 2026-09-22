<script lang="ts">
  import { Button, EmptyState, Icon } from "$lib/components/ui";
  import "$lib/components/shell.css";

  type SessionDto = {
    id: string;
    created_at_unix_ms: number;
    updated_at_unix_ms: number;
    parent_session_id: string | null;
    fork_sequence: number | null;
  };

  let {
    open = $bindable(true),
    sessions = [],
    selectedSessionId = $bindable(""),
    workspaceRoot = "",
    busy = false,
    connected = false,
    onCreateSession,
    onOpenWorkspace,
    onSelectSession,
    onPrefs,
  }: {
    open?: boolean;
    sessions?: SessionDto[];
    selectedSessionId?: string;
    workspaceRoot?: string;
    busy?: boolean;
    connected?: boolean;
    onCreateSession: () => void;
    onOpenWorkspace: () => void;
    onSelectSession: (id: string) => void;
    onPrefs: () => void;
  } = $props();

  function persist(next: boolean) {
    open = next;
    localStorage.setItem("impetus.desktop.rail", next ? "1" : "0");
  }

  function relativeTime(ms: number): string {
    const mins = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  const workspaceLabel = $derived(
    workspaceRoot.trim()
      ? (workspaceRoot.split("/").filter(Boolean).pop() ?? workspaceRoot)
      : "",
  );
</script>

<aside class="rail shell-acrylic" class:collapsed={!open} aria-label="Sessions">
  <div class="rail-head">
    {#if open}
      <Button
        variant="ghost"
        size="icon"
        class="rail-toggle"
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
        onclick={() => persist(false)}
      >
        <Icon name="panel-left-close" size={16} />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon"
        class="rail-expand"
        title="Expand sidebar"
        aria-label="Expand sidebar"
        onclick={() => persist(true)}
      >
        <Icon name="panel-left" size={16} />
      </Button>
    {/if}
  </div>

  {#if open}
    <nav class="rail-nav" aria-label="Actions">
      <button
        type="button"
        class="nav-item"
        disabled={busy}
        title={connected
          ? "New Chat — uses the current workspace"
          : "New Chat — connects, then starts a session"}
        onclick={onCreateSession}
      >
        <Icon name="message-square" size={16} />
        <span class="nav-label">New Chat</span>
      </button>
    </nav>

    <div class="rail-section">
      <div class="section-head">
        <span class="shell-label">Workspace</span>
        <Button
          variant="ghost"
          size="icon"
          class="ws-add"
          title="Open workspace folder"
          aria-label="Open workspace folder"
          disabled={busy}
          onclick={onOpenWorkspace}
        >
          <Icon name="folder-plus" size={16} />
        </Button>
      </div>

      {#if workspaceLabel}
        <div class="ws-row" title={workspaceRoot}>
          <Icon name="folder" size={14} />
          <span class="ws-name mono">{workspaceLabel}</span>
        </div>
      {:else}
        <p class="ws-empty">No folder — use + to open a project</p>
      {/if}

      <div class="section-head sessions-head">
        <span class="shell-label">Chats</span>
      </div>
      <div class="session-list selectable">
        {#if sessions.length === 0}
          <EmptyState
            icon="message-square"
            title="No chats"
            description={workspaceLabel
              ? "New Chat starts a session here."
              : "Open a workspace, then New Chat."}
            compact
          />
        {:else}
          {#each sessions as session, i (session.id)}
            <button
              type="button"
              class="session"
              class:on={selectedSessionId === session.id}
              onclick={() => onSelectSession(session.id)}
            >
              <Icon name="message-square" size={14} />
              <span class="id mono">
                {#if i < 9}<span class="idx">{i + 1}</span>{/if}{session.id.slice(0, 8)}
              </span>
              <span class="meta">{relativeTime(session.updated_at_unix_ms)}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="rail-foot">
      <Button
        variant="ghost"
        size="icon"
        title="Preferences"
        aria-label="Preferences"
        onclick={onPrefs}
      >
        <Icon name="settings" size={16} />
      </Button>
    </div>
  {/if}
</aside>

<style>
  .rail {
    width: 260px;
    border-right: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: width var(--motion-fast) var(--ease);
  }

  .rail.collapsed {
    width: var(--space-12);
    min-width: var(--space-12);
    overflow: hidden;
  }

  .rail-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    min-height: var(--space-10);
    padding: var(--space-2) var(--space-3);
  }

  .rail.collapsed .rail-head {
    justify-content: center;
    padding: var(--space-2) 0;
  }

  :global(.rail-toggle),
  :global(.rail-expand) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 var(--space-2) var(--space-2);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-md);
    font-weight: var(--font-regular);
    text-align: left;
    cursor: pointer;
  }

  .nav-item:hover:not(:disabled) {
    background: var(--elevated);
  }

  .nav-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .nav-item :global(.ui-icon) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .nav-label {
    flex: 1;
    min-width: 0;
  }

  .rail-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-2) 0;
    gap: var(--space-2);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-3);
    min-height: var(--space-8);
  }

  .sessions-head {
    margin-top: var(--space-1);
  }

  :global(.ws-add) {
    color: var(--muted);
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--text);
  }

  .ws-row :global(.ui-icon) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .ws-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .ws-empty {
    margin: 0;
    padding: 0 var(--space-3);
    color: var(--faint);
    font-size: var(--text-xs);
  }

  .session-list {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font: inherit;
    cursor: pointer;
  }

  .session:hover {
    background: var(--elevated);
  }

  .session.on {
    background: var(--elevated);
  }

  .session :global(.ui-icon) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .session .id {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .session .idx {
    color: var(--faint);
    margin-right: var(--space-1);
  }

  .session .meta {
    color: var(--faint);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .rail-foot {
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
  }
</style>
