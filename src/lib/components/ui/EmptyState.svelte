<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    icon,
    title,
    description,
    compact = false,
    class: className = "",
    children,
  }: {
    icon: string;
    title: string;
    description?: string;
    compact?: boolean;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="ui-empty {className}" class:ui-empty--compact={compact} role="status">
  <div class="ui-empty__icon" aria-hidden="true">
    <Icon name={icon} size={compact ? 18 : 22} strokeWidth={1.75} />
  </div>
  <h3 class="ui-empty__title">{title}</h3>
  {#if description}
    <p class="ui-empty__desc">{description}</p>
  {/if}
  {#if children}
    <div class="ui-empty__cta">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .ui-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-4);
    text-align: center;
  }

  .ui-empty--compact {
    padding: var(--space-4) var(--space-2);
    gap: var(--space-2);
  }

  .ui-empty__icon {
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  .ui-empty--compact .ui-empty__icon {
    width: auto;
    height: auto;
    background: transparent;
    border: 0;
  }

  .ui-empty__title {
    margin: 0;
    max-width: 28ch;
    font-size: var(--text-md);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .ui-empty--compact .ui-empty__title {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .ui-empty__desc {
    margin: 0;
    max-width: 36ch;
    font-size: var(--text-sm);
    font-weight: var(--font-regular);
    color: var(--muted);
    line-height: 1.45;
  }

  .ui-empty--compact .ui-empty__desc {
    font-size: var(--text-xs);
    max-width: 22ch;
  }

  .ui-empty__cta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
