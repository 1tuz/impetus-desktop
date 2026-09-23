/**
 * Presentation-only chat labels for the session rail.
 * Daemon has no Delete/Rename/Archive IPC yet — soT stays on server;
 * Desktop only stores display title + archived/removed-from-list prefs.
 */

const TITLES_KEY = "impetus.desktop.session_titles";
const ARCHIVED_KEY = "impetus.desktop.session_archived";
const REMOVED_KEY = "impetus.desktop.session_removed";

function readMap(key: string): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(map));
}

function readSet(key: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string" && !!x.trim()));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify([...set]));
}

export function loadSessionTitles(): Record<string, string> {
  return readMap(TITLES_KEY);
}

export function saveSessionTitle(id: string, title: string): Record<string, string> {
  const map = readMap(TITLES_KEY);
  const t = title.trim();
  if (!t) delete map[id];
  else map[id] = t;
  writeMap(TITLES_KEY, map);
  return map;
}

export function loadArchivedSessionIds(): Set<string> {
  return readSet(ARCHIVED_KEY);
}

export function setSessionArchived(id: string, archived: boolean): Set<string> {
  const set = readSet(ARCHIVED_KEY);
  if (archived) set.add(id);
  else set.delete(id);
  writeSet(ARCHIVED_KEY, set);
  return set;
}

export function loadRemovedSessionIds(): Set<string> {
  return readSet(REMOVED_KEY);
}

export function removeSessionFromList(id: string): Set<string> {
  const set = readSet(REMOVED_KEY);
  set.add(id);
  writeSet(REMOVED_KEY, set);
  return set;
}

export function displaySessionTitle(
  id: string,
  titles: Record<string, string>,
): string {
  return titles[id] ?? id.slice(0, 8);
}
