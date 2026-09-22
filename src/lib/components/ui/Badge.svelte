<script lang="ts">
  import type { Snippet } from "svelte";

  type Tone = "default" | "success" | "warning" | "danger" | "accent";

  let {
    tone = "default",
    class: className = "",
    children,
  }: {
    tone?: Tone;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<span class="ui-badge ui-badge--{tone} {className}">
  {#if children}
    {@render children()}
  {/if}
</span>

<style>
  .ui-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: calc(var(--space-1) / 2) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    font-family: var(--font-sans, var(--sans));
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: 1.2;
    white-space: nowrap;
  }

  .ui-badge--default {
    color: var(--muted);
    background: color-mix(in srgb, var(--surface-alt, var(--elevated)) 80%, transparent);
    border-color: var(--border);
  }

  .ui-badge--success {
    color: var(--success, var(--ok));
    background: color-mix(in srgb, var(--success, var(--ok)) 14%, transparent);
    border-color: color-mix(in srgb, var(--success, var(--ok)) 35%, var(--border));
  }

  .ui-badge--warning {
    color: var(--warning, var(--warn));
    background: color-mix(in srgb, var(--warning, var(--warn)) 14%, transparent);
    border-color: color-mix(in srgb, var(--warning, var(--warn)) 35%, var(--border));
  }

  .ui-badge--danger {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .ui-badge--accent {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }
</style>
