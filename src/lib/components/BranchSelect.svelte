<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Icon } from "$lib/components/ui";

  let {
    workspaceRoot = "",
  }: {
    workspaceRoot?: string;
  } = $props();

  let branch = $state("");
  let branches = $state<string[]>([]);
  let open = $state(false);
  let error = $state("");
  let loading = $state(false);

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  async function refresh() {
    const root = workspaceRoot.trim();
    branch = "";
    branches = [];
    error = "";
    if (!root || !inTauriShell()) return;
    loading = true;
    try {
      branch = await invoke<string>("git_current_branch", { workspaceRoot: root });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      branch = "";
    } finally {
      loading = false;
    }
  }

  async function loadBranches() {
    const root = workspaceRoot.trim();
    if (!root || !inTauriShell()) return;
    try {
      branches = await invoke<string[]>("git_list_branches", { workspaceRoot: root });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      branches = [];
    }
  }

  async function toggle() {
    if (!workspaceRoot.trim() || !branch) return;
    open = !open;
    if (open) await loadBranches();
  }

  async function checkout(name: string) {
    if (!name || name === branch) {
      open = false;
      return;
    }
    const ok = window.confirm(
      `Checkout branch "${name}"?\n\nUncommitted changes may be lost or block the switch.`,
    );
    if (!ok) return;
    open = false;
    try {
      await invoke<string>("git_checkout_branch", {
        workspaceRoot: workspaceRoot.trim(),
        branch: name,
      });
      branch = name;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      window.alert(`Checkout failed: ${error}`);
    }
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".branch-select")) open = false;
  }

  $effect(() => {
    void workspaceRoot;
    void refresh();
  });

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  });
</script>

{#if workspaceRoot.trim() && branch}
  <div class="branch-select">
    <button
      type="button"
      class="branch-btn"
      disabled={loading}
      title={error || `Branch: ${branch}`}
      aria-expanded={open}
      aria-haspopup="listbox"
      onclick={() => void toggle()}
    >
      <Icon name="git-branch" size={14} />
      <span class="name mono">{branch}</span>
      <Icon name="chevron-down" size={12} />
    </button>
    {#if open}
      <div class="menu" role="listbox" aria-label="Local branches">
        {#each branches as b (b)}
          <button
            type="button"
            class="row"
            class:on={b === branch}
            role="option"
            aria-selected={b === branch}
            onclick={() => void checkout(b)}
          >
            <span class="mono">{b}</span>
          </button>
        {:else}
          <p class="empty">No local branches</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .branch-select {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .branch-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .branch-btn:hover:not(:disabled) {
    background: var(--elevated);
    color: var(--text);
  }

  .branch-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .name {
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + var(--space-1));
    z-index: var(--z-overlay);
    min-width: 180px;
    max-width: 280px;
    max-height: 220px;
    overflow: auto;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .row {
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

  .row:hover,
  .row.on {
    background: var(--elevated);
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--faint);
    font-size: var(--text-xs);
  }
</style>
