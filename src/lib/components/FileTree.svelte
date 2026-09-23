<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, EmptyState, Icon, Input } from "$lib/components/ui";
  import FilePreview from "$lib/components/FilePreview.svelte";
  import {
    binaryPreviewMessage,
    guessLanguage,
    isBinaryReadError,
    isImagePreviewPath,
  } from "$lib/textPreview";
  import "$lib/components/shell.css";

  type DirEntry = {
    name: string;
    path: string;
    is_dir: boolean;
    is_symlink: boolean;
    is_file: boolean;
  };

  type DirListing = {
    path: string;
    entries: DirEntry[];
  };

  type FileContent = {
    path: string;
    content: string;
    byte_count: number;
  };

  type SearchHit = {
    path: string;
    line: number;
    text: string;
  };

  type SearchResult = {
    path: string;
    pattern: string;
    hits: SearchHit[];
    truncated: boolean;
  };

  /** Soft cap for visible tree rows / listing page (pagination polish). */
  const PAGE_SIZE = 500;

  let {
    sessionId = "",
    workspaceRoot = "",
  }: {
    sessionId?: string;
    workspaceRoot?: string;
  } = $props();

  let children = $state<Record<string, DirEntry[]>>({});
  let truncatedDirs = $state<Record<string, boolean>>({});
  let expanded = $state<Set<string>>(new Set());
  let selectedPath = $state("");
  let previewContent = $state("");
  let previewLanguage = $state<string | undefined>(undefined);
  let previewEmpty = $state("Select a file");
  let loading = $state(false);
  let previewLoading = $state(false);
  let error = $state("");
  let filterQuery = $state("");
  let searchHits = $state<SearchHit[]>([]);
  let searchActive = $state(false);
  let searchLoading = $state(false);
  let searchTruncated = $state(false);
  let treeVisible = $state(PAGE_SIZE);
  let hitsVisible = $state(PAGE_SIZE);

  const workspaceLabel = $derived(
    workspaceRoot.trim()
      ? (workspaceRoot.split("/").filter(Boolean).pop() ?? workspaceRoot)
      : "",
  );

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async function loadDir(relPath: string) {
    const id = sessionId.trim();
    if (!id || !inTauriShell()) return;
    const key = relPath.trim() || ".";
    loading = true;
    error = "";
    try {
      const listing = await invoke<DirListing>("list_workspace_dir", {
        sessionId: id,
        path: key === "." ? null : key,
      });
      const entries = listing.entries ?? [];
      const capped = entries.slice(0, PAGE_SIZE);
      children = { ...children, [key]: capped };
      truncatedDirs = { ...truncatedDirs, [key]: entries.length > PAGE_SIZE };
    } catch (err) {
      error = errText(err);
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    children = {};
    truncatedDirs = {};
    expanded = new Set();
    selectedPath = "";
    previewContent = "";
    previewLanguage = undefined;
    previewEmpty = "Select a file";
    filterQuery = "";
    searchHits = [];
    searchActive = false;
    searchTruncated = false;
    treeVisible = PAGE_SIZE;
    hitsVisible = PAGE_SIZE;
    await loadDir(".");
  }

  async function toggleDir(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      expanded = next;
      return;
    }
    next.add(path);
    expanded = next;
    if (!children[path]) await loadDir(path);
  }

  async function selectFile(path: string) {
    selectedPath = path;
    previewContent = "";
    previewLanguage = guessLanguage(path);
    previewEmpty = "Empty file";
    const id = sessionId.trim();
    if (!id || !inTauriShell()) return;

    // Daemon ReadWorkspaceFile rejects binary — no image blob without local fs.
    if (isImagePreviewPath(path)) {
      previewEmpty = binaryPreviewMessage(path);
      return;
    }

    previewLoading = true;
    error = "";
    try {
      const file = await invoke<FileContent>("read_workspace_file", {
        sessionId: id,
        path,
        maxBytes: null,
      });
      previewContent = file.content;
      if (!file.content) previewEmpty = "Empty file";
    } catch (err) {
      previewContent = "";
      if (isBinaryReadError(err)) {
        previewEmpty = binaryPreviewMessage(path);
        error = "";
      } else {
        error = errText(err);
        previewEmpty = "Unavailable";
      }
    } finally {
      previewLoading = false;
    }
  }

  async function runDaemonSearch() {
    const id = sessionId.trim();
    const pattern = filterQuery.trim();
    if (!id || !pattern || !inTauriShell()) return;
    searchLoading = true;
    error = "";
    try {
      const result = await invoke<SearchResult>("search_workspace_files", {
        sessionId: id,
        path: null,
        pattern,
      });
      searchHits = result.hits ?? [];
      searchTruncated = Boolean(result.truncated);
      searchActive = true;
      hitsVisible = PAGE_SIZE;
    } catch (err) {
      error = errText(err);
      searchHits = [];
      searchActive = false;
    } finally {
      searchLoading = false;
    }
  }

  function clearSearch() {
    filterQuery = "";
    searchHits = [];
    searchActive = false;
    searchTruncated = false;
    hitsVisible = PAGE_SIZE;
    treeVisible = PAGE_SIZE;
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void runDaemonSearch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
    }
  }

  function allTreeRows(): { entry: DirEntry; depth: number }[] {
    const rows: { entry: DirEntry; depth: number }[] = [];
    function walk(dirKey: string, depth: number) {
      const list = children[dirKey] ?? [];
      for (const entry of list) {
        rows.push({ entry, depth });
        if (entry.is_dir && expanded.has(entry.path)) {
          walk(entry.path, depth + 1);
        }
      }
    }
    walk(".", 0);
    const needle = filterQuery.trim().toLowerCase();
    // Cheap client filter of current listing (daemon search is separate).
    if (needle && !searchActive) {
      return rows.filter(
        ({ entry }) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.path.toLowerCase().includes(needle),
      );
    }
    return rows;
  }

  const treeRows = $derived(allTreeRows());
  const visibleTreeRows = $derived(treeRows.slice(0, treeVisible));
  const treeTruncated = $derived(treeRows.length > treeVisible);
  const visibleHits = $derived(searchHits.slice(0, hitsVisible));
  const hitsMore = $derived(searchHits.length > hitsVisible);
  const rootTruncated = $derived(Boolean(truncatedDirs["."]));

  $effect(() => {
    void sessionId;
    void refresh();
  });
</script>

<div class="file-tree" aria-label="File tree">
  <div class="tree-head">
    {#if workspaceLabel}
      <div class="ws-row" title={workspaceRoot}>
        <Icon name="folder" size={14} />
        <span class="ws-name mono">{workspaceLabel}</span>
      </div>
    {:else}
      <p class="ws-empty">Open a workspace</p>
    {/if}
    <Button
      variant="ghost"
      size="sm"
      class="tree-refresh"
      title="Refresh"
      aria-label="Refresh file tree"
      disabled={!sessionId.trim() || loading}
      onclick={() => void refresh()}
    >
      Refresh
    </Button>
  </div>

  <div class="tree-search">
    <Input
      class="tree-search-input"
      placeholder="Filter files"
      aria-label="Filter files"
      mono
      disabled={!sessionId.trim()}
      bind:value={filterQuery}
      onkeydown={onSearchKeydown}
    />
    <Button
      variant="ghost"
      size="sm"
      title="Search"
      aria-label="Search files"
      disabled={!sessionId.trim() || !filterQuery.trim() || searchLoading}
      onclick={() => void runDaemonSearch()}
    >
      {searchLoading ? "…" : "Search"}
    </Button>
    {#if searchActive || filterQuery.trim()}
      <Button
        variant="ghost"
        size="sm"
        title="Clear"
        aria-label="Clear search"
        onclick={clearSearch}
      >
        Clear
      </Button>
    {/if}
  </div>

  <div class="tree-body">
    {#if !sessionId.trim()}
      <EmptyState
        icon="folder"
        title="No chat yet"
        description="Start a New Chat to browse project files."
        compact
      />
    {:else if error && !visibleTreeRows.length && !searchActive}
      <EmptyState icon="folder" title="Files unavailable" description={error} compact />
    {:else if loading && !visibleTreeRows.length && !searchActive}
      <p class="tree-hint">Loading…</p>
    {:else if searchActive}
      {#if searchLoading}
        <p class="tree-hint">Searching…</p>
      {:else if !searchHits.length}
        <EmptyState
          icon="file"
          title="No hits"
          description={`No matches for “${filterQuery.trim()}”`}
          compact
        />
      {:else}
        <ul class="tree-list" role="listbox" aria-label="Search hits">
          {#each visibleHits as hit (`${hit.path}:${hit.line}`)}
            <li
              class="tree-row"
              class:selected={selectedPath === hit.path}
              role="option"
              aria-selected={selectedPath === hit.path}
            >
              <button
                type="button"
                class="tree-btn hit-btn"
                title={`${hit.path}:${hit.line}`}
                onclick={() => void selectFile(hit.path)}
              >
                <Icon name="file" size={14} />
                <span class="hit-meta mono">
                  <span class="hit-path">{hit.path}:{hit.line}</span>
                  <span class="hit-snip">{hit.text.trim()}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if searchTruncated}
          <p class="tree-hint">Search truncated (daemon hit cap)</p>
        {/if}
        {#if hitsMore}
          <Button
            variant="ghost"
            size="sm"
            class="load-more"
            onclick={() => (hitsVisible += PAGE_SIZE)}
          >
            Load more ({searchHits.length - hitsVisible} left)
          </Button>
        {/if}
      {/if}
    {:else if !visibleTreeRows.length}
      <EmptyState
        icon="folder"
        title={filterQuery.trim() ? "No name matches" : "Empty"}
        description={filterQuery.trim()
          ? "Enter runs recursive daemon search"
          : "No entries under workspace root"}
        compact
      />
    {:else}
      <ul class="tree-list" role="tree">
        {#each visibleTreeRows as { entry, depth } (entry.path)}
          <li
            class="tree-row"
            class:selected={selectedPath === entry.path}
            style={`--depth: ${depth}`}
            role="treeitem"
            aria-selected={selectedPath === entry.path}
            aria-expanded={entry.is_dir ? expanded.has(entry.path) : undefined}
          >
            <button
              type="button"
              class="tree-btn"
              title={entry.path}
              onclick={() =>
                entry.is_dir ? void toggleDir(entry.path) : void selectFile(entry.path)}
            >
              <span class="tree-indent" aria-hidden="true"></span>
              {#if entry.is_dir}
                <Icon
                  name={expanded.has(entry.path) ? "chevron-down" : "chevron-right"}
                  size={12}
                />
                <Icon name="folder" size={14} />
              {:else}
                <span class="tree-spacer" aria-hidden="true"></span>
                <Icon name="file" size={14} />
              {/if}
              <span class="tree-name mono">{entry.name}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if rootTruncated}
        <p class="tree-hint">Directory truncated to {PAGE_SIZE} entries</p>
      {/if}
      {#if treeTruncated}
        <Button
          variant="ghost"
          size="sm"
          class="load-more"
          onclick={() => (treeVisible += PAGE_SIZE)}
        >
          Load more ({treeRows.length - treeVisible} left)
        </Button>
      {/if}
      {#if filterQuery.trim()}
        <p class="tree-hint">Name filter · Enter for recursive daemon search</p>
      {/if}
    {/if}
  </div>

  {#if sessionId.trim()}
    <div
      class="tree-preview"
      class:compact={!selectedPath && !previewContent && !previewLoading}
    >
      {#if previewLoading}
        <p class="tree-hint">Reading…</p>
      {:else}
        <FilePreview
          path={selectedPath || undefined}
          content={previewContent || undefined}
          language={previewLanguage}
          emptyMessage={selectedPath ? previewEmpty : "Select a file"}
        />
      {/if}
      {#if error && selectedPath}
        <p class="tree-error" role="alert">{error}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .file-tree {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }

  /* No preview pane: don't stretch into a tall empty column. */
  .file-tree:not(:has(.tree-preview)) {
    flex: 0 1 auto;
  }

  .tree-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0;
    min-height: var(--space-8);
  }

  .tree-search {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) 0;
  }

  :global(.tree-search-input) {
    flex: 1;
    min-width: 0;
  }

  :global(.tree-search-input .ui-input) {
    min-height: var(--space-7, 1.75rem);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
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
    font-family: var(--font-mono, var(--mono));
  }

  .ws-empty {
    margin: 0;
    padding: 0 var(--space-3);
    color: var(--faint);
    font-size: var(--text-xs);
  }

  :global(.tree-refresh) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .tree-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: var(--space-2);
  }

  /* Empty chat: one compact empty state, no half-panel void. */
  .file-tree:not(:has(.tree-preview)) .tree-body {
    flex: 0 1 auto;
  }

  .tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-row {
    margin: 0;
  }

  .tree-row.selected .tree-btn {
    background: var(--elevated);
    color: var(--text);
  }

  .tree-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    padding-left: calc(var(--space-2) + var(--depth) * var(--space-3));
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .hit-btn {
    padding-left: var(--space-2);
    align-items: flex-start;
  }

  .hit-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .hit-path {
    font-size: var(--text-xs);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hit-snip {
    font-size: var(--text-xs);
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--elevated) 70%, transparent);
  }

  .tree-btn :global(.ui-icon) {
    flex-shrink: 0;
    color: inherit;
  }

  .tree-indent {
    display: none;
  }

  .tree-spacer {
    width: 12px;
    flex-shrink: 0;
  }

  .tree-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-family: var(--font-mono, var(--mono));
  }

  .tree-hint {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--faint);
    font-size: var(--text-xs);
  }

  :global(.load-more) {
    align-self: flex-start;
    margin: var(--space-1) var(--space-2);
    color: var(--muted);
  }

  .tree-preview {
    flex: 1;
    min-height: 120px;
    max-height: 45%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-soft, var(--border));
    overflow: hidden;
  }

  .tree-preview.compact {
    flex: 0 0 auto;
    min-height: 0;
    max-height: none;
  }

  .tree-error {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--danger, var(--muted));
    font-size: var(--text-xs);
  }
</style>
