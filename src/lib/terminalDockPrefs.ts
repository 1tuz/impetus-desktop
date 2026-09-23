/**
 * Desktop UI state for the bottom terminal dock.
 * Daemon owns PTY lifecycle; this book only remembers pty_id for reconnect
 * (Core has no ListPtys — BLOCKED BY CORE).
 */

export const DOCK_PREFS_KEY = "impetus.desktop.pty.dock.v2";

export const DOCK_HEIGHT_MIN = 120;
export const DOCK_HEIGHT_MAX = 720;
export const DOCK_HEIGHT_DEFAULT = 280;
export const MAX_TERMINAL_TABS = 8;

export type TerminalTabPersist = {
  id: string;
  ptyId: number;
  title: string;
  shellPath: string;
  cwdHint: string | null;
  createdAtMs: number;
};

export type SessionTerminalBook = {
  activeTabId: string | null;
  tabOrder: string[];
  tabs: Record<string, TerminalTabPersist>;
};

export type TerminalDockBlob = {
  version: number;
  dock: {
    heightPx: number;
    open: boolean;
  };
  bySession: Record<string, SessionTerminalBook>;
};

function emptyBlob(): TerminalDockBlob {
  return {
    version: 1,
    dock: { heightPx: DOCK_HEIGHT_DEFAULT, open: true },
    bySession: {},
  };
}

export function clampDockHeight(px: number): number {
  if (!Number.isFinite(px)) return DOCK_HEIGHT_DEFAULT;
  return Math.min(DOCK_HEIGHT_MAX, Math.max(DOCK_HEIGHT_MIN, Math.round(px)));
}

export function loadDockBlob(): TerminalDockBlob {
  if (typeof localStorage === "undefined") return emptyBlob();
  try {
    const raw = localStorage.getItem(DOCK_PREFS_KEY);
    if (!raw) return emptyBlob();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyBlob();
    }
    const obj = parsed as Record<string, unknown>;
    const ver = typeof obj.version === "number" ? obj.version : obj.v;
    if (ver !== 1) return emptyBlob();
    const dockRaw = obj.dock;
    let heightPx = DOCK_HEIGHT_DEFAULT;
    let open = true;
    if (dockRaw && typeof dockRaw === "object" && !Array.isArray(dockRaw)) {
      const d = dockRaw as Record<string, unknown>;
      if (typeof d.heightPx === "number") heightPx = clampDockHeight(d.heightPx);
      if (typeof d.open === "boolean") open = d.open;
    }
    const bySession: Record<string, SessionTerminalBook> = {};
    const sessions = obj.bySession;
    if (sessions && typeof sessions === "object" && !Array.isArray(sessions)) {
      for (const [sid, book] of Object.entries(
        sessions as Record<string, unknown>,
      )) {
        const parsedBook = parseSessionBook(book);
        if (parsedBook) bySession[sid] = parsedBook;
      }
    }
    return { version: 1, dock: { heightPx, open }, bySession };
  } catch {
    return emptyBlob();
  }
}

function parseSessionBook(raw: unknown): SessionTerminalBook | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const tabs: Record<string, TerminalTabPersist> = {};
  const tabsRaw = obj.tabs;
  if (tabsRaw && typeof tabsRaw === "object" && !Array.isArray(tabsRaw)) {
    for (const [id, t] of Object.entries(tabsRaw as Record<string, unknown>)) {
      const tab = parseTab(id, t);
      if (tab) tabs[id] = tab;
    }
  }
  let tabOrder: string[] = [];
  if (Array.isArray(obj.tabOrder)) {
    tabOrder = obj.tabOrder.filter(
      (x): x is string => typeof x === "string" && !!tabs[x],
    );
  }
  for (const id of Object.keys(tabs)) {
    if (!tabOrder.includes(id)) tabOrder.push(id);
  }
  let activeTabId: string | null = null;
  if (typeof obj.activeTabId === "string" && tabs[obj.activeTabId]) {
    activeTabId = obj.activeTabId;
  } else if (tabOrder.length) {
    activeTabId = tabOrder[0] ?? null;
  }
  return { activeTabId, tabOrder, tabs };
}

function parseTab(id: string, raw: unknown): TerminalTabPersist | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.ptyId !== "number" || !Number.isFinite(t.ptyId)) return null;
  const title =
    typeof t.title === "string" && t.title.trim() ? t.title.trim() : "shell";
  const shellPath =
    typeof t.shellPath === "string" && t.shellPath.trim()
      ? t.shellPath.trim()
      : "/bin/zsh";
  const cwdHint =
    typeof t.cwdHint === "string" && t.cwdHint.trim() ? t.cwdHint.trim() : null;
  const createdAtMs =
    typeof t.createdAtMs === "number" && Number.isFinite(t.createdAtMs)
      ? t.createdAtMs
      : Date.now();
  return {
    id: typeof t.id === "string" && t.id.trim() ? t.id.trim() : id,
    ptyId: Math.trunc(t.ptyId),
    title,
    shellPath,
    cwdHint,
    createdAtMs,
  };
}

export function saveDockBlob(blob: TerminalDockBlob): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DOCK_PREFS_KEY, JSON.stringify(blob));
}

export function saveDockChrome(heightPx: number, open: boolean): void {
  const blob = loadDockBlob();
  blob.dock.heightPx = clampDockHeight(heightPx);
  blob.dock.open = open;
  saveDockBlob(blob);
}

export function loadSessionBook(sessionId: string): SessionTerminalBook {
  if (!sessionId) return { activeTabId: null, tabOrder: [], tabs: {} };
  return (
    loadDockBlob().bySession[sessionId] ?? {
      activeTabId: null,
      tabOrder: [],
      tabs: {},
    }
  );
}

export function saveSessionBook(
  sessionId: string,
  book: SessionTerminalBook,
): void {
  if (!sessionId) return;
  const blob = loadDockBlob();
  blob.bySession[sessionId] = book;
  saveDockBlob(blob);
}

export function clearSessionBook(sessionId: string): void {
  if (!sessionId) return;
  const blob = loadDockBlob();
  delete blob.bySession[sessionId];
  saveDockBlob(blob);
}

export function shellBasename(shellPath: string): string {
  const parts = shellPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "shell";
}

export function newTabId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pure reorder helper for HTML5 DnD (UI order only). */
export function reorderTabIds(
  order: string[],
  fromId: string,
  toId: string,
): string[] {
  if (fromId === toId) return order.slice();
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0) return order.slice();
  const next = order.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return order.slice();
  next.splice(to, 0, item);
  return next;
}

/** Alive if Core state string is Starting / Running / Detached. */
export function ptyStateLooksAlive(state: string): boolean {
  const s = state.toLowerCase();
  return (
    s.startsWith("starting") ||
    s.startsWith("running") ||
    s.startsWith("detached")
  );
}
