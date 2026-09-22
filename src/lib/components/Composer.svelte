<script lang="ts">
  import AttachMenu from "$lib/components/AttachMenu.svelte";
  import BranchSelect from "$lib/components/BranchSelect.svelte";
  import ModeSelect from "$lib/components/ModeSelect.svelte";
  import { Button, Icon, Input } from "$lib/components/ui";
  import type { AttachActionId } from "$lib/attachMenu";
  import type { AgentModeId, PromptIntentId } from "$lib/agentModes";
  import { promptIntentLabel } from "$lib/agentModes";
  import type { ComposerAttachment } from "$lib/composerAttachments";
  import { collectPastedImages, readImagesFromClipboardApi } from "$lib/composerAttachments";
  import "$lib/components/shell.css";

  let {
    promptText = $bindable(""),
    approvalId = $bindable(""),
    agentMode = $bindable("ask" as AgentModeId),
    promptIntent = $bindable("prompt" as PromptIntentId),
    attachments = $bindable([] as ComposerAttachment[]),
    workspaceRoot = "",
    approvalSummary = "",
    pendingApproval = false,
    busy = false,
    turnActive = false,
    connected = false,
    selectedSessionId = "",
    attachOpen = $bindable(false),
    modeOpen = $bindable(false),
    dropActive = false,
    promptEl = $bindable(null as HTMLTextAreaElement | null),
    onSend,
    onCancel,
    onResolve,
    onAttachAction,
    onMcpSelect,
    onPasteImages,
    onRemoveAttachment,
    onModeChange,
  }: {
    promptText?: string;
    approvalId?: string;
    agentMode?: AgentModeId;
    promptIntent?: PromptIntentId;
    attachments?: ComposerAttachment[];
    workspaceRoot?: string;
    approvalSummary?: string;
    pendingApproval?: boolean;
    busy?: boolean;
    turnActive?: boolean;
    connected?: boolean;
    selectedSessionId?: string;
    attachOpen?: boolean;
    modeOpen?: boolean;
    dropActive?: boolean;
    promptEl?: HTMLTextAreaElement | null;
    onSend: () => void;
    onCancel: () => void;
    onResolve: (accept: boolean) => void;
    onAttachAction: (id: AttachActionId) => void;
    onMcpSelect: (id: string) => void;
    onPasteImages: (files: File[]) => void;
    onRemoveAttachment: (id: string) => void;
    onModeChange?: (id: AgentModeId) => void;
  } = $props();

  // Gate Send only on IPC busy — Steer/FollowUp allowed while turn is active.
  const canSend = $derived(!busy && (!!promptText.trim() || attachments.length > 0));
  const canCancel = $derived(turnActive && !!selectedSessionId);
  let previewIndex = $state<number | null>(null);

  const previewAtt = $derived(
    previewIndex !== null ? (attachments[previewIndex] ?? null) : null,
  );

  function toggleAttach() {
    modeOpen = false;
    attachOpen = !attachOpen;
  }

  function openPreview(index: number) {
    if (!attachments[index]?.previewUrl) return;
    previewIndex = index;
  }

  function closePreview() {
    previewIndex = null;
  }

  function previewStep(delta: number) {
    if (previewIndex === null || attachments.length === 0) return;
    const withPreview = attachments
      .map((a, i) => (a.previewUrl ? i : -1))
      .filter((i) => i >= 0);
    if (!withPreview.length) return;
    const pos = withPreview.indexOf(previewIndex);
    const next = withPreview[(pos + delta + withPreview.length) % withPreview.length]!;
    previewIndex = next;
  }

  function onPaste(e: ClipboardEvent) {
    const files = collectPastedImages(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      e.stopPropagation();
      onPasteImages(files);
      return;
    }
    // Paste event often has empty clipboardData for images in embedded browsers.
    void readImagesFromClipboardApi().then((asyncFiles) => {
      if (asyncFiles.length) onPasteImages(asyncFiles);
    });
  }

  function onPreviewKey(e: KeyboardEvent) {
    if (previewIndex === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePreview();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      previewStep(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      previewStep(1);
    }
  }

  $effect(() => {
    if (modeOpen) attachOpen = false;
  });

  $effect(() => {
    if (previewIndex === null) return;
    if (previewIndex >= attachments.length) {
      previewIndex = attachments.length ? attachments.length - 1 : null;
    }
  });
</script>

<svelte:window onpaste={onPaste} onkeydown={onPreviewKey} />

{#if previewAtt}
  <div class="preview-scrim" role="presentation">
    <button
      type="button"
      class="preview-backdrop"
      aria-label="Close preview"
      onclick={closePreview}
    ></button>
    <div class="preview-stage" role="dialog" aria-modal="true" aria-label="Image preview">
      <div class="preview-bar">
        <span class="preview-name mono">{previewAtt.name}</span>
        <span class="preview-count">
          {(previewIndex ?? 0) + 1}/{attachments.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="preview-close"
          title="Close (Esc)"
          aria-label="Close preview"
          onclick={closePreview}
        >
          <Icon name="x" size={16} />
        </Button>
      </div>
      <div class="preview-body">
        {#if attachments.length > 1}
          <Button
            variant="ghost"
            size="icon"
            class="preview-nav"
            title="Previous"
            aria-label="Previous image"
            onclick={() => previewStep(-1)}
          >
            <Icon name="chevron-left" size={20} />
          </Button>
        {/if}
        <img class="preview-img" src={previewAtt.previewUrl} alt={previewAtt.name} />
        {#if attachments.length > 1}
          <Button
            variant="ghost"
            size="icon"
            class="preview-nav"
            title="Next"
            aria-label="Next image"
            onclick={() => previewStep(1)}
          >
            <Icon name="chevron-right" size={20} />
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if pendingApproval}
  <div class="approval">
    <span class="shell-label">Approval</span>
    {#if approvalSummary}
      <span class="approval-summary" title={approvalSummary}>{approvalSummary}</span>
    {/if}
    <Input
      mono
      placeholder={approvalId ? "approval id (auto)" : "approval uuid"}
      bind:value={approvalId}
      class="approval-field"
    />
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => onResolve(true)}>
      Accept
    </Button>
    <Button variant="danger" size="sm" disabled={busy} onclick={() => onResolve(false)}>
      Deny
    </Button>
  </div>
{/if}

<footer class="composer-wrap">
  <div class="composer-stack">
    <AttachMenu
      bind:open={attachOpen}
      {workspaceRoot}
      {connected}
      {busy}
      onAction={onAttachAction}
      onMcpSelect={onMcpSelect}
    />
    <div class="composer-pill" class:drop-active={dropActive}>
      {#if attachments.length > 0}
        <div class="attach-row" aria-label="Attached images">
          {#each attachments as att, i (att.id)}
            <div class="thumb">
              {#if att.previewUrl}
                <button
                  type="button"
                  class="thumb-open"
                  title="Preview"
                  aria-label="Preview {att.name}"
                  onclick={() => openPreview(i)}
                >
                  <img src={att.previewUrl} alt={att.name} />
                </button>
              {:else}
                <span class="thumb-fallback" title={att.path ?? att.name}>{att.name}</span>
              {/if}
              <button
                type="button"
                class="thumb-x"
                title="Remove"
                aria-label="Remove {att.name}"
                disabled={busy}
                onclick={() => onRemoveAttachment(att.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="composer-row">
        <Button
          variant="ghost"
          size="icon"
          class="composer-plus"
          title="Files, workspace, chat, model, MCP"
          aria-label="Open attach menu"
          aria-expanded={attachOpen}
          disabled={busy}
          onclick={toggleAttach}
        >
          <Icon name="plus" size={18} />
        </Button>
        <ModeSelect
          bind:mode={agentMode}
          bind:open={modeOpen}
          disabled={busy}
          onChange={onModeChange}
        />
        {#if promptIntent !== "prompt"}
          <span class="intent-chip" title="Prompt intent (Ctrl+Shift+P cycles · Ctrl+T steers)">
            {promptIntentLabel(promptIntent)}
          </span>
        {/if}
        <textarea
          class="composer-input"
          rows="1"
          placeholder={selectedSessionId ? "Send follow-up" : "Message Impetus…"}
          bind:value={promptText}
          bind:this={promptEl}
          onkeydown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSend();
            }
          }}
        ></textarea>
        {#if canCancel}
          <Button
            variant="primary"
            size="icon"
            class="composer-send"
            title="Stop"
            aria-label="Stop"
            onclick={onCancel}
          >
            <Icon name="square" size={14} />
          </Button>
        {:else}
          <Button
            variant={canSend ? "primary" : "ghost"}
            size="icon"
            class="composer-send"
            title={connected ? "Send" : "Send — connect first if offline"}
            aria-label="Send"
            disabled={!canSend}
            onclick={onSend}
          >
            <Icon name="arrow-up" size={16} />
          </Button>
        {/if}
      </div>
    </div>
    <div class="composer-meta">
      <BranchSelect {workspaceRoot} />
    </div>
  </div>
</footer>

<style>
  .approval {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-5);
    border-top: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border));
    background: color-mix(in srgb, var(--warn) 8%, var(--bg));
  }

  .approval-summary {
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  :global(.approval-field) {
    flex: 1;
  }

  .intent-chip {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-md);
    background: var(--elevated);
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-transform: lowercase;
  }

  .composer-wrap {
    padding: var(--space-2) var(--space-5) var(--space-4);
    background: transparent;
  }

  .composer-stack {
    position: relative;
  }

  .composer-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) 0;
    min-height: var(--space-6);
  }

  .composer-pill {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    transition:
      border-color var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }

  .composer-pill.drop-active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .attach-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 0;
  }

  .thumb {
    position: relative;
    width: 72px;
    height: 54px;
    border-radius: var(--radius-md);
    overflow: visible;
    flex-shrink: 0;
  }

  .thumb-open {
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-in;
  }

  .thumb img,
  .thumb-open img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--elevated);
  }

  .thumb-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--elevated);
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }

  .thumb-x {
    position: absolute;
    top: -6px;
    right: -6px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--elevated);
    color: var(--text);
    cursor: pointer;
    box-shadow: var(--shadow-sm);
  }

  .thumb-x:hover:not(:disabled) {
    background: var(--surface);
  }

  .thumb-x:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .preview-scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
  }

  .preview-backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(8px);
    cursor: default;
  }

  .preview-stage {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: min(920px, 100%);
    max-height: min(860px, 100%);
    width: 100%;
  }

  .preview-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-1);
  }

  .preview-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: var(--text-sm);
  }

  .preview-count {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .preview-body {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 0;
  }

  .preview-img {
    display: block;
    max-width: 100%;
    max-height: min(72vh, 720px);
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--elevated);
    box-shadow: var(--shadow-md);
  }

  :global(.preview-nav),
  :global(.preview-close) {
    flex-shrink: 0;
    color: var(--muted);
  }

  .composer-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .composer-input {
    flex: 1;
    min-width: 0;
    min-height: 36px;
    max-height: 160px;
    resize: none;
    border: 0;
    background: transparent;
    color: var(--text);
    padding: var(--space-2) var(--space-1);
    font-family: var(--font-sans, var(--sans));
    font-size: var(--text-md);
    font-weight: var(--font-regular);
    line-height: 1.45;
    outline: none;
  }

  .composer-input::placeholder {
    color: var(--muted);
  }

  /* Send: filled --text circle, --bg arrow — readable in light and dark. */
  :global(.composer-pill .composer-plus),
  :global(.composer-pill .composer-send) {
    flex-shrink: 0;
    align-self: center;
  }

  :global(.composer-pill .composer-plus) {
    color: var(--muted);
  }

  :global(.composer-pill .composer-send.ui-btn--ghost) {
    color: var(--muted);
  }

  :global(.composer-pill .composer-send.ui-btn--primary) {
    background: var(--text);
    color: var(--bg);
    border-color: transparent;
  }

  :global(.composer-pill .composer-send.ui-btn--primary:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--text) 82%, var(--muted));
    color: var(--bg);
  }

  :global(.composer-pill .composer-send:disabled) {
    opacity: 0.35;
  }
</style>
