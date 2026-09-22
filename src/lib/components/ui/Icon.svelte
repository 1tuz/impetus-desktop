<script lang="ts">
  /** Thin icon wrapper — static registry only (no lucide-svelte). */

  type IconName =
    | "settings"
    | "panel-left"
    | "panel-left-close"
    | "send"
    | "arrow-up"
    | "square"
    | "plug"
    | "unplug"
    | "plus"
    | "x"
    | "chevron-right"
    | "chevron-left"
    | "chevron-down"
    | "git-branch"
    | "folder"
    | "folder-plus"
    | "message-square"
    | "sparkles"
    | "keyboard"
    | "sun"
    | "moon"
    | "terminal";

  /** Lucide-compatible 24×24 stroke paths. */
  const REGISTRY: Record<IconName, string[]> = {
    settings: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    ],
    "panel-left": [
      "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z",
      "M9 3v18",
    ],
    "panel-left-close": [
      "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z",
      "M9 3v18",
      "m16 15-3-3 3-3",
    ],
    send: [
      "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      "m21.854 2.147-10.94 10.939",
    ],
    "arrow-up": ["m5 12 7-7 7 7", "M12 19V5"],
    square: [
      "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    ],
    plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a6 6 0 0 1-12 0V8z"],
    unplug: [
      "m19 5 3-3",
      "m2 22 3-3",
      "M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z",
      "M7.5 13.5 10 11",
      "M10.5 16.5 13 14",
      "m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z",
    ],
    plus: ["M5 12h14", "M12 5v14"],
    x: ["M18 6 6 18", "m6 6 12 12"],
    "chevron-right": ["m9 18 6-6-6-6"],
    "chevron-left": ["m15 18-6-6 6-6"],
    "chevron-down": ["m6 9 6 6 6-6"],
    "git-branch": [
      "M6 3v12",
      "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M18 9a9 9 0 0 1-9 9",
    ],
    folder: [
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ],
    "folder-plus": [
      "M12 10v6",
      "M9 13h6",
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ],
    "message-square": ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
    sparkles: [
      "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      "M20 3v4",
      "M22 5h-4",
      "M4 17v2",
      "M5 18H3",
    ],
    keyboard: [
      "M10 8h.01",
      "M12 12h.01",
      "M14 8h.01",
      "M16 12h.01",
      "M18 8h.01",
      "M6 8h.01",
      "M7 16h10",
      "M8 12h.01",
      "M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z",
    ],
    sun: [
      "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
      "M12 2v2",
      "M12 20v2",
      "m4.93 4.93 1.41 1.41",
      "m17.66 17.66 1.41 1.41",
      "M2 12h2",
      "M20 12h2",
      "m6.34 17.66-1.41 1.41",
      "m19.07 4.93-1.41 1.41",
    ],
    moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
    terminal: [
      "M12 19h8",
      "m4 17 6-6-6-6",
    ],
  };

  const warned = new Set<string>();

  function normalize(raw: string): string {
    return raw
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
  }

  let {
    name,
    size = 16,
    class: className = "",
    strokeWidth = 2,
  }: {
    name: string;
    size?: number;
    class?: string;
    strokeWidth?: number;
  } = $props();

  const key = $derived(normalize(name));
  const paths = $derived(REGISTRY[key as IconName] ?? null);

  $effect(() => {
    if (!paths && !warned.has(key)) {
      warned.add(key);
      console.warn(`[Icon] unknown icon "${name}" (normalized: "${key}")`);
    }
  });
</script>

{#if paths}
  <svg
    class="ui-icon {className}"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#each paths as d (d)}
      <path {d} />
    {/each}
  </svg>
{/if}

<style>
  .ui-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
