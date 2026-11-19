// Unread notification badge parser and window attention helpers for Dock tiles.

import type { DockWin } from "../core/bridge";

const BROWSER_HOSTS = new Set([
  "msedge.exe",
  "chrome.exe",
  "brave.exe",
  "vivaldi.exe",
  "opera.exe",
  "applicationframehost.exe",
]);

/** Parses leading "(12) Inbox" or "(99+) Chats" unread prefixes from a window title. */
export function unreadBadgeFromTitle(title: string): number {
  if (!title || !title.startsWith("(")) return 0;
  const rest = title.slice(1);
  let end = 0;
  while (end < rest.length && end < 4 && rest.charCodeAt(end) >= 48 && rest.charCodeAt(end) <= 57) {
    end++;
  }
  if (end === 0 || end > 4) return 0;
  if (end === 4 && rest.charCodeAt(4) >= 48 && rest.charCodeAt(4) <= 57) return 0;
  let after = rest.slice(end);
  if (after.startsWith("+")) after = after.slice(1);
  if (!after.startsWith(") ") && !after.startsWith(")\t")) return 0;
  const n = Number.parseInt(rest.slice(0, end), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Formats badge counts cleanly (caps 100+ to "99+"). */
export function formatBadgeCount(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

/** Aggregates the highest unread badge across an entry's windows (native badge or title prefix). */
export function appBadgeCount(windows: readonly Pick<DockWin, "title" | "badge">[]): number {
  let max = 0;
  for (const w of windows) {
    const fromWin = typeof w.badge === "number" && w.badge > 0 ? w.badge : 0;
    const fromTitle = unreadBadgeFromTitle(w.title || "");
    max = Math.max(max, fromWin, fromTitle);
  }
  return max;
}

/** Checks whether an executable path or basename belongs to a multi-app browser host. */
export function isBrowserHostApp(appId: string): boolean {
  const norm = appId.trim().toLowerCase().replace(/\\/g, "/");
  const base = norm.split("/").pop() || norm;
  return BROWSER_HOSTS.has(base);
}
