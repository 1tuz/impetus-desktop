<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  let {
    value = $bindable(""),
    label,
    placeholder = "",
    mono = false,
    id,
    class: className = "",
    disabled = false,
    type = "text",
    ...rest
  }: {
    value?: string;
    label?: string;
    placeholder?: string;
    mono?: boolean;
    id?: string;
    class?: string;
    disabled?: boolean;
    type?: HTMLInputAttributes["type"];
  } & Omit<
    HTMLInputAttributes,
    "value" | "label" | "placeholder" | "class" | "disabled" | "type" | "id"
  > = $props();

  const inputId = $derived(id ?? (label ? `input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined));
</script>

<label class="ui-field {className}">
  {#if label}
    <span class="ui-field__label">{label}</span>
  {/if}
  <input
    class="ui-input"
    class:ui-input--mono={mono}
    id={inputId}
    {type}
    {placeholder}
    {disabled}
    bind:value
    {...rest}
  />
</label>

<style>
  .ui-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  .ui-field__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--muted);
  }

  .ui-input {
    width: 100%;
    min-height: var(--space-8);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-alt, var(--elevated));
    color: var(--text);
    font-family: var(--font-sans, var(--sans));
    font-size: var(--text-base);
    font-weight: var(--font-regular);
    line-height: 1.3;
    transition:
      border-color var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease),
      background-color var(--motion-fast) var(--ease);
  }

  .ui-input--mono {
    font-family: var(--font-mono, var(--mono));
  }

  .ui-input::placeholder {
    color: var(--muted);
    font-weight: var(--font-regular);
  }

  .ui-input:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }

  .ui-input:focus {
    outline: none;
  }

  .ui-input:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .ui-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
