<script lang="ts">
  import type { Snippet } from "svelte";

  type Padding = "sm" | "md" | "lg";

  let {
    title,
    padding = "md",
    flat = false,
    class: className = "",
    children,
    action,
  }: {
    title?: string;
    padding?: Padding;
    flat?: boolean;
    class?: string;
    children?: Snippet;
    action?: Snippet;
  } = $props();
</script>

<section
  class="ui-card ui-card--pad-{padding} {className}"
  class:ui-card--flat={flat}
>
  {#if title || action}
    <header class="ui-card__head">
      {#if title}
        <h3 class="ui-card__title">{title}</h3>
      {/if}
      {#if action}
        <div class="ui-card__action">
          {@render action()}
        </div>
      {/if}
    </header>
  {/if}
  {#if children}
    <div class="ui-card__body">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .ui-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface, var(--elevated));
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }

  .ui-card--flat {
    box-shadow: none;
  }

  .ui-card--pad-sm {
    padding: var(--space-3);
  }

  .ui-card--pad-md {
    padding: var(--space-4);
  }

  .ui-card--pad-lg {
    padding: var(--space-5);
  }

  .ui-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .ui-card__title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--font-medium);
    line-height: 1.3;
  }

  .ui-card__action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .ui-card__body {
    min-width: 0;
    font-size: var(--text-base);
    font-weight: var(--font-regular);
    color: var(--text);
  }
</style>
