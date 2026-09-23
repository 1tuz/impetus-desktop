<script lang="ts">
  import { Button, EmptyState, Icon } from "$lib/components/ui";
  import {
    displaySessionTitle,
    loadArchivedSessionIds,
    loadRemovedSessionIds,
    loadSessionTitles,
    removeSessionFromList,
    saveSessionTitle,
    setSessionArchived,
  } from "$lib/sessionRailPrefs";
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
    daemonReachable = false,
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
    daemonReachable?: boolean;
    onCreateSession: () => void;
    onOpenWorkspace: () => void;
    onSelectSession: (id: string) => void;
    onPrefs: () => void;
  } = $props();

  let titles = $state<Record<string, string>>(loadSessionTitles());
  let archivedIds = $state<Set<string>>(loadArchivedSessionIds());
  let removedIds = $state<Set<string>>(loadRemovedSessionIds());
  let showArchived = $state(false);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state("");

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

  const visibleSessions = $derived(
    sessions.filter((s) => {
      if (removedIds.has(s.id)) return false;
      const archived = archivedIds.has(s.id);
      return showArchived ? archived : !archived;
    }),
  );

  const archivedCount = $derived(
    sessions.filter((s) => archivedIds.has(s.id) && !removedIds.has(s.id)).length,
  );

  function startRename(id: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    renamingId = id;
    renameDraft = displaySessionTitle(id, titles);
  }

  function commitRename() {
    if (!renamingId) return;
    titles = saveSessionTitle(renamingId, renameDraft);
    renamingId = null;
    renameDraft = "";
  }

  function cancelRename() {
    renamingId = null;
    renameDraft = "";
  }

  function archiveSession(id: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    archivedIds = setSessionArchived(id, true);
    if (selectedSessionId === id) selectedSessionId = "";
  }

  function unarchiveSession(id: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    archivedIds = setSessionArchived(id, false);
  }

  function deleteFromList(id: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Presentation only — Core has no DeleteSession IPC yet.
    const ok = window.confirm(
      "Remove this chat from the list?\n(Daemon session stays until Core ships delete.)",
    );
    if (!ok) return;
    removedIds = removeSessionFromList(id);
    if (selectedSessionId === id) selectedSessionId = "";
  }

  /** Autofocus rename field when it mounts. */
  function focusOnMount(node: HTMLInputElement) {
    queueMicrotask(() => {
      node.focus();
      node.select();
    });
  }
</script>

<aside class="rail shell-acrylic" class:collapsed={!open} aria-label="Sessions">
  <!-- Toggle stays top-left whether open or collapsed — same hit target. -->
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
        {#if archivedCount > 0}
          <button
            type="button"
            class="archive-toggle"
            onclick={() => (showArchived = !showArchived)}
          >
            {showArchived ? "Active" : `Archived (${archivedCount})`}
          </button>
        {/if}
      </div>
      <div class="session-list selectable">
        {#if visibleSessions.length === 0}
          <EmptyState
            icon="message-square"
            title={showArchived ? "No archived chats" : "No chats"}
            description={showArchived
              ? "Unarchive from the row actions."
              : workspaceLabel
                ? "New Chat starts a session here."
                : "Open a workspace, then New Chat."}
            compact
          />
        {:else}
          {#each visibleSessions as session, i (session.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="session"
              class:on={selectedSessionId === session.id}
            >
              {#if renamingId === session.id}
                <div class="session-rename">
                  <Icon name="message-square" size={14} />
                  <input
                    class="rename-input mono"
                    type="text"
                    aria-label="Chat name"
                    bind:value={renameDraft}
                    use:focusOnMount
                    onkeydown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onblur={() => commitRename()}
                  />
                </div>
              {:else}
                <button
                  type="button"
                  class="session-main"
                  onclick={() => {
                    onSelectSession(session.id);
                  }}
                >
                  <Icon name="message-square" size={14} />
                  <span class="id" title={session.id}>
                    {#if i < 9 && !showArchived}<span class="idx">{i + 1}</span>{/if}{displaySessionTitle(
                      session.id,
                      titles,
                    )}
                  </span>
                </button>
                <div class="session-actions">
                  <button
                    type="button"
                    class="act"
                    title="Rename"
                    aria-label="Rename chat"
                    onclick={(e) => startRename(session.id, e)}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  {#if showArchived}
                    <button
                      type="button"
                      class="act"
                      title="Unarchive"
                      aria-label="Unarchive chat"
                      onclick={(e) => unarchiveSession(session.id, e)}
                    >
                      <Icon name="archive" size={13} />
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="act"
                      title="Archive"
                      aria-label="Archive chat"
                      onclick={(e) => archiveSession(session.id, e)}
                    >
                      <Icon name="archive" size={13} />
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="act danger"
                    title="Remove from list"
                    aria-label="Remove chat from list"
                    onclick={(e) => deleteFromList(session.id, e)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                <span class="meta">{relativeTime(session.updated_at_unix_ms)}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="rail-foot">
      <Button
        variant="ghost"
        size="icon"
        class="rail-prefs"
        title="Preferences"
        aria-label="Preferences"
        onclick={onPrefs}
      >
        <Icon name="settings" size={16} />
      </Button>
    </div>
  {:else}
    <!-- Collapsed: prefs stays bottom-left under expand (same left column). -->
    <div class="rail-foot collapsed-foot">
      <Button
        variant="ghost"
        size="icon"
        class="rail-prefs"
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
    position: relative;
  }

  .rail.collapsed {
    width: var(--space-12);
    min-width: var(--space-12);
  }

  .rail-head {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    min-height: var(--space-10);
    padding: var(--space-2);
    padding-left: var(--space-2);
  }

  .rail.collapsed .rail-head {
    justify-content: center;
    padding: var(--space-2) 0;
  }

  :global(.rail-toggle),
  :global(.rail-expand),
  :global(.rail-prefs) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 var(--space-2) var(--space-1);
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
    padding: 0 var(--space-2) 0;
    gap: var(--space-1);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-3);
    min-height: var(--space-7);
  }

  .sessions-head {
    margin-top: var(--space-2);
  }

  .archive-toggle {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .archive-toggle:hover {
    color: var(--text);
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
    padding: var(--space-1) var(--space-3);
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
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-md);
    min-height: var(--space-8);
    padding-right: 4px;
  }

  .session:hover,
  .session.on {
    background: var(--elevated);
  }

  .session-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .session-main :global(.ui-icon) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .session .id {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  }

  .session .idx {
    color: var(--faint);
    margin-right: var(--space-1);
    font-family: inherit;
  }

  .session .meta {
    color: var(--faint);
    font-size: var(--text-xs);
    white-space: nowrap;
    padding-right: 2px;
    flex-shrink: 0;
  }

  .session-actions {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
    opacity: 0.72;
  }

  .session:hover .session-actions,
  .session.on .session-actions {
    opacity: 1;
  }

  .act {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .act:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .act.danger:hover {
    color: var(--danger, #f87171);
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    margin: 0 var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .session-rename {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    min-width: 0;
  }

  .session-rename :global(.ui-icon) {
    color: var(--muted);
    flex-shrink: 0;
  }

  .rail-foot {
    padding: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-1);
    margin-top: auto;
  }

  .collapsed-foot {
    justify-content: center;
    padding: var(--space-2) 0 var(--space-3);
  }
</style>
