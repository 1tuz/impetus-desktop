<script lang="ts">
  import { Icon } from "$lib/components/ui";
  import { HOTKEY_HELP } from "$lib/hotkeys";

  let {
    items = HOTKEY_HELP,
    title = "Keyboard shortcuts",
  }: {
    items?: { keys: string; action: string }[];
    title?: string;
  } = $props();
</script>

<section class="shortcuts" aria-label={title}>
  <h3 class="title">
    <Icon name="keyboard" size={14} />
    {title}
  </h3>
  <ul>
    {#each items as row (row.keys)}
      <li>
        <kbd class="keys">{row.keys}</kbd>
        <span class="action">{row.action}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .shortcuts {
    margin: 0;
  }

  .title {
    margin: 0 0 var(--space-2);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: var(--font-medium);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .keys {
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-xs);
    color: var(--accent);
    background: var(--elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    white-space: nowrap;
  }

  .action {
    color: var(--muted);
    text-align: right;
    font-weight: var(--font-regular);
  }
</style>
