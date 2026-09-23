<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, EmptyState } from "$lib/components/ui";
  import FilePreview from "$lib/components/FilePreview.svelte";
  import "$lib/components/shell.css";

  type GitChangeKind =
    | "Modified"
    | "Added"
    | "Deleted"
    | "Renamed"
    | "Copied"
    | "Unmerged"
    | "Untracked"
    | "Ignored"
    | "Unknown"
    | string;

  type ChangedFile = {
    path: string;
    kind: GitChangeKind;
    status_code?: string | null;
  };

  type GitStatus = {
    dirty: boolean;
    conflict_in_progress: boolean;
    files: ChangedFile[];
  };

  type DiffObservation = {
    insertions: number;
    deletions: number;
    files_changed: number;
    hunks?: { file: string; preview: string }[];
  };

  type DiffPayload = {
    patch: string;
    truncated: boolean;
    files_changed: number;
    observation?: DiffObservation | null;
  };

  let {
    sessionId = "",
  }: {
    sessionId?: string;
  } = $props();

  let files = $state<ChangedFile[]>([]);
  let insertions = $state(0);
  let deletions = $state(0);
  let selectedPath = $state("");
  let patch = $state("");
  let loading = $state(false);
  let patchLoading = $state(false);
  let error = $state("");
  let dirty = $state(false);
  let conflict = $state(false);

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function pathStr(path: string | { toString?: () => string }): string {
    return typeof path === "string" ? path : String(path);
  }

  function kindLabel(kind: GitChangeKind): string {
    switch (kind) {
      case "Modified":
        return "M";
      case "Added":
        return "A";
      case "Deleted":
        return "D";
      case "Renamed":
        return "R";
      case "Copied":
        return "C";
      case "Unmerged":
        return "U";
      case "Untracked":
        return "?";
      case "Ignored":
        return "!";
      default:
        return " ";
    }
  }

  function fileLabel(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  async function refresh() {
    const id = sessionId.trim();
    files = [];
    insertions = 0;
    deletions = 0;
    selectedPath = "";
    patch = "";
    error = "";
    dirty = false;
    conflict = false;
    if (!id || !inTauriShell()) return;
    loading = true;
    try {
      const status = await invoke<GitStatus>("git_status", { sessionId: id });
      dirty = status.dirty;
      conflict = status.conflict_in_progress;
      files = (status.files ?? []).map((f) => ({
        ...f,
        path: pathStr(f.path),
      }));
      try {
        const diff = await invoke<DiffPayload>("get_diff", {
          sessionId: id,
          baseRef: null,
        });
        if (diff.observation) {
          insertions = diff.observation.insertions ?? 0;
          deletions = diff.observation.deletions ?? 0;
        }
      } catch {
        // Status list still useful without whole-tree patch.
      }
    } catch (err) {
      error = errText(err);
    } finally {
      loading = false;
    }
  }

  async function selectFile(path: string) {
    selectedPath = path;
    patch = "";
    const id = sessionId.trim();
    if (!id || !inTauriShell()) return;
    patchLoading = true;
    error = "";
    try {
      const diff = await invoke<DiffPayload>("get_file_diff", {
        sessionId: id,
        path,
        baseRef: null,
      });
      patch = diff.patch ?? "";
    } catch (err) {
      error = errText(err);
      patch = "";
    } finally {
      patchLoading = false;
    }
  }

  $effect(() => {
    void sessionId;
    void refresh();
  });
</script>

<div class="review-panel" aria-label="Review">
  <div class="review-list-head">
    <span class="shell-label">Changes</span>
    <span class="diff-stats mono">
      <span class="plus">+{insertions}</span>
      <span class="minus">−{deletions}</span>
    </span>
    <Button
      variant="ghost"
      size="sm"
      class="review-refresh"
      title="Refresh"
      aria-label="Refresh review"
      disabled={!sessionId.trim() || loading}
      onclick={() => void refresh()}
    >
      Refresh
    </Button>
  </div>

  {#if conflict}
    <p class="review-banner" role="status">Merge conflict in progress</p>
  {:else if dirty && !files.length}
    <p class="review-banner muted" role="status">Working tree dirty</p>
  {/if}

  {#if !sessionId.trim()}
    <div class="review-empty">
      <EmptyState
        icon="git-branch"
        title="No chat yet"
        description="Start a New Chat to see changed files."
        compact
      />
    </div>
  {:else if error && !files.length}
    <div class="review-empty">
      <EmptyState icon="git-branch" title="Review unavailable" description={error} compact />
    </div>
  {:else if loading && !files.length}
    <p class="review-hint">Loading…</p>
  {:else if !files.length}
    <div class="review-empty">
      <EmptyState
        icon="git-branch"
        title="Clean working tree"
        description="No changed files right now."
        compact
      />
    </div>
  {:else}
    <ul class="review-files">
      {#each files as file (file.path)}
        <li class="review-row" class:selected={selectedPath === file.path}>
          <button
            type="button"
            class="review-btn"
            title={file.path}
            onclick={() => void selectFile(file.path)}
          >
            <span class="kind mono">{kindLabel(file.kind)}</span>
            <span class="path mono">{fileLabel(file.path)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="review-preview">
    {#if patchLoading}
      <p class="review-hint">Loading GetFileDiff…</p>
    {:else}
      <FilePreview
        path={selectedPath || undefined}
        content={patch || undefined}
        emptyMessage={selectedPath ? "Empty diff" : "Select a changed file"}
        language={selectedPath ? "diff" : undefined}
      />
    {/if}
    {#if error && selectedPath}
      <p class="review-error" role="alert">{error}</p>
    {/if}
  </div>
</div>

<style>
  .review-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: var(--space-1);
  }

  .review-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0 var(--space-3);
    min-height: var(--space-8);
  }

  .diff-stats {
    display: inline-flex;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-family: var(--font-mono, var(--mono));
    margin-left: auto;
  }

  .plus {
    color: var(--success, var(--ok, var(--muted)));
  }

  .minus {
    color: var(--danger, var(--muted));
  }

  :global(.review-refresh) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .review-banner {
    margin: 0 var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger, var(--muted)) 12%, transparent);
    color: var(--text);
    font-size: var(--text-xs);
  }

  .review-banner.muted {
    background: var(--elevated);
    color: var(--muted);
  }

  .review-empty {
    padding: var(--space-2);
  }

  .review-hint {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--faint);
    font-size: var(--text-xs);
  }

  .review-files {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-2);
    flex: 0 1 auto;
    max-height: 40%;
    overflow: auto;
  }

  .review-row {
    margin: 0;
  }

  .review-row.selected .review-btn {
    background: var(--elevated);
    color: var(--text);
  }

  .review-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .review-btn:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--elevated) 70%, transparent);
  }

  .kind {
    flex-shrink: 0;
    width: 1ch;
    font-size: var(--text-xs);
    font-family: var(--font-mono, var(--mono));
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-family: var(--font-mono, var(--mono));
  }

  .review-preview {
    flex: 1;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-soft, var(--border));
    overflow: hidden;
  }

  .review-error {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--danger, var(--muted));
    font-size: var(--text-xs);
  }
</style>
