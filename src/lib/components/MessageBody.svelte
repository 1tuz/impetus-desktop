<script lang="ts">
  import { Icon } from "$lib/components/ui";
  import {
    pathBasename,
    splitMessageBody,
    type PathMentionKind,
  } from "$lib/pathMentions";

  let {
    text = "",
    onOpenPath,
  }: {
    text?: string;
    onOpenPath?: (path: string, kind: PathMentionKind) => void;
  } = $props();

  const parts = $derived(splitMessageBody(text));

  function chipLabel(kind: PathMentionKind, path: string): string {
    const name = pathBasename(path);
    if (kind === "image") return `Open image ${name}`;
    if (kind === "text") return `Open file ${name}`;
    return `Open ${name}`;
  }
</script>

<div class="message-body">
  {#each parts as part, i (part.type === "path" ? `p:${part.path}:${i}` : `t:${i}`)}
    {#if part.type === "text"}
      {#if part.text.length > 0}
        <pre class="body-text">{part.text}</pre>
      {/if}
    {:else}
      <button
        type="button"
        class="path-chip"
        class:is-image={part.kind === "image"}
        data-kind={part.kind}
        title={part.path}
        aria-label={chipLabel(part.kind, part.path)}
        onclick={() => onOpenPath?.(part.path, part.kind)}
      >
        <Icon name="file" size={12} />
        <span class="chip-name mono">{pathBasename(part.path)}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .message-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .body-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-sans, var(--sans));
    font-size: var(--text-md);
    line-height: 1.55;
    padding: 0;
    border: 0;
    background: transparent;
    font-weight: var(--font-regular);
    color: inherit;
    width: 100%;
  }

  .path-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin: 0;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border, color-mix(in srgb, var(--muted) 35%, transparent));
    border-radius: var(--radius-sm, 6px);
    background: color-mix(in srgb, var(--surface, var(--bg)) 88%, transparent);
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1.3;
    cursor: pointer;
  }

  .path-chip.is-image {
    border-color: color-mix(in srgb, var(--accent, var(--text)) 35%, transparent);
    color: var(--text);
  }

  .path-chip:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--muted) 55%, transparent);
  }

  .path-chip.is-image:hover {
    border-color: color-mix(in srgb, var(--accent, var(--text)) 55%, transparent);
  }

  .path-chip:focus-visible {
    outline: 2px solid var(--accent, var(--text));
    outline-offset: 2px;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
