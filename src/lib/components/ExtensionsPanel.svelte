<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, EmptyState } from "$lib/components/ui";
  import "$lib/components/shell.css";

  /** Daemon `ExtensionPackageDto` — inventory only; no local manifest read. */
  type ExtensionPackage = {
    id: string;
    name: string;
    version: string;
    extension_api_version: number;
    source: string;
    phase: string;
    capabilities: string[];
    permissions: string[];
    last_error?: string | null;
    compatible: boolean;
  };

  let {
    connected = false,
    busy = false,
  }: {
    connected?: boolean;
    busy?: boolean;
  } = $props();

  let packages = $state<ExtensionPackage[]>([]);
  let loading = $state(false);
  let actingId = $state("");
  let error = $state("");

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function errMsg(err: unknown): string {
    if (err == null) return "extension command failed";
    if (typeof err === "string") {
      const s = err.trim();
      return s ? (s.length > 140 ? `${s.slice(0, 137)}…` : s) : "extension command failed";
    }
    if (err instanceof Error && err.message.trim()) return err.message.trim();
    if (typeof err === "object") {
      const rec = err as Record<string, unknown>;
      const msg = rec.message ?? rec.error ?? rec.msg;
      if (typeof msg === "string" && msg.trim()) {
        const s = msg.trim();
        return s.length > 140 ? `${s.slice(0, 137)}…` : s;
      }
    }
    return "extension command failed";
  }

  function normalize(raw: unknown): ExtensionPackage | null {
    if (raw == null || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) return null;
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    return {
      id,
      name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : id,
      version: typeof rec.version === "string" ? rec.version : "",
      extension_api_version:
        typeof rec.extension_api_version === "number" ? rec.extension_api_version : 0,
      source: typeof rec.source === "string" ? rec.source : "",
      phase: typeof rec.phase === "string" ? rec.phase : "",
      capabilities: strArr(rec.capabilities),
      permissions: strArr(rec.permissions),
      last_error:
        typeof rec.last_error === "string"
          ? rec.last_error
          : rec.last_error == null
            ? null
            : String(rec.last_error),
      compatible: Boolean(rec.compatible),
    };
  }

  function isEnabled(phase: string): boolean {
    const p = phase.trim().toLowerCase();
    return p === "enabled" || p === "active" || p === "running" || p === "loaded";
  }

  function canAct(): boolean {
    return connected && inTauriShell() && !loading && !busy && !actingId;
  }

  async function refresh() {
    packages = [];
    error = "";
    if (!connected || !inTauriShell()) return;
    loading = true;
    try {
      const payload = await invoke<unknown>("list_extension_packages");
      const list = Array.isArray(payload) ? payload : [];
      packages = list.map(normalize).filter((p): p is ExtensionPackage => p != null);
    } catch (err) {
      packages = [];
      error = errMsg(err);
    } finally {
      loading = false;
    }
  }

  async function reload() {
    if (!canAct()) return;
    actingId = "__reload__";
    error = "";
    try {
      const payload = await invoke<unknown>("reload_extension_packages");
      const list = Array.isArray(payload) ? payload : [];
      packages = list.map(normalize).filter((p): p is ExtensionPackage => p != null);
    } catch (err) {
      error = errMsg(err);
      await refresh();
    } finally {
      actingId = "";
    }
  }

  async function enable(id: string) {
    if (!canAct() || !id) return;
    actingId = id;
    error = "";
    try {
      const updated = normalize(await invoke<unknown>("enable_extension_package", { id }));
      if (updated) {
        packages = packages.map((p) => (p.id === id ? updated : p));
      } else {
        await refresh();
      }
    } catch (err) {
      error = errMsg(err);
    } finally {
      actingId = "";
    }
  }

  async function disable(id: string) {
    if (!canAct() || !id) return;
    actingId = id;
    error = "";
    try {
      const updated = normalize(await invoke<unknown>("disable_extension_package", { id }));
      if (updated) {
        packages = packages.map((p) => (p.id === id ? updated : p));
      } else {
        await refresh();
      }
    } catch (err) {
      error = errMsg(err);
    } finally {
      actingId = "";
    }
  }

  $effect(() => {
    void connected;
    void refresh();
  });
</script>

<div class="ext-panel" aria-label="Extensions">
  <div class="ext-head">
    <p class="hint">
      Installed packages from Runtime — enable / disable / reload. No marketplace.
    </p>
    <Button
      variant="ghost"
      size="sm"
      title="Reload packages from disk"
      aria-label="Reload extension packages"
      disabled={!canAct()}
      onclick={() => void reload()}
    >
      Reload
    </Button>
  </div>

  {#if error}
    <p class="ext-error" role="alert">{error}</p>
  {/if}

  {#if !connected}
    <div class="ext-empty">
      <EmptyState
        icon="plug"
        title="Connect required"
        description="Connect to Runtime to list installed extension packages"
        compact
      />
    </div>
  {:else if loading && !packages.length}
    <p class="ext-hint">Loading extensions…</p>
  {:else if !packages.length}
    <div class="ext-empty">
      <EmptyState
        icon="sparkles"
        title="No extensions installed"
        description={error || "Runtime returned an empty package list"}
        compact
      />
    </div>
  {:else}
    <ul class="ext-list">
      {#each packages as pkg (pkg.id)}
        {@const enabled = isEnabled(pkg.phase)}
        <li class="ext-card" data-phase={pkg.phase || undefined} data-compatible={pkg.compatible}>
          <div class="ext-card-top">
            <div class="ext-titles">
              <span class="ext-name">{pkg.name}</span>
              <code class="ext-meta mono">
                {pkg.version || "—"} · api {pkg.extension_api_version}
                {#if pkg.source}
                  · {pkg.source}
                {/if}
              </code>
            </div>
            <div class="ext-badges">
              <span class="badge" data-kind="phase">{pkg.phase || "unknown"}</span>
              <span class="badge" data-kind={pkg.compatible ? "ok" : "warn"}>
                {pkg.compatible ? "compatible" : "incompatible"}
              </span>
            </div>
          </div>

          {#if pkg.capabilities.length || pkg.permissions.length}
            <div class="ext-tags">
              {#each pkg.capabilities as cap (cap)}
                <span class="tag" data-kind="cap">{cap}</span>
              {/each}
              {#each pkg.permissions as perm (perm)}
                <span class="tag" data-kind="perm">{perm}</span>
              {/each}
            </div>
          {/if}

          {#if pkg.last_error}
            <p class="ext-pkg-error" role="status">{pkg.last_error}</p>
          {/if}

          <div class="ext-actions">
            {#if enabled}
              <Button
                variant="ghost"
                size="sm"
                disabled={!canAct() || actingId === pkg.id}
                onclick={() => void disable(pkg.id)}
              >
                Disable
              </Button>
            {:else}
              <Button
                variant="primary"
                size="sm"
                disabled={!canAct() || actingId === pkg.id || !pkg.compatible}
                onclick={() => void enable(pkg.id)}
              >
                Enable
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ext-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .ext-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--faint);
    line-height: 1.4;
    flex: 1;
    min-width: 0;
  }

  .ext-error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger, #c44);
    line-height: 1.35;
  }

  .ext-hint {
    margin: 0;
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .ext-empty {
    padding: var(--space-2) 0;
  }

  .ext-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ext-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-soft, var(--border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface, var(--bg)) 80%, transparent);
  }

  .ext-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .ext-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .ext-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ext-meta {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ext-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .badge {
    font-size: var(--text-xs);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm, var(--radius-md));
    border: 1px solid var(--border-soft);
    color: var(--muted);
    text-transform: lowercase;
  }

  .badge[data-kind="ok"] {
    color: var(--accent);
    border-color: var(--accent-dim, var(--accent));
  }

  .badge[data-kind="warn"] {
    color: var(--danger, #c44);
    border-color: color-mix(in srgb, var(--danger, #c44) 40%, var(--border));
  }

  .ext-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .tag {
    font-size: var(--text-xs);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm, var(--radius-md));
    background: var(--elevated, var(--bg));
    color: var(--muted);
  }

  .tag[data-kind="perm"] {
    color: var(--faint);
  }

  .ext-pkg-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger, #c44);
    line-height: 1.35;
    word-break: break-word;
  }

  .ext-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
