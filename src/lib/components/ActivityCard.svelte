<script lang="ts">
  import type { ActivityMeta } from "$lib/harnessEventReducer";

  let {
    activity,
  }: {
    activity: ActivityMeta;
  } = $props();

  let expanded = $state(false);

  const statusKey = $derived(activity.status.trim().toLowerCase());
  const hasDetail = $derived(Boolean(activity.detail?.trim()));

  const headerSnip = $derived.by(() => {
    const d = activity.detail?.trim() ?? "";
    if (!d || expanded) return "";
    return d.length <= 72 ? d : `${d.slice(0, 72)}…`;
  });

  function toggle() {
    if (hasDetail) expanded = !expanded;
  }
</script>

<button
  type="button"
  class="activity"
  data-status={statusKey || undefined}
  aria-expanded={expanded}
  disabled={!hasDetail}
  onclick={toggle}
>
  <span class="row">
    <span class="dot" aria-hidden="true"></span>
    <span class="title">{activity.title}</span>
    {#if headerSnip}
      <span class="snip">{headerSnip}</span>
    {/if}
  </span>
  {#if expanded && activity.detail}
    <pre class="detail">{activity.detail}</pre>
  {/if}
</button>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-soft, var(--border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    color: var(--muted);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .activity:disabled {
    cursor: default;
  }

  .activity:not(:disabled):hover {
    border-color: var(--border);
    color: var(--text);
  }

  .activity:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--faint);
    transform: translateY(-1px);
  }

  .activity[data-status="running"] .dot {
    background: var(--muted);
  }

  .activity[data-status="done"] .dot {
    background: var(--success);
  }

  .activity[data-status="error"] .dot {
    background: var(--danger);
  }

  .title {
    flex: 0 1 auto;
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
    color: var(--text);
    white-space: nowrap;
  }

  .snip {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--faint);
  }

  .detail {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
    line-height: 1.45;
    color: var(--muted);
  }
</style>
