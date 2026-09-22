<script lang="ts">
  import ShortcutsHint from "$lib/ShortcutsHint.svelte";
  import { Button, Icon, Input } from "$lib/components/ui";
  import {
    DEFAULT_APPEARANCE,
    DEFAULT_PACK_ID,
    DEFAULT_THEME_ID,
    THEME_PACKS,
    applyThemePrefs,
    swatchForPack,
    type AppearancePref,
    type ThemePack,
  } from "$lib/themes";
  import "$lib/components/shell.css";

  let {
    open = $bindable(false),
    socketPath = "",
    workspaceRoot = $bindable(""),
    packId = $bindable(DEFAULT_PACK_ID),
    appearance = $bindable<AppearancePref>(DEFAULT_APPEARANCE),
    themeId = $bindable(DEFAULT_THEME_ID),
    connected = false,
    busy = false,
    onOpenSecurity,
    onResetSetup,
    onConnect,
    onDisconnect,
  }: {
    open?: boolean;
    socketPath?: string;
    workspaceRoot?: string;
    packId?: string;
    appearance?: AppearancePref;
    themeId?: string;
    connected?: boolean;
    busy?: boolean;
    onOpenSecurity: () => void | Promise<void>;
    onResetSetup: () => void;
    onConnect: () => void | Promise<unknown>;
    onDisconnect: () => void | Promise<unknown>;
  } = $props();

  function selectPack(id: string) {
    const next = applyThemePrefs(id, appearance);
    packId = next.packId;
    appearance = next.appearance;
    themeId = next.themeId;
  }

  function setAppearance(next: AppearancePref) {
    const applied = applyThemePrefs(packId, next);
    packId = applied.packId;
    appearance = applied.appearance;
    themeId = applied.themeId;
  }

  function close() {
    open = false;
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  const activePack = $derived(
    THEME_PACKS.find((p: ThemePack) => p.id === packId),
  );
</script>

{#if open}
  <div class="shell-scrim prefs-scrim" role="presentation" onclick={onBackdropClick}>
    <div class="prefs-card" role="dialog" aria-labelledby="prefs-title" aria-modal="true">
      <div class="prefs-head">
        <div>
          <p class="eyebrow">settings</p>
          <h2 id="prefs-title">Preferences</h2>
        </div>
        <Button variant="ghost" size="sm" title="Close (Esc)" aria-label="Close" onclick={close}>
          <Icon name="x" size={16} />
        </Button>
      </div>

      <section class="block">
        <div class="shell-label">Daemon</div>
        <p class="hint">
          {connected ? "Connected to impetusd" : "Offline — start impetusd, then Connect"}
        </p>
        <code class="mono socket selectable">{socketPath || "—"}</code>
        <div class="adv-row">
          {#if connected}
            <Button variant="ghost" size="sm" disabled={busy} onclick={() => void onDisconnect()}>
              Disconnect
            </Button>
          {:else}
            <Button variant="primary" size="sm" disabled={busy} onclick={() => void onConnect()}>
              <Icon name="plug" size={14} />
              Connect
            </Button>
          {/if}
        </div>
      </section>

      <section class="block">
        <div class="shell-label">Workspace</div>
        <p class="hint">Optional fallback path — New Chat / Workspace folder + use this root</p>
        <Input
          id="prefs-workspace"
          mono
          placeholder="/optional/fallback"
          bind:value={workspaceRoot}
        />
      </section>

      <section class="block">
        <div class="shell-label">Appearance</div>
        <p class="hint">Dark / Light / System (follow OS) · sun/moon flips Dark↔Light in pack</p>
        <div class="appearance-row" role="group" aria-label="Appearance">
          {#each (["dark", "light", "system"] as const) as opt (opt)}
            <button
              type="button"
              class="appearance-chip"
              class:on={appearance === opt}
              onclick={() => setAppearance(opt)}
            >
              {opt === "dark" ? "Dark" : opt === "light" ? "Light" : "System"}
            </button>
          {/each}
        </div>
      </section>

      <section class="block">
        <div class="shell-label">Theme pack</div>
        <p class="hint">Geek packs with dark+light twins</p>
        <div class="theme-grid">
          {#each THEME_PACKS as p (p.id)}
            <button
              type="button"
              class="theme-chip"
              class:on={packId === p.id}
              onclick={() => selectPack(p.id)}
              title={p.blurb}
            >
              <span class="swatch" style:background={swatchForPack(p)}></span>
              <span class="chip-label">{p.label}</span>
            </button>
          {/each}
        </div>
        <p class="blurb">
          {activePack?.blurb ?? ""}
        </p>
      </section>

      <div class="divider"></div>
      <ShortcutsHint />

      <details class="advanced">
        <summary>Advanced</summary>
        <div class="adv-row">
          <Button variant="ghost" size="sm" onclick={onResetSetup}>
            Show setup wizard again
          </Button>
          <Button variant="ghost" size="sm" onclick={() => void onOpenSecurity()}>
            macOS Security settings…
          </Button>
        </div>
        <p class="hint">
          Security pane is optional — not required for Connect / Prompt. Only opens on explicit
          click here.
        </p>
      </details>
    </div>
  </div>
{/if}

<style>
  .prefs-scrim {
    z-index: calc(var(--z-modal) + 10);
  }

  .prefs-card {
    width: min(480px, 100%);
    max-height: min(86vh, 720px);
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: var(--space-5) var(--space-5) var(--space-4);
    box-shadow: var(--shadow-lg);
  }

  .prefs-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: var(--font-medium);
  }

  h2 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xl);
    font-weight: var(--font-medium);
    letter-spacing: -0.02em;
  }

  .block {
    margin-bottom: var(--space-4);
  }

  .hint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--faint);
    line-height: 1.4;
  }

  .appearance-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-2);
  }

  .appearance-chip {
    border: 1px solid var(--border-soft);
    background: var(--bg);
    color: var(--text);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-regular);
    text-transform: capitalize;
  }

  .appearance-chip:hover {
    border-color: var(--accent-dim);
  }

  .appearance-chip.on {
    border-color: var(--accent-dim);
    background: var(--elevated);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .theme-chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    border: 1px solid var(--border-soft);
    background: var(--bg);
    color: var(--text);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-regular);
  }

  .theme-chip:hover {
    border-color: var(--accent-dim);
  }

  .theme-chip.on {
    border-color: var(--accent-dim);
    background: var(--elevated);
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .blurb {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--faint);
    line-height: 1.4;
  }

  .socket {
    display: block;
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--muted);
    word-break: break-all;
  }

  .divider {
    height: 1px;
    background: var(--border-soft);
    margin: var(--space-1) 0 var(--space-4);
  }

  .advanced {
    margin-top: var(--space-4);
    border-top: 1px solid var(--border-soft);
    padding-top: var(--space-3);
  }

  .advanced summary {
    cursor: pointer;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .adv-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-2);
  }
</style>
