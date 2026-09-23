<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, EmptyState } from "$lib/components/ui";
  import SubagentCard from "$lib/components/SubagentCard.svelte";
  import "$lib/components/shell.css";

  type ChildRunRow = {
    id: string;
    name: string;
    role: string;
    status: string;
    detail: string;
    durationLabel: string;
  };

  let {
    sessionId = "",
    connected = false,
    busy = false,
  }: {
    sessionId?: string;
    connected?: boolean;
    busy?: boolean;
  } = $props();

  let rows = $state<ChildRunRow[]>([]);
  let loading = $state(false);
  let emptyReason = $state("");

  function inTauriShell(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function field(rec: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const v = rec[key];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  }

  function numField(rec: Record<string, unknown>, ...keys: string[]): number | null {
    for (const key of keys) {
      const v = rec[key];
      if (v == null) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  /** Short relative or absolute label from unix ms. */
  function formatRecorded(ms: number): string {
    const now = Date.now();
    const delta = now - ms;
    if (delta >= 0 && delta < 60_000) return "just now";
    if (delta >= 0 && delta < 3_600_000) {
      const m = Math.floor(delta / 60_000);
      return `${m}m ago`;
    }
    if (delta >= 0 && delta < 86_400_000) {
      const h = Math.floor(delta / 3_600_000);
      return `${h}h ago`;
    }
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function normalize(raw: unknown): ChildRunRow | null {
    if (raw == null || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    // ChildRunDto: child_id first; keep id/run_id aliases.
    const id = field(rec, "child_id", "id", "run_id");
    if (!id) return null;
    const role = field(rec, "role", "kind", "type");
    const name = field(rec, "name", "title", "label") || role || id;
    const recordedMs = numField(rec, "recorded_unix_ms", "recordedUnixMs", "recorded_at_ms");
    const durationLabel =
      field(rec, "durationLabel", "duration_label", "duration") ||
      (recordedMs != null ? formatRecorded(recordedMs) : "");
    return {
      id,
      name,
      role,
      status: field(rec, "status", "state"),
      detail: field(rec, "summary", "detail", "action", "message"),
      durationLabel,
    };
  }

  function invokeErrorMessage(err: unknown): string {
    if (err == null) return "list_child_runs failed";
    if (typeof err === "string") {
      const s = err.trim();
      return s ? (s.length > 120 ? `${s.slice(0, 117)}…` : s) : "list_child_runs failed";
    }
    if (typeof err === "object") {
      const rec = err as Record<string, unknown>;
      const msg = field(rec, "message", "error", "msg") || String(err).trim();
      if (msg && msg !== "[object Object]") {
        return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
      }
    }
    return "list_child_runs failed";
  }

  function canRefresh(): boolean {
    return Boolean(sessionId.trim() && connected && inTauriShell());
  }

  async function refresh() {
    rows = [];
    emptyReason = "";
    if (!connected || !sessionId.trim()) {
      emptyReason = "Connect + session required";
      return;
    }
    if (!inTauriShell()) {
      emptyReason = "Connect + session required";
      return;
    }
    loading = true;
    try {
      const payload = await invoke<unknown>("list_child_runs", {
        sessionId: sessionId.trim(),
      });
      const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { runs?: unknown }).runs)
          ? (payload as { runs: unknown[] }).runs
          : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
            ? (payload as { items: unknown[] }).items
            : [];
      rows = list.map(normalize).filter((r): r is ChildRunRow => r != null);
      if (!rows.length) emptyReason = "No child runs";
    } catch (err) {
      rows = [];
      emptyReason = invokeErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void sessionId;
    void connected;
    void refresh();
  });
</script>

<div class="child-runs" aria-label="Child runs">
  <div class="child-runs-head">
    <span class="shell-label">Subagents</span>
    <Button
      variant="ghost"
      size="sm"
      class="child-runs-refresh"
      title="Refresh"
      aria-label="Refresh child runs"
      disabled={!canRefresh() || loading || busy}
      onclick={() => void refresh()}
    >
      Refresh
    </Button>
  </div>

  {#if !connected || !sessionId.trim()}
    <div class="child-runs-empty">
      <EmptyState
        icon="sparkles"
        title="No chat yet"
        description="Start a New Chat to see sub-agents here."
        compact
      />
    </div>
  {:else if loading && !rows.length}
    <p class="child-runs-hint">Loading…</p>
  {:else if !rows.length}
    <div class="child-runs-empty">
      <EmptyState
        icon="sparkles"
        title={emptyReason || "No child runs"}
        description="Sub-agents for this chat will show up here."
        compact
      />
    </div>
  {:else}
    <ul class="child-runs-list">
      {#each rows as row (row.id)}
        <li>
          <SubagentCard
            id={row.id}
            name={row.name}
            role={row.role}
            status={row.status}
            detail={row.detail}
            durationLabel={row.durationLabel}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .child-runs {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: var(--space-1);
  }

  .child-runs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0 var(--space-3);
    min-height: var(--space-8);
  }

  .child-runs-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    overflow: auto;
    min-height: 0;
    flex: 1;
  }

  .child-runs-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .child-runs-hint {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  :global(.child-runs-refresh) {
    flex: 0 0 auto;
  }
</style>
