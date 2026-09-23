<script lang="ts">
  import { Button, Icon } from "$lib/components/ui";
  import FileTree from "$lib/components/FileTree.svelte";
  import ReviewPanel from "$lib/components/ReviewPanel.svelte";
  import ChildRunsPanel from "$lib/components/ChildRunsPanel.svelte";
  import "$lib/components/shell.css";

  type TabId = "files" | "review" | "agents";

  let {
    open = $bindable(true),
    activeTab = $bindable("files" as TabId),
    sessionId = "",
    workspaceRoot = "",
    connected = false,
    busy = false,
  }: {
    open?: boolean;
    activeTab?: TabId;
    sessionId?: string;
    workspaceRoot?: string;
    connected?: boolean;
    busy?: boolean;
  } = $props();

  function setOpen(next: boolean) {
    open = next;
  }

  function selectTab(tab: TabId) {
    activeTab = tab;
  }

  const tabAriaId = $derived(
    activeTab === "files"
      ? "right-panel-tab-files"
      : activeTab === "review"
        ? "right-panel-tab-review"
        : "right-panel-tab-agents",
  );
</script>

<aside class="right-panel shell-acrylic" class:collapsed={!open} aria-label="Right panel">
  <div class="panel-head">
    {#if open}
      <div class="tabs" role="tablist" aria-label="Panel tabs">
        <button
          type="button"
          role="tab"
          class="tab"
          class:on={activeTab === "files"}
          aria-selected={activeTab === "files"}
          id="right-panel-tab-files"
          onclick={() => selectTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          class:on={activeTab === "review"}
          aria-selected={activeTab === "review"}
          id="right-panel-tab-review"
          onclick={() => selectTab("review")}
        >
          Review
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          class:on={activeTab === "agents"}
          aria-selected={activeTab === "agents"}
          id="right-panel-tab-agents"
          onclick={() => selectTab("agents")}
        >
          Agents
        </button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="panel-toggle"
        title="Collapse panel"
        aria-label="Collapse right panel"
        onclick={() => setOpen(false)}
      >
        <Icon name="chevron-right" size={16} />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon"
        class="panel-expand"
        title="Expand panel"
        aria-label="Expand right panel"
        onclick={() => setOpen(true)}
      >
        <Icon name="chevron-left" size={16} />
      </Button>
    {/if}
  </div>

  {#if open}
    <div class="panel-body" role="tabpanel" aria-labelledby={tabAriaId}>
      {#if activeTab === "files"}
        <FileTree {sessionId} {workspaceRoot} />
      {:else if activeTab === "review"}
        <ReviewPanel {sessionId} />
      {:else}
        <ChildRunsPanel {sessionId} {connected} {busy} />
      {/if}
    </div>
  {/if}
</aside>

<style>
  .right-panel {
    width: 280px;
    border-left: 1px solid var(--border-soft, var(--border));
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: width var(--motion-fast) var(--ease);
    background: var(--surface, transparent);
  }

  .right-panel.collapsed {
    width: var(--space-12);
    min-width: var(--space-12);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--space-10);
    padding: var(--space-2) var(--space-3);
  }

  .right-panel.collapsed .panel-head {
    justify-content: center;
    padding: var(--space-2) 0;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .tab {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
  }

  .tab:hover {
    color: var(--text);
    background: var(--elevated);
  }

  .tab.on {
    color: var(--text);
    background: var(--elevated);
  }

  :global(.panel-toggle),
  :global(.panel-expand) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
