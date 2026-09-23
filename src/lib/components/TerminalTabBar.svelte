<script lang="ts">
  import { Button, Icon } from "$lib/components/ui";
  import "$lib/components/shell.css";

  export type TerminalTabBarItem = {
    id: string;
    title: string;
  };

  let {
    tabs = [],
    activeId = null,
    menuOpen = $bindable(false),
    canCreate = true,
    /** Existing shell paths for ▾ menu (basename shown). */
    shells = [] as string[],
    onSelect,
    onClose,
    onCreate,
    onReorder,
    onMenuAction,
    onHide,
  }: {
    tabs?: TerminalTabBarItem[];
    activeId?: string | null;
    menuOpen?: boolean;
    canCreate?: boolean;
    shells?: string[];
    onSelect?: (id: string) => void;
    onClose?: (id: string) => void;
    onCreate?: () => void;
    onReorder?: (fromId: string, toId: string) => void;
    onMenuAction?: (
      action:
        | { kind: "shell"; shellPath: string }
        | { kind: "cwd"; cwd: "workspace" | "home" },
    ) => void;
    onHide?: () => void;
  } = $props();

  function basename(path: string): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  let dragId = $state<string | null>(null);

  function onDragStart(e: DragEvent, id: string) {
    dragId = id;
    e.dataTransfer?.setData("text/plain", id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: DragEvent, toId: string) {
    e.preventDefault();
    const fromId = dragId ?? e.dataTransfer?.getData("text/plain") ?? "";
    dragId = null;
    if (fromId && toId && fromId !== toId) onReorder?.(fromId, toId);
  }

  function onDragEnd() {
    dragId = null;
  }

  function closeTab(e: MouseEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    onClose?.(id);
  }
</script>

<div class="tab-bar">
  <div class="tabs" role="tablist" aria-label="Terminal tabs">
    {#each tabs as tab (tab.id)}
      <div
        class="tab-wrap"
        class:on={tab.id === activeId}
        class:dragging={dragId === tab.id}
        draggable="true"
        role="presentation"
        ondragstart={(e) => onDragStart(e, tab.id)}
        ondragover={onDragOver}
        ondrop={(e) => onDrop(e, tab.id)}
        ondragend={onDragEnd}
      >
        <button
          type="button"
          role="tab"
          class="tab"
          class:on={tab.id === activeId}
          aria-selected={tab.id === activeId}
          id={`terminal-tab-${tab.id}`}
          title={tab.title}
          onclick={() => onSelect?.(tab.id)}
        >
          <span class="tab-title">{tab.title}</span>
        </button>
        <button
          type="button"
          class="tab-close"
          title="Close terminal"
          aria-label={`Close ${tab.title}`}
          onclick={(e) => closeTab(e, tab.id)}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    {/each}
  </div>

  <div class="create-group">
    <Button
      variant="ghost"
      size="icon"
      disabled={!canCreate}
      title="New terminal"
      aria-label="New terminal"
      onclick={() => onCreate?.()}
    >
      <Icon name="plus" size={14} />
    </Button>
    <div class="menu-anchor">
      <Button
        variant="ghost"
        size="icon"
        disabled={!canCreate}
        title="New terminal options"
        aria-label="New terminal options"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Icon name="chevron-down" size={14} />
      </Button>
      {#if menuOpen}
        <div
          class="menu"
          role="menu"
          tabindex="-1"
          onmouseleave={() => (menuOpen = false)}
        >
          <button
            type="button"
            role="menuitem"
            class="menu-item"
            onclick={() => {
              menuOpen = false;
              onMenuAction?.({ kind: "shell", shellPath: "" });
            }}
          >
            Default shell
          </button>
          {#each shells as shellPath}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onclick={() => {
                menuOpen = false;
                onMenuAction?.({ kind: "shell", shellPath });
              }}
            >
              {basename(shellPath)}
            </button>
          {/each}
          <div class="menu-sep" role="separator"></div>
          <button
            type="button"
            role="menuitem"
            class="menu-item"
            onclick={() => {
              menuOpen = false;
              onMenuAction?.({ kind: "cwd", cwd: "workspace" });
            }}
          >
            Current Workspace
          </button>
          <button
            type="button"
            role="menuitem"
            class="menu-item"
            onclick={() => {
              menuOpen = false;
              onMenuAction?.({ kind: "cwd", cwd: "home" });
            }}
          >
            Home Directory
          </button>
        </div>
      {/if}
    </div>
  </div>

  <Button
    variant="ghost"
    size="icon"
    class="hide-btn"
    title="Hide terminal"
    aria-label="Hide terminal"
    onclick={() => onHide?.()}
  >
    <Icon name="x" size={14} />
  </Button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--space-10);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 5;
    pointer-events: auto;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
  }

  .tab-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0;
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .tab-wrap.on,
  .tab-wrap:hover {
    background: var(--elevated);
  }

  .tab-wrap.dragging {
    opacity: 0.55;
  }

  .tab {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    max-width: 10rem;
  }

  .tab.on {
    color: var(--text);
  }

  .tab-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    min-width: var(--space-6);
    min-height: var(--space-6);
    pointer-events: auto;
  }

  .tab-close:hover {
    color: var(--text);
  }

  .create-group {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0;
  }

  .menu-anchor {
    position: relative;
  }

  .menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: var(--z-overlay, 40);
    min-width: 11rem;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--panel, var(--elevated));
    box-shadow: var(--shadow-md, 0 8px 24px rgb(0 0 0 / 0.2));
  }

  .menu-item {
    display: block;
    width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--elevated);
  }

  .menu-sep {
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--border);
  }

  :global(.hide-btn) {
    flex-shrink: 0;
    color: var(--muted);
  }
</style>
