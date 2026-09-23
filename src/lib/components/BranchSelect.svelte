<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Icon } from "$lib/components/ui";

  let {
    sessionId = "",
  }: {
    sessionId?: string;
  } = $props();

  let branch = $state("");
  let branches = $state<string[]>([]);
  let open = $state(false);
  let error = $state("");
  let loading = $state(false);
  let filter = $state("");
  let filterEl = $state<HTMLInputElement | null>(null);
  let createName = $state("");
  let creating = $state(false);
  let createAvailable = $state(true);

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.toLowerCase().includes(q));
  });

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  async function refresh() {
    const id = sessionId.trim();
    branch = "";
    branches = [];
    error = "";
    if (!id || !inTauriShell()) return;
    loading = true;
    try {
      branch = await invoke<string>("git_current_branch", { sessionId: id });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      branch = "";
    } finally {
      loading = false;
    }
  }

  async function loadBranches() {
    const id = sessionId.trim();
    if (!id || !inTauriShell()) return;
    try {
      branches = await invoke<string[]>("git_list_branches", { sessionId: id });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      branches = [];
    }
  }

  async function toggle() {
    if (!sessionId.trim() || !branch) return;
    open = !open;
    if (open) {
      filter = "";
      await loadBranches();
      queueMicrotask(() => filterEl?.focus());
    } else {
      filter = "";
    }
  }

  async function checkout(name: string) {
    if (!name || name === branch) {
      open = false;
      filter = "";
      return;
    }
    const ok = window.confirm(
      `Checkout branch "${name}"?\n\nUncommitted changes may be lost or block the switch.`,
    );
    if (!ok) return;
    open = false;
    filter = "";
    try {
      branch = await invoke<string>("git_checkout_branch", {
        sessionId: sessionId.trim(),
        branch: name,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      window.alert(`Checkout failed: ${error}`);
    }
  }

  /** Create via harness `CreateBranch` only — never local `git`. */
  async function createBranch() {
    const name = createName.trim();
    if (!name || creating || !sessionId.trim() || !inTauriShell()) return;
    creating = true;
    error = "";
    try {
      branch = await invoke<string>("git_create_branch", {
        sessionId: sessionId.trim(),
        branch: name,
        checkout: true,
      });
      createName = "";
      await loadBranches();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Cmd missing on older builds — hide create UI, keep list/checkout.
      if (/git_create_branch|not allowed|unknown command|Command\s+.+\s+not found/i.test(msg)) {
        createAvailable = false;
        error = "Create branch unavailable (daemon/client)";
      } else {
        error = msg;
        window.alert(`Create branch failed: ${msg}`);
      }
    } finally {
      creating = false;
    }
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".branch-select")) {
      open = false;
      filter = "";
    }
  }

  $effect(() => {
    void sessionId;
    void refresh();
  });

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        open = false;
        filter = "";
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  });
</script>

{#if sessionId.trim() && branch}
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
        <input
          bind:this={filterEl}
          class="filter mono"
          type="search"
          placeholder="Filter branches…"
          aria-label="Filter branches"
          autocomplete="off"
          bind:value={filter}
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key !== "Escape") return;
            e.preventDefault();
            if (filter.trim()) {
              filter = "";
              return;
            }
            open = false;
          }}
        />
        {#each filtered as b (b)}
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
          <p class="empty">{branches.length ? "No matches" : "No local branches"}</p>
        {/each}
        {#if createAvailable}
          <div class="create" onclick={(e) => e.stopPropagation()}>
            <input
              class="create-input mono"
              type="text"
              placeholder="New branch…"
              aria-label="New branch name"
              autocomplete="off"
              bind:value={createName}
              disabled={creating}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createBranch();
                }
              }}
            />
            <button
              type="button"
              class="create-btn"
              disabled={creating || !createName.trim()}
              onclick={() => void createBranch()}
            >
              {creating ? "…" : "Create"}
            </button>
          </div>
        {/if}
        {#if error}
          <p class="err" role="alert">{error}</p>
        {/if}
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

  .filter {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 0 0 var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--elevated);
    color: var(--text);
    font: inherit;
    font-size: var(--text-xs);
    outline: none;
  }

  .filter:focus {
    border-color: var(--accent, var(--border));
  }

  .filter::placeholder {
    color: var(--faint);
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

  .create {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--border);
  }

  .create-input {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: var(--space-2) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--elevated);
    color: var(--text);
    font: inherit;
    font-size: var(--text-xs);
    outline: none;
  }

  .create-input:focus {
    border-color: var(--accent, var(--border));
  }

  .create-btn {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .create-btn:hover:not(:disabled) {
    background: var(--elevated);
  }

  .create-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .err {
    margin: var(--space-1) 0 0;
    padding: var(--space-1) var(--space-2);
    color: var(--danger, #b91c1c);
    font-size: var(--text-xs);
    line-height: 1.3;
  }
</style>
