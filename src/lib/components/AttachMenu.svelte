<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ATTACH_CONTEXT, type AttachActionId, type AttachItem } from "$lib/attachMenu";
  import { Icon, Input } from "$lib/components/ui";

  type McpServerDto = {
    id: string;
    name: string;
    transport_hint: string;
    connected: boolean;
  };

  type ModelProviderDto = {
    provider_id: string;
    model_id: string;
    health: string;
    is_default: boolean;
    provider_display_name?: string | null;
    model_display_name?: string | null;
  };

  let {
    open = $bindable(false),
    workspaceRoot = "",
    query = $bindable(""),
    connected = false,
    busy = false,
    onAction,
    onMcpSelect,
  }: {
    open?: boolean;
    workspaceRoot?: string;
    query?: string;
    connected?: boolean;
    busy?: boolean;
    onAction: (id: AttachActionId) => void;
    onMcpSelect: (id: string) => void;
  } = $props();

  let view = $state<"root" | "mcp">("root");
  let mcpServers = $state<McpServerDto[]>([]);
  let mcpLoading = $state(false);
  let mcpError = $state("");
  let mcpReloading = $state(false);
  let modelLabel = $state("—");

  const filteredContext = $derived(filterItems(ATTACH_CONTEXT, query));

  function filterItems(items: AttachItem[], q: string): AttachItem[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.description?.toLowerCase().includes(needle) ?? false),
    );
  }

  function pick(id: AttachActionId) {
    if (id === "mcp") {
      void openMcp();
      return;
    }
    open = false;
    view = "root";
    onAction(id);
  }

  async function refreshModels() {
    if (!connected || !inTauriShell()) {
      modelLabel = "—";
      return;
    }
    try {
      const providers = await invoke<ModelProviderDto[]>("list_models");
      const def = providers.find((p) => p.is_default) ?? providers[0];
      modelLabel = def
        ? def.model_display_name?.trim() ||
          def.model_id ||
          def.provider_display_name?.trim() ||
          def.provider_id
        : "—";
    } catch {
      modelLabel = "—";
    }
  }

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  async function loadMcpServers() {
    mcpLoading = true;
    mcpError = "";
    try {
      // Daemon catalog only — never local Codex MCP config files.
      mcpServers = await invoke<McpServerDto[]>("list_mcp_servers");
    } catch (err) {
      mcpError = err instanceof Error ? err.message : String(err);
      mcpServers = [];
    } finally {
      mcpLoading = false;
    }
  }

  async function openMcp() {
    view = "mcp";
    query = "";
    mcpServers = [];
    await loadMcpServers();
  }

  /** Daemon `ReloadMcpServers` via Tauri `reload_mcp_servers`. */
  async function reloadMcp() {
    if (!inTauriShell() || mcpReloading) return;
    mcpReloading = true;
    mcpError = "";
    try {
      mcpServers = await invoke<McpServerDto[]>("reload_mcp_servers");
    } catch (err) {
      mcpError = err instanceof Error ? err.message : String(err);
    } finally {
      mcpReloading = false;
    }
  }

  function pickMcp(id: string) {
    open = false;
    view = "root";
    onMcpSelect(id);
  }

  function backToRoot() {
    view = "root";
    mcpError = "";
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".attach-menu") && !t?.closest(".composer-plus")) {
      open = false;
    }
  }

  $effect(() => {
    if (!open) {
      view = "root";
      return;
    }
    void refreshModels();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "mcp") {
          view = "root";
          return;
        }
        open = false;
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

{#if open}
  <div class="attach-menu" role="menu" aria-label="Attach">
    {#if view === "mcp"}
      <div class="mcp-head">
        <button type="button" class="back" onclick={backToRoot}>
          <Icon name="chevron-left" size={14} />
          MCP servers
        </button>
        <button
          type="button"
          class="reload"
          disabled={mcpLoading || mcpReloading || !connected}
          title="Reload MCP catalog from impetusd"
          onclick={() => void reloadMcp()}
        >
          {mcpReloading ? "Reloading…" : "Reload MCP"}
        </button>
      </div>
      {#if mcpLoading}
        <p class="hint">Loading…</p>
      {:else if mcpError}
        <p class="hint">{mcpError}</p>
      {:else if mcpServers.length === 0}
        <p class="hint">
          No MCP servers from daemon catalog — configure MCP on impetusd
        </p>
      {:else}
        <div class="group">
          {#each mcpServers as server (server.id)}
            <button
              type="button"
              class="row"
              role="menuitem"
              onclick={() => pickMcp(server.id)}
            >
              <span class="ctx-icon"><Icon name="plug" size={16} /></span>
              <span class="copy">
                <span class="label">{server.id}</span>
                <span class="desc mono">{server.transport_hint}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <Input
        class="attach-search"
        placeholder="Search files, chats, MCP…"
        bind:value={query}
      />

      {#if filteredContext.length}
        <div class="group">
          {#each filteredContext as item (item.id)}
            <button
              type="button"
              class="row"
              role="menuitem"
              disabled={item.id === "new_chat" && busy}
              onclick={() => pick(item.id)}
            >
              <span class="ctx-icon">
                {#if item.id === "files"}
                  <Icon name="plus" size={16} />
                {:else if item.id === "workspace"}
                  <Icon name="folder" size={16} />
                {:else if item.id === "new_chat"}
                  <Icon name="message-square" size={16} />
                {:else if item.id === "mcp"}
                  <Icon name="plug" size={16} />
                {:else}
                  <Icon name="sparkles" size={16} />
                {/if}
              </span>
              <span class="copy">
                <span class="label">
                  {item.label}
                  {#if item.id === "model"}
                    <span class="meta">{modelLabel}</span>
                  {/if}
                  {#if item.id === "workspace" && workspaceRoot}
                    <span class="meta mono">{workspaceRoot.split("/").filter(Boolean).pop()}</span>
                  {/if}
                </span>
                {#if item.description}
                  <span class="desc">{item.description}</span>
                {/if}
              </span>
              {#if item.id === "workspace" || item.id === "mcp"}
                <Icon name="chevron-right" size={14} />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .attach-menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + var(--space-2));
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    max-height: min(420px, 60vh);
    overflow: auto;
  }

  :global(.attach-search .ui-input) {
    background: transparent;
    border-color: transparent;
    min-height: var(--space-8);
  }

  :global(.attach-search .ui-input:focus-visible) {
    box-shadow: none;
    border-color: transparent;
  }

  .mcp-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
  }

  .back:hover {
    background: var(--elevated);
    color: var(--text);
  }

  .reload {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .reload:hover:not(:disabled) {
    background: var(--elevated);
    color: var(--text);
  }

  .reload:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .hint {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
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
    text-align: left;
    cursor: pointer;
  }

  .row:hover:not(:disabled) {
    background: var(--elevated);
  }

  .row:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ctx-icon {
    width: 18px;
    display: grid;
    place-items: center;
    color: var(--muted);
    flex-shrink: 0;
  }

  .copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .label {
    font-size: var(--text-md);
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .meta,
  .desc {
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--font-regular);
  }

  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14ch;
  }
</style>
