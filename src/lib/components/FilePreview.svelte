<script lang="ts">
  import { EmptyState } from "$lib/components/ui";
  import "$lib/components/shell.css";

  let {
    path,
    content,
    language,
    emptyMessage = "No file selected",
    previewUrl,
    mime,
  }: {
    path?: string;
    content?: string;
    language?: string;
    emptyMessage?: string;
    previewUrl?: string;
    /** MIME hint — image/* shows img when previewUrl set. */
    mime?: string;
  } = $props();

  const isImage = $derived(
    Boolean(previewUrl?.trim() && mime?.trim().toLowerCase().startsWith("image/")),
  );

  const hasText = $derived(typeof content === "string" && content.length > 0);

  const fileLabel = $derived(
    path?.trim()
      ? (path.split("/").filter(Boolean).pop() ?? path)
      : "",
  );
</script>

<div class="file-preview" aria-label="File preview">
  {#if fileLabel || language}
    <div class="preview-head">
      {#if fileLabel}
        <span class="path mono" title={path}>{fileLabel}</span>
      {/if}
      {#if language}
        <span class="lang shell-label">{language}</span>
      {/if}
    </div>
  {/if}

  {#if isImage && previewUrl}
    <div class="preview-image">
      <img src={previewUrl} alt={fileLabel || "Preview"} />
    </div>
  {:else if hasText}
    <pre class="mono" data-language={language ?? undefined}>{content}</pre>
  {:else}
    <EmptyState
      icon="folder"
      title={emptyMessage}
      description={path?.trim() ? path : undefined}
      compact
    />
  {/if}
</div>

<style>
  .file-preview {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    background: var(--surface, var(--elevated));
    color: var(--text);
  }

  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--space-8);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-soft, var(--border));
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-family: var(--font-mono, var(--mono));
  }

  .lang {
    flex-shrink: 0;
  }

  .preview-image {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: var(--space-4);
  }

  .preview-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  pre.mono {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
    line-height: 1.45;
    white-space: pre;
    color: var(--text);
    background: transparent;
    border: 0;
  }
</style>
