<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Icon } from "$lib/components/ui";
  import "$lib/components/shell.css";

  /** Catalog row from daemon `list_models` — no client-side model id lists. */
  type ModelProviderDto = {
    provider_id: string;
    model_id: string;
    health: string;
    is_default: boolean;
    provider_display_name?: string | null;
    model_display_name?: string | null;
    availability?: string;
    reasoning_efforts?: string[];
    default_reasoning_effort?: string | null;
    service_tiers?: string[];
    reasoning?: boolean;
  };

  type SessionModelDto = {
    provider_id: string;
    model_id: string;
    reasoning_effort?: string | null;
    service_tier?: string | null;
  };

  type MenuId = "provider" | "model" | "reasoning" | "tier";

  let {
    connected = false,
    sessionId = "",
    onError,
    onChanged,
  }: {
    connected?: boolean;
    sessionId?: string;
    onError?: (message: string) => void;
    onChanged?: (selection: SessionModelDto & { service_tier?: string | null }) => void;
  } = $props();

  let catalog = $state<ModelProviderDto[]>([]);
  let providerId = $state("");
  let modelId = $state("");
  let reasoning = $state("");
  let serviceTier = $state("");
  let openMenu = $state<MenuId | null>(null);
  let error = $state("");
  let loading = $state(false);
  let applying = $state(false);

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function surfaceError(message: string) {
    error = message;
    onError?.(message);
  }

  function rowAvailable(row: ModelProviderDto): boolean {
    const avail = (row.availability ?? "").toLowerCase();
    const health = (row.health ?? "").toLowerCase();
    if (avail === "unavailable" || health === "unavailable") return false;
    return true;
  }

  function providerLabel(id: string): string {
    const row = catalog.find((r) => r.provider_id === id);
    return row?.provider_display_name?.trim() || id || "Provider";
  }

  function modelLabel(pid: string, mid: string): string {
    const row = catalog.find((r) => r.provider_id === pid && r.model_id === mid);
    return row?.model_display_name?.trim() || mid || "Model";
  }

  const providers = $derived.by(() => {
    const seen = new Set<string>();
    const out: { id: string; available: boolean; label: string }[] = [];
    for (const row of catalog) {
      if (seen.has(row.provider_id)) continue;
      seen.add(row.provider_id);
      const anyOk = catalog.some(
        (r) => r.provider_id === row.provider_id && rowAvailable(r),
      );
      out.push({
        id: row.provider_id,
        available: anyOk,
        label: row.provider_display_name?.trim() || row.provider_id,
      });
    }
    return out;
  });

  const modelsForProvider = $derived.by(() => {
    return catalog.filter((r) => r.provider_id === providerId);
  });

  const activeRow = $derived.by(() => {
    return (
      catalog.find((r) => r.provider_id === providerId && r.model_id === modelId) ??
      modelsForProvider[0] ??
      null
    );
  });

  const reasoningOptions = $derived.by(() => {
    const row = activeRow;
    if (!row) return [] as string[];
    if (row.reasoning === false) return [] as string[];
    return row.reasoning_efforts ?? [];
  });

  const tierOptions = $derived.by(() => activeRow?.service_tiers ?? []);

  const canEdit = $derived(connected && !!sessionId.trim() && !loading && !applying);

  const summary = $derived.by(() => {
    if (!connected) return "offline";
    if (loading) return "…";
    if (!providerId && !modelId) return error ? "err" : "none";
    const parts = [providerId, modelId];
    if (reasoning) parts.push(reasoning);
    if (serviceTier) parts.push(serviceTier);
    return parts.filter(Boolean).join(" · ");
  });

  async function refreshCatalog() {
    catalog = [];
    if (!connected || !inTauriShell()) return;
    loading = true;
    error = "";
    try {
      catalog = await invoke<ModelProviderDto[]>("list_models");
    } catch (err) {
      surfaceError(errMsg(err));
      catalog = [];
    } finally {
      loading = false;
    }
  }

  async function refreshSelection() {
    const id = sessionId.trim();
    if (!id || !connected || !inTauriShell()) {
      if (!id) {
        // No session: seed from catalog default if present.
        const def = catalog.find((r) => r.is_default && rowAvailable(r)) ?? catalog.find(rowAvailable);
        if (def) {
          providerId = def.provider_id;
          modelId = def.model_id;
          reasoning = def.default_reasoning_effort ?? def.reasoning_efforts?.[0] ?? "";
          serviceTier = def.service_tiers?.[0] ?? "";
        } else {
          providerId = "";
          modelId = "";
          reasoning = "";
          serviceTier = "";
        }
      }
      return;
    }
    try {
      const sel = await invoke<SessionModelDto>("get_session_model", { sessionId: id });
      providerId = sel.provider_id ?? "";
      modelId = sel.model_id ?? "";
      reasoning = sel.reasoning_effort ?? "";
      serviceTier = sel.service_tier ?? "";
      const row =
        catalog.find((r) => r.provider_id === providerId && r.model_id === modelId) ?? null;
      if (!reasoning && row?.default_reasoning_effort) {
        reasoning = row.default_reasoning_effort;
      }
      if (!serviceTier && row?.service_tiers?.length) {
        serviceTier = row.service_tiers[0] ?? "";
      }
      onChanged?.({
        provider_id: providerId,
        model_id: modelId,
        reasoning_effort: reasoning || null,
        service_tier: serviceTier || null,
      });
    } catch (err) {
      surfaceError(errMsg(err));
    }
  }

  async function applySelection(next: {
    provider_id: string;
    model_id: string;
    reasoning_effort: string;
    service_tier: string;
  }) {
    const id = sessionId.trim();
    if (!id || !connected || !inTauriShell()) {
      surfaceError("Session required to set model");
      return;
    }
    const prev = {
      provider_id: providerId,
      model_id: modelId,
      reasoning_effort: reasoning,
      service_tier: serviceTier,
    };
    providerId = next.provider_id;
    modelId = next.model_id;
    reasoning = next.reasoning_effort;
    serviceTier = next.service_tier;
    applying = true;
    error = "";
    try {
      const sel = await invoke<SessionModelDto>("set_session_model", {
        sessionId: id,
        providerId: next.provider_id,
        modelId: next.model_id,
        reasoningEffort: next.reasoning_effort || null,
        serviceTier: next.service_tier || null,
      });
      providerId = sel.provider_id ?? next.provider_id;
      modelId = sel.model_id ?? next.model_id;
      reasoning = sel.reasoning_effort ?? next.reasoning_effort;
      serviceTier = sel.service_tier ?? next.service_tier;
      onChanged?.({
        provider_id: providerId,
        model_id: modelId,
        reasoning_effort: reasoning || null,
        service_tier: serviceTier || null,
      });
    } catch (err) {
      providerId = prev.provider_id;
      modelId = prev.model_id;
      reasoning = prev.reasoning_effort;
      serviceTier = prev.service_tier;
      surfaceError(errMsg(err));
    } finally {
      applying = false;
      openMenu = null;
    }
  }

  function pickProvider(id: string) {
    if (!canEdit) return;
    const rows = catalog.filter((r) => r.provider_id === id && rowAvailable(r));
    const preferred =
      rows.find((r) => r.model_id === modelId) ??
      rows.find((r) => r.is_default) ??
      rows[0];
    if (!preferred) {
      surfaceError(`No available models for provider ${id}`);
      return;
    }
    void applySelection({
      provider_id: preferred.provider_id,
      model_id: preferred.model_id,
      reasoning_effort:
        preferred.default_reasoning_effort ??
        preferred.reasoning_efforts?.[0] ??
        reasoning,
      service_tier: preferred.service_tiers?.[0] ?? "",
    });
  }

  function pickModel(mid: string) {
    if (!canEdit) return;
    const row = catalog.find(
      (r) => r.provider_id === providerId && r.model_id === mid && rowAvailable(r),
    );
    if (!row) {
      surfaceError(`Model unavailable: ${mid}`);
      return;
    }
    void applySelection({
      provider_id: row.provider_id,
      model_id: row.model_id,
      reasoning_effort:
        row.default_reasoning_effort ?? row.reasoning_efforts?.[0] ?? reasoning,
      service_tier: row.service_tiers?.[0] ?? serviceTier,
    });
  }

  function pickReasoning(effort: string) {
    if (!canEdit || !providerId || !modelId) return;
    void applySelection({
      provider_id: providerId,
      model_id: modelId,
      reasoning_effort: effort,
      service_tier: serviceTier,
    });
  }

  function pickTier(tier: string) {
    if (!canEdit || !providerId || !modelId) return;
    // Tier is catalog metadata; persist via set_session_model only carries model/reasoning.
    // Keep local selection + re-apply model so backend errors still surface.
    void applySelection({
      provider_id: providerId,
      model_id: modelId,
      reasoning_effort: reasoning,
      service_tier: tier,
    });
  }

  function toggle(menu: MenuId) {
    if (!connected) return;
    openMenu = openMenu === menu ? null : menu;
    if (openMenu) void refreshCatalog();
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest(".model-select")) {
      openMenu = null;
    }
  }

  $effect(() => {
    void connected;
    void refreshCatalog().then(() => refreshSelection());
  });

  $effect(() => {
    void sessionId;
    if (catalog.length || !connected) void refreshSelection();
  });

  $effect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openMenu = null;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  });
</script>

<div class="model-select" title={error || summary}>
  <div class="triggers">
    <button
      type="button"
      class="trigger mono"
      aria-expanded={openMenu === "provider"}
      aria-haspopup="listbox"
      disabled={!connected || loading || applying}
      onclick={() => toggle("provider")}
    >
      <span class="val">{providerId ? providerLabel(providerId) : "Provider"}</span>
      <Icon name="chevron-down" size={12} />
    </button>
    <button
      type="button"
      class="trigger mono"
      aria-expanded={openMenu === "model"}
      aria-haspopup="listbox"
      disabled={!connected || loading || applying || !providerId}
      onclick={() => toggle("model")}
    >
      <span class="val">{modelId ? modelLabel(providerId, modelId) : "Model"}</span>
      <Icon name="chevron-down" size={12} />
    </button>
    <button
      type="button"
      class="trigger mono"
      aria-expanded={openMenu === "reasoning"}
      aria-haspopup="listbox"
      disabled={!connected || loading || applying || !reasoningOptions.length}
      onclick={() => toggle("reasoning")}
      title={reasoningOptions.length ? "Reasoning effort" : "No reasoning levels from daemon"}
    >
      <span class="val">{reasoning || "Reasoning"}</span>
      <Icon name="chevron-down" size={12} />
    </button>
    {#if tierOptions.length}
      <button
        type="button"
        class="trigger mono"
        aria-expanded={openMenu === "tier"}
        aria-haspopup="listbox"
        disabled={!connected || loading || applying}
        onclick={() => toggle("tier")}
        title="Service tier"
      >
        <span class="val">{serviceTier || "Tier"}</span>
        <Icon name="chevron-down" size={12} />
      </button>
    {/if}
  </div>

  {#if openMenu === "provider" && connected}
    <div class="menu shell-acrylic" role="listbox" aria-label="Providers">
      {#if !providers.length}
        <p class="hint">{error || "No providers from daemon"}</p>
      {:else}
        {#each providers as p (p.id)}
          <button
            type="button"
            class="row"
            class:on={p.id === providerId}
            role="option"
            aria-selected={p.id === providerId}
            disabled={!p.available || !canEdit}
            onclick={() => pickProvider(p.id)}
          >
            <span class="id mono">{p.label}</span>
            {#if !p.available}<span class="badge">unavailable</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
  {:else if openMenu === "model" && connected}
    <div class="menu shell-acrylic" role="listbox" aria-label="Models">
      {#if !modelsForProvider.length}
        <p class="hint">{error || "No models for provider"}</p>
      {:else}
        {#each modelsForProvider as m (`${m.provider_id}:${m.model_id}`)}
          <button
            type="button"
            class="row"
            class:on={m.model_id === modelId}
            role="option"
            aria-selected={m.model_id === modelId}
            disabled={!rowAvailable(m) || !canEdit}
            onclick={() => pickModel(m.model_id)}
          >
            <span class="id mono">{m.model_display_name?.trim() || m.model_id}</span>
            <span class="badge">{m.health}</span>
          </button>
        {/each}
      {/if}
    </div>
  {:else if openMenu === "reasoning" && connected}
    <div class="menu shell-acrylic" role="listbox" aria-label="Reasoning">
      {#each reasoningOptions as effort (effort)}
        <button
          type="button"
          class="row"
          class:on={effort === reasoning}
          role="option"
          aria-selected={effort === reasoning}
          disabled={!canEdit}
          onclick={() => pickReasoning(effort)}
        >
          <span class="id mono">{effort}</span>
        </button>
      {:else}
        <p class="hint">No reasoning levels from daemon</p>
      {/each}
    </div>
  {:else if openMenu === "tier" && connected}
    <div class="menu shell-acrylic" role="listbox" aria-label="Service tiers">
      {#each tierOptions as tier (tier)}
        <button
          type="button"
          class="row"
          class:on={tier === serviceTier}
          role="option"
          aria-selected={tier === serviceTier}
          disabled={!canEdit}
          onclick={() => pickTier(tier)}
        >
          <span class="id mono">{tier}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if error}
    <p class="err" role="alert">{error}</p>
  {/if}
</div>

<style>
  .model-select {
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .triggers {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--faint);
    font: inherit;
    font-size: var(--text-xs, var(--text-sm));
    cursor: pointer;
    max-width: 12rem;
  }

  .trigger:hover:not(:disabled) {
    color: var(--muted);
    border-color: var(--border-soft, var(--border));
    background: var(--elevated);
  }

  .trigger:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 10rem;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    left: 0;
    z-index: var(--z-overlay, 40);
    min-width: 12rem;
    max-width: 22rem;
    max-height: 14rem;
    overflow: auto;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
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

  .row:hover:not(:disabled),
  .row.on {
    background: var(--elevated);
  }

  .row:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .id {
    font-size: var(--text-sm);
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    flex: 0 0 auto;
    font-size: var(--text-xs, var(--text-sm));
    color: var(--faint);
  }

  .hint {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs, var(--text-sm));
    color: var(--faint);
  }

  .err {
    margin: 0;
    max-width: 28rem;
    padding: 0 var(--space-1);
    font-size: var(--text-xs, var(--text-sm));
    color: var(--danger, var(--warn));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
