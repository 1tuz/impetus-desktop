<script lang="ts">
  import { EmptyState } from "$lib/components/ui";

  type Role = "system" | "user" | "assistant" | "tool";
  type Msg = { id: string; role: Role; text: string; ts: number };

  let {
    messages = [],
    connected = false,
    hasSession = false,
    scrollEl = $bindable(null as HTMLElement | null),
  }: {
    messages?: Msg[];
    connected?: boolean;
    hasSession?: boolean;
    scrollEl?: HTMLElement | null;
  } = $props();

  const emptyTitle = $derived(
    !connected
      ? "Connect to get started"
      : !hasSession
        ? "Open a session"
        : "What should we work on?",
  );

  const emptyDesc = $derived(
    !connected
      ? "Start impetusd, then New Chat."
      : !hasSession
        ? "Open a workspace (folder +), then New Chat."
        : "Type below, attach files with +, or drop onto the chat.",
  );
</script>

<div class="transcript selectable" bind:this={scrollEl}>
  {#if messages.length === 0}
    <EmptyState icon="sparkles" title={emptyTitle} description={emptyDesc} />
  {:else}
    {#each messages as msg (msg.id)}
      <article class="msg" data-role={msg.role}>
        <div class="role">{msg.role}</div>
        <pre class="body">{msg.text}</pre>
      </article>
    {/each}
  {/if}
</div>

<style>
  .transcript {
    flex: 1;
    overflow: auto;
    padding: var(--space-4) var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .msg {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .msg .role {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: var(--space-2);
    font-weight: var(--font-medium);
  }

  .msg .body {
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
    color: var(--text);
  }

  .msg[data-role="user"] .body {
    color: var(--muted);
  }

  .msg[data-role="system"] .body {
    color: var(--faint);
    font-size: var(--text-sm);
  }

  .msg[data-role="tool"] .body {
    color: var(--muted);
    font-family: var(--font-mono, var(--mono));
    font-size: var(--text-sm);
  }
</style>
