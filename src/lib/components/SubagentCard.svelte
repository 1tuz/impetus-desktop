<script lang="ts">
  let {
    id,
    name = "",
    role = "",
    status = "",
    detail = "",
    durationLabel = "",
  }: {
    id: string;
    name?: string;
    role?: string;
    status?: string;
    detail?: string;
    durationLabel?: string;
  } = $props();

  let expanded = $state(false);

  const title = $derived((name || role || id).trim() || id);
  const statusKey = $derived(status.trim().toLowerCase());
  const hasDetail = $derived(Boolean(detail?.trim()));
  const headerSnip = $derived.by(() => {
    const d = detail?.trim() ?? "";
    if (!d || expanded) return "";
    return d.length <= 72 ? d : `${d.slice(0, 72)}…`;
  });

  function toggle() {
    if (hasDetail) expanded = !expanded;
  }
</script>

<button
  type="button"
  class="subagent"
  data-status={statusKey || undefined}
  aria-expanded={expanded}
  disabled={!hasDetail}
  title={id}
  onclick={toggle}
>
  <span class="row">
    <span class="dot" aria-hidden="true"></span>
    <span class="title">{title}</span>
    {#if status}
      <span class="status">{status}</span>
    {/if}
    {#if durationLabel}
      <span class="dur">{durationLabel}</span>
    {/if}
    {#if headerSnip}
      <span class="snip">{headerSnip}</span>
    {/if}
  </span>
  {#if expanded && detail}
    <pre class="detail">{detail}</pre>
  {/if}
</button>

<style>
  .subagent {
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

  .subagent:disabled {
    cursor: default;
  }

  .subagent:not(:disabled):hover {
    border-color: var(--border);
    color: var(--text);
  }

  .subagent:focus-visible {
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

  .subagent[data-status="running"] .dot,
  .subagent[data-status="active"] .dot,
  .subagent[data-status="in_progress"] .dot {
    background: var(--muted);
  }

  .subagent[data-status="done"] .dot,
  .subagent[data-status="completed"] .dot,
  .subagent[data-status="succeeded"] .dot {
    background: var(--success);
  }

  .subagent[data-status="error"] .dot,
  .subagent[data-status="failed"] .dot {
    background: var(--danger);
  }

  .title {
    flex: 0 1 auto;
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
    color: var(--text);
    white-space: nowrap;
  }

  .status,
  .dur {
    flex: 0 0 auto;
    font-size: var(--text-xs, var(--text-sm));
    color: var(--faint);
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
