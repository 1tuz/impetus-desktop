<script lang="ts">
  import { AGENT_MODES, type AgentModeId, agentModeById } from "$lib/agentModes";
  import { Icon } from "$lib/components/ui";

  let {
    mode = $bindable("ask" as AgentModeId),
    open = $bindable(false),
    disabled = false,
    onChange,
  }: {
    mode?: AgentModeId;
    open?: boolean;
    disabled?: boolean;
    onChange?: (id: AgentModeId) => void;
  } = $props();

  const current = $derived(agentModeById(mode));

  function pick(id: AgentModeId) {
    mode = id;
    open = false;
    onChange?.(id);
  }

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".mode-select")) {
      open = false;
    }
  }

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  });
</script>

<div class="mode-select">
  <button
    type="button"
    class="mode-trigger"
    title="Agent mode"
    aria-label="Agent mode"
    aria-expanded={open}
    aria-haspopup="listbox"
    {disabled}
    onclick={toggle}
  >
    <span class="mode-label">{current.label}</span>
    <Icon name="chevron-right" size={12} class="mode-chevron" />
  </button>

  {#if open}
    <div class="mode-menu" role="listbox" aria-label="Agent modes">
      {#each AGENT_MODES as item (item.id)}
        <button
          type="button"
          class="mode-row"
          class:on={mode === item.id}
          role="option"
          aria-selected={mode === item.id}
          onclick={() => pick(item.id)}
        >
          <span class="copy">
            <span class="label">{item.label}</span>
            <span class="desc">{item.description}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mode-select {
    position: relative;
    flex-shrink: 0;
  }

  .mode-trigger {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    min-height: 36px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
  }

  .mode-trigger:hover:not(:disabled) {
    color: var(--text);
    background: var(--elevated);
  }

  .mode-trigger:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .mode-label {
    max-width: 10ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.mode-chevron) {
    transform: rotate(90deg);
    opacity: 0.7;
  }

  .mode-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + var(--space-2));
    z-index: var(--z-overlay);
    min-width: 260px;
    max-width: min(360px, 80vw);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .mode-row {
    display: flex;
    align-items: flex-start;
    width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .mode-row:hover,
  .mode-row.on {
    background: var(--elevated);
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: var(--text-md);
    font-weight: var(--font-medium);
  }

  .desc {
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--font-regular);
    line-height: 1.35;
  }
</style>
