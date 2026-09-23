<script lang="ts">
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import ActivityCard from "$lib/components/ActivityCard.svelte";
  import FilePreview from "$lib/components/FilePreview.svelte";
  import MessageBody from "$lib/components/MessageBody.svelte";
  import { Button, EmptyState, Icon } from "$lib/components/ui";
  import { isImageMime, isImagePath } from "$lib/composerAttachments";
  import type { Msg, MsgAttachment } from "$lib/harnessEventReducer";
  import {
    pathBasename,
    toFileUrl,
    type PathMentionKind,
  } from "$lib/pathMentions";

  let {
    messages = [],
    connected = false,
    runtimePhase = "offline" as
      | "starting"
      | "connected"
      | "reconnecting"
      | "offline"
      | "incompatible"
      | "failed",
    hasSession = false,
    scrollEl = $bindable(null as HTMLElement | null),
    onOpenPath,
  }: {
    messages?: Msg[];
    connected?: boolean;
    runtimePhase?:
      | "starting"
      | "connected"
      | "reconnecting"
      | "offline"
      | "incompatible"
      | "failed";
    hasSession?: boolean;
    scrollEl?: HTMLElement | null;
    /** Optional override — default opens file:// via Tauri open_external / image lightbox. */
    onOpenPath?: (path: string, kind?: PathMentionKind) => void;
  } = $props();

  let lightboxPath = $state<string | null>(null);
  let chipPreview = $state<MsgAttachment | null>(null);

  const connecting = $derived(
    runtimePhase === "starting" || runtimePhase === "reconnecting",
  );

  const emptyTitle = $derived(
    !connected
      ? connecting
        ? "Connecting to Runtime…"
        : runtimePhase === "incompatible"
          ? "Runtime incompatible"
          : runtimePhase === "failed"
            ? "Runtime failed"
            : "Runtime offline"
      : !hasSession
        ? "Open a session"
        : "What should we work on?",
  );

  const emptyDesc = $derived(
    !connected
      ? connecting
        ? "Starting local Runtime — you can draft a message below."
        : runtimePhase === "incompatible"
          ? "Upgrade Desktop or impetusd, then Preferences → Restart Runtime."
          : runtimePhase === "failed"
            ? "Try Reconnect in the topbar, or Preferences → Restart Runtime."
            : "Runtime will reconnect automatically, or use Preferences → Restart Runtime."
      : !hasSession
        ? "Open a workspace (folder +), then New Chat."
        : "Type below, attach files with +, or drop onto the chat.",
  );

  const lightboxSrc = $derived(
    lightboxPath && inTauriShell() ? convertFileSrc(lightboxPath) : "",
  );

  const chipIsImage = $derived(chipPreview ? attachmentIsImage(chipPreview) : false);

  const chipPreviewUrl = $derived.by(() => {
    if (!chipPreview) return "";
    if (chipPreview.previewUrl?.trim()) return chipPreview.previewUrl;
    if (chipPreview.path && inTauriShell() && chipIsImage) {
      return convertFileSrc(chipPreview.path);
    }
    return "";
  });

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function isActivity(msg: Msg): boolean {
    return msg.kind === "activity" || Boolean(msg.activity);
  }

  function attachmentIsImage(att: MsgAttachment): boolean {
    if (att.mime && isImageMime(att.mime)) return true;
    if (att.path && isImagePath(att.path)) return true;
    if (att.previewUrl?.trim() && !att.path) return true;
    return false;
  }

  function closeLightbox() {
    lightboxPath = null;
  }

  function closeChipPreview() {
    chipPreview = null;
  }

  function onLightboxKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (chipPreview) {
      e.preventDefault();
      closeChipPreview();
      return;
    }
    if (lightboxPath) {
      e.preventDefault();
      closeLightbox();
    }
  }

  async function openExternalFile(path: string) {
    if (!inTauriShell()) return;
    try {
      await invoke("open_external", { url: toFileUrl(path) });
    } catch {
      /* ignore — quiet shell */
    }
  }

  function handleOpenPath(path: string, kind: PathMentionKind) {
    if (onOpenPath) {
      onOpenPath(path, kind);
      return;
    }
    if (kind === "image") {
      lightboxPath = path;
      return;
    }
    void openExternalFile(path);
  }

  function openChip(att: MsgAttachment) {
    chipPreview = att;
  }

  async function openLightboxInOs() {
    if (!lightboxPath) return;
    await openExternalFile(lightboxPath);
  }

  async function openChipInOs() {
    if (!chipPreview?.path) return;
    await openExternalFile(chipPreview.path);
  }

  function chipThumbSrc(att: MsgAttachment): string {
    if (att.previewUrl?.trim()) return att.previewUrl;
    if (att.path && inTauriShell() && attachmentIsImage(att)) {
      return convertFileSrc(att.path);
    }
    return "";
  }
</script>

<svelte:window onkeydown={onLightboxKey} />

{#if lightboxPath}
  <div class="preview-scrim" role="presentation">
    <button
      type="button"
      class="preview-backdrop"
      aria-label="Close preview"
      onclick={closeLightbox}
    ></button>
    <div class="preview-stage" role="dialog" aria-modal="true" aria-label="Image preview">
      <div class="preview-bar">
        <span class="preview-name mono">{pathBasename(lightboxPath)}</span>
        <Button
          variant="ghost"
          size="icon"
          class="preview-close"
          title="Open in OS"
          aria-label="Open in OS"
          onclick={openLightboxInOs}
        >
          <Icon name="folder" size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="preview-close"
          title="Close (Esc)"
          aria-label="Close preview"
          onclick={closeLightbox}
        >
          <Icon name="x" size={16} />
        </Button>
      </div>
      <div class="preview-body">
        {#if lightboxSrc}
          <img class="preview-img" src={lightboxSrc} alt={pathBasename(lightboxPath)} />
        {:else}
          <p class="preview-fallback mono">{lightboxPath}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if chipPreview}
  <div class="preview-scrim" role="presentation">
    <button
      type="button"
      class="preview-backdrop"
      aria-label="Close preview"
      onclick={closeChipPreview}
    ></button>
    <div
      class="preview-stage"
      class:file-stage={!chipIsImage}
      role="dialog"
      aria-modal="true"
      aria-label={chipIsImage ? "Attachment preview" : "Attachment"}
    >
      <div class="preview-bar">
        <span class="preview-name mono">{chipPreview.name}</span>
        {#if chipPreview.path}
          <Button
            variant="ghost"
            size="icon"
            class="preview-close"
            title="Open in OS"
            aria-label="Open in OS"
            onclick={openChipInOs}
          >
            <Icon name="folder" size={16} />
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="icon"
          class="preview-close"
          title="Close (Esc)"
          aria-label="Close preview"
          onclick={closeChipPreview}
        >
          <Icon name="x" size={16} />
        </Button>
      </div>
      <div class="preview-body">
        {#if chipIsImage && chipPreviewUrl}
          <FilePreview
            path={chipPreview.path ?? chipPreview.name}
            previewUrl={chipPreviewUrl}
            mime={chipPreview.mime ?? "image/*"}
          />
        {:else}
          <div class="file-chip-modal">
            <p class="preview-fallback mono">{chipPreview.path ?? chipPreview.name}</p>
            {#if chipPreview.path}
              <Button variant="secondary" size="sm" onclick={openChipInOs}>
                Open
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<div class="transcript selectable" bind:this={scrollEl}>
  {#if messages.length === 0}
    <EmptyState icon="sparkles" title={emptyTitle} description={emptyDesc} />
  {:else}
    {#each messages as msg (msg.id)}
      <article class="msg" data-role={msg.role} data-kind={msg.kind ?? "text"}>
        <div class="role">{msg.role}</div>
        {#if isActivity(msg) && msg.activity}
          <ActivityCard activity={msg.activity} />
        {:else}
          <MessageBody text={msg.text} onOpenPath={handleOpenPath} />
          {#if msg.role === "user" && msg.attachments?.length}
            <div class="msg-atts" aria-label="Attachments">
              {#each msg.attachments as att, i (`${msg.id}-att-${i}`)}
                {@const thumb = chipThumbSrc(att)}
                <button
                  type="button"
                  class="att-chip"
                  class:has-thumb={Boolean(thumb)}
                  title={att.path ?? att.name}
                  aria-label="Open {att.name}"
                  onclick={() => openChip(att)}
                >
                  {#if thumb}
                    <img src={thumb} alt="" />
                  {:else}
                    <Icon name="file" size={14} />
                    <span class="att-name">{att.name}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </article>
    {/each}
  {/if}
</div>

<style>
  .transcript {
    flex: 1;
    overflow: auto;
    padding: var(--space-4) var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .msg {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .msg .role {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: var(--space-2);
    font-weight: var(--font-medium);
  }

  .msg[data-role="user"] {
    color: var(--muted);
  }

  .msg[data-role="system"] {
    color: var(--faint);
    font-size: var(--text-sm);
  }

  .msg[data-role="tool"] {
    color: var(--muted);
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
  }

  .msg-atts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .att-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 12rem;
    padding: 0;
    border: 1px solid var(--border-soft, var(--border));
    border-radius: var(--radius-sm, 6px);
    background: var(--surface, var(--elevated));
    color: var(--muted);
    cursor: pointer;
    overflow: hidden;
  }

  .att-chip:not(.has-thumb) {
    padding: var(--space-1) var(--space-2);
  }

  .att-chip.has-thumb {
    width: 3rem;
    height: 3rem;
  }

  .att-chip img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .att-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
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

  .preview-stage.file-stage {
    max-width: min(480px, 100%);
  }

  .preview-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2rem;
  }

  .preview-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .preview-body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    flex: 1;
  }

  .preview-img {
    max-width: 100%;
    max-height: min(720px, 80vh);
    object-fit: contain;
    border-radius: var(--radius-sm, 6px);
  }

  .preview-fallback {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
    word-break: break-all;
  }

  .file-chip-modal {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface, var(--elevated));
    border: 1px solid var(--border-soft, var(--border));
    border-radius: var(--radius-sm, 6px);
    width: 100%;
  }
</style>
