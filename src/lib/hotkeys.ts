/** Thin-shell desktop hotkeys — Cursor-like where Impetus has an equivalent. */

export function isMod(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function digitIndex(event: KeyboardEvent): number | null {
  const m = event.key.match(/^[1-9]$/);
  return m ? Number(m[0]) - 1 : null;
}

/** Suppress find / print / save / reload browser chrome in the shell. */
export function suppressBrowserChrome(event: KeyboardEvent): boolean {
  if (!isMod(event)) return false;
  const k = event.key.toLowerCase();
  if (k === "r" || k === "f" || k === "p" || k === "s") {
    event.preventDefault();
    return true;
  }
  return false;
}

/**
 * Shown only in Preferences.
 * Mapping notes (Cursor → Impetus):
 * - New Agent ⌘N → New Chat
 * - Open Folder ⌘O → Open workspace
 * - Files ⌘G → Attach files
 * - Settings ⇧⌘, → Preferences (⌘, also)
 * - Command Palette ⌘K → Focus prompt (no palette yet)
 * - Keyboard Shortcuts ⌃⇧/ → Preferences
 * - TUI Ctrl+T / Ctrl+Shift+P → Steer / cycle intent
 */
export const HOTKEY_HELP: { keys: string; action: string }[] = [
  { keys: "⌘/Ctrl+N", action: "New Chat" },
  { keys: "⌘/Ctrl+O", action: "Open workspace" },
  { keys: "⌘/Ctrl+G", action: "Attach files" },
  { keys: "⌘/Ctrl+Enter", action: "Send prompt" },
  { keys: "⌘/Ctrl+K", action: "Focus prompt" },
  { keys: "⌘/Ctrl+B", action: "Toggle session rail" },
  { keys: "⌘/Ctrl+,", action: "Preferences" },
  { keys: "⌃⇧/", action: "Preferences (shortcuts)" },
  { keys: "⌘/Ctrl+Shift+T", action: "Cycle theme pack" },
  { keys: "⌘/Ctrl+L", action: "Clear local transcript" },
  { keys: "⌘/Ctrl+1…9", action: "Select chat by index" },
  { keys: "Ctrl+T", action: "Set Steer intent" },
  { keys: "Ctrl+Shift+P", action: "Cycle prompt intent" },
  { keys: "Esc", action: "Close overlay / Stop turn" },
  { keys: "⌘/Ctrl+.", action: "Stop turn" },
];
