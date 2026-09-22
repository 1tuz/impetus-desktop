<script lang="ts">
  import { Button, Card, Icon } from "$lib/components/ui";
  import "$lib/components/shell.css";

  type DaemonProbe = {
    socket_path: string;
    socket_exists: boolean;
    reachable: boolean;
    detail: string;
  };

  let {
    open = $bindable(false),
    step = $bindable(0),
    probe = null as DaemonProbe | null,
    busy = false,
    onProbe,
    onConnect,
    onFinish,
    onSkip,
  }: {
    open?: boolean;
    step?: number;
    probe?: DaemonProbe | null;
    busy?: boolean;
    onProbe: () => unknown | Promise<unknown>;
    onConnect: () => Promise<boolean>;
    onFinish: () => void;
    onSkip: () => void;
  } = $props();

  async function connectThenFinish() {
    const ok = await onConnect();
    if (ok) onFinish();
  }

  $effect(() => {
    if (!open) return;
    if (probe?.reachable && step === 0) step = 1;
  });
</script>

{#if open}
  <div class="shell-scrim">
    <Card class="setup-card" padding="lg">
      <p class="eyebrow">first run</p>
      <h2 class="title">Connect to impetusd</h2>
      <p class="lede">
        Impetus Desktop talks to the local daemon over a Unix socket. No macOS privacy
        permissions (Accessibility, Screen Recording, Full Disk) are required for this.
      </p>

      <ol class="steps">
        <li class:active={step === 0} class:done={step > 0}>
          <span class="n">1</span>
          <div>
            <strong>Is the daemon running?</strong>
            <p class="muted">
              {#if probe}
                {#if probe.reachable}
                  Socket reachable.
                {:else}
                  {probe.detail}
                {/if}
                <br />
                <code class="mono faint">{probe.socket_path}</code>
              {:else}
                Probing socket…
              {/if}
            </p>
            <Button variant="ghost" size="sm" disabled={busy} onclick={() => void onProbe()}>
              Re-check
            </Button>
          </div>
        </li>
        <li class:active={step === 1} class:done={step > 1}>
          <span class="n">2</span>
          <div>
            <strong>Handshake</strong>
            <p class="muted">Connect when the socket is up. You can also skip and connect later from the sidebar.</p>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !probe?.reachable}
              onclick={() => void connectThenFinish()}
            >
              <Icon name="plug" size={14} />
              Connect
            </Button>
          </div>
        </li>
      </ol>

      <div class="setup-actions">
        <Button variant="ghost" onclick={onSkip}>Skip for now</Button>
        <Button variant="secondary" disabled={!probe?.reachable} onclick={onFinish}>
          Continue
        </Button>
      </div>
    </Card>
  </div>
{/if}

<style>
  :global(.setup-card) {
    width: min(480px, 100%);
  }

  .eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: var(--font-medium);
  }

  .title {
    margin: var(--space-2) 0 var(--space-2);
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
    letter-spacing: -0.02em;
  }

  .lede {
    margin: 0 0 var(--space-5);
    color: var(--muted);
    line-height: 1.5;
    font-size: var(--text-base);
    font-weight: var(--font-regular);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .steps li {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: var(--space-3);
    opacity: 0.55;
  }

  .steps li.active,
  .steps li.done {
    opacity: 1;
  }

  .steps .n {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    display: grid;
    place-items: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .steps li.active .n {
    border-color: var(--border);
    color: var(--text);
  }

  .steps strong {
    display: block;
    margin-bottom: var(--space-1);
    font-size: var(--text-md);
    font-weight: var(--font-medium);
  }

  .muted {
    color: var(--muted);
    margin: 0 0 var(--space-2);
    line-height: 1.45;
    font-size: var(--text-sm);
  }

  .faint {
    color: var(--faint);
  }

  .setup-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-soft);
  }
</style>
