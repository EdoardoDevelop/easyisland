// The channel between the island's page and the character's own window
// (docs/due-webview.md). Both pages share origin and WebView2 profile, so a
// BroadcastChannel reaches across windows with no round trip through Rust.

import type { Sky } from "../character/weather";
import type { BotStateName } from "./layout";

/**
 * What the character's window shows: nothing, the rest icon, the compact
 * character, the one beside the open island, or the fixed bar (appbar.rs).
 */
export type CharacterMode = "off" | "rest" | "compact" | "open" | "bar";

/** One element of the fixed bar, prepared by the island (src/island/bar.ts). */
export interface BarPiece {
  key: string;
  area: "start" | "center" | "end";
  /** Built with the DOM by the island: icons and escaped text. */
  html: string;
  title: string;
  tone?: "ok" | "warn" | "error";
}

/** The fixed bar as the character's window draws it. */
export interface BarLook {
  /** Where the character sits along the band. */
  slot: "start" | "center" | "end";
  /** The screen edge the band is against: it swells away from it. */
  edge: "top" | "bottom";
  /** The island's own background, the band's too. */
  background: string;
  /** The band's height, logical px. */
  thickness: number;
  /** The island's text colour, for the elements. */
  ink: string;
  items: BarPiece[];
  /** «Aspetto della barra». */
  look: import("./state").FixedBarLook;
  /** Aspetto → Font in the bar (fonts.ts barFont); null = the bar's own. */
  font?: { stack: string; weight: number } | null;
}

export type IslandToCharacter =
  | {
      kind: "look";
      mode: CharacterMode;
      state: BotStateName;
      character: string;
      figure: string;
      /** The user's PNG changed when this does (theme.logoStamp): loaded again for figure "logo". */
      logoStamp: number;
      color: string | null;
      /** The rest icon's size (px) and whether EasyIsland is paused (dimmed). */
      size: number;
      paused: boolean;
      sky: Sky | null;
      weather: { sky: Sky | null; temp: string };
      /** Jarvis: one satellite per agent at work. */
      agents: number;
      /** With the fixed bar on. */
      bar: BarLook | null;
    }
  /** The compact character's gaze, -1…1 (BotEngine.lookX / lookY). */
  | { kind: "gaze"; x: number; y: number }
  /** One of the engine's gestures, replayed (MIRRORED_CALLS). */
  | { kind: "call"; name: string; args: unknown[] }
  | { kind: "pong"; sent: number };

/** How an element of the bar was touched: a button, or the wheel up or down. */
export type BarButton = "left" | "middle" | "right" | "up" | "down";

export type CharacterToIsland =
  | { kind: "hello" }
  /** A click on the character beside the open island: closes it (or opens it). */
  | { kind: "open" }
  /** A click on an element of the fixed bar (BarPiece.key): which button, or the wheel. */
  /** `x`: the element's centre from the bar's left end, for its card to come out under it. */
  | { kind: "bar"; key: string; button?: BarButton; x?: number }
  | { kind: "ping"; sent: number };

/** BotEngine methods the island forwards while the compact character is in its own window. */
export const MIRRORED_CALLS = [
  "hello", "greet", "triggerEmote", "setPermanentEmote", "blink", "squash", "jiggle", "gulp", "slap", "doRoll", "emit",
] as const;

const NAME = "easyisland-link";
const DOCK_NAME = "easyisland-dock-link";

export function linkChannel<In, Out>(onMessage: (m: In) => void): (m: Out) => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<In>) => onMessage(e.data);
  return (m) => ch.postMessage(m);
}

/** Look pushed from the island to the dedicated Dock window (dock.html). */
export interface DockSnapshot {
  background: string;
  ink: string;
  items: BarPiece[];
  look: import("./state").DockLook;
  pinned: import("./state").DockPin[];
  font?: { stack: string; weight: number } | null;
  scheme: "dark" | "light";
  style: import("./uistyle").UiStyle;
  accent: string;
  animations: "ricche" | "sobrie" | "fermo";
  reduceTransparency: boolean;
  fullscreen?: boolean;
  nativeMaterial?: boolean;
  trayIcons?: import("./bridge").TrayIconInfo[];
}

export type IslandToDock =
  | { kind: "dock-look"; snap: DockSnapshot }
  | { kind: "dock-windows"; windows: import("./bridge").DockWin[] }
  | { kind: "dock-icons"; icons: Record<string, string> }
  | { kind: "dock-tray"; icons: import("./bridge").TrayIconInfo[] }
  | { kind: "dock-fullscreen"; fullscreen: boolean };

export type DockToIsland =
  | { kind: "hello" }
  | { kind: "open" }
  | { kind: "bar"; key: string; button?: BarButton; x?: number }
  | { kind: "tray"; id: string; button: "left" | "right" | "middle" | "double"; x?: number; y?: number }
  | { kind: "settings" };

export function dockChannel<In, Out>(onMessage: (m: In) => void): (m: Out) => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(DOCK_NAME);
  ch.onmessage = (e: MessageEvent<In>) => onMessage(e.data);
  return (m) => ch.postMessage(m);
}
