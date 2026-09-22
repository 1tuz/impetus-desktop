<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "secondary" | "ghost" | "danger";
  type Size = "sm" | "md" | "icon";

  let {
    variant = "secondary",
    size = "md",
    disabled = false,
    type = "button",
    class: className = "",
    children,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    type?: "button" | "submit";
    class?: string;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes, "type" | "disabled" | "class" | "children"> = $props();
</script>

<button
  class="ui-btn ui-btn--{variant} ui-btn--{size} {className}"
  {type}
  {disabled}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  .ui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-family: var(--font-sans, var(--sans));
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease),
      opacity var(--motion-fast) var(--ease);
  }

  .ui-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ui-btn:focus {
    outline: none;
  }

  .ui-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .ui-btn--sm {
    min-height: calc(var(--space-6) + var(--space-1));
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  .ui-btn--md {
    min-height: var(--space-8);
    padding: var(--space-2) var(--space-4);
  }

  .ui-btn--icon {
    width: var(--space-8);
    height: var(--space-8);
    min-height: var(--space-8);
    padding: 0;
    border-radius: var(--radius-full);
  }

  .ui-btn--primary {
    background: var(--accent);
    color: var(--accent-text, var(--bg));
    border-color: var(--accent);
  }

  .ui-btn--primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, var(--text));
  }

  .ui-btn--secondary {
    background: var(--surface, var(--elevated));
    color: var(--text);
    border-color: var(--border);
  }

  .ui-btn--secondary:hover:not(:disabled) {
    background: var(--surface-alt, var(--elevated));
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .ui-btn--ghost {
    background: transparent;
    color: var(--text);
    border-color: transparent;
  }

  .ui-btn--ghost:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-alt, var(--elevated)) 70%, transparent);
  }

  .ui-btn--danger {
    background: color-mix(in srgb, var(--danger) 14%, var(--surface, var(--elevated)));
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  }

  .ui-btn--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 22%, var(--surface, var(--elevated)));
  }
</style>
