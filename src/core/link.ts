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

/** The fixed bar as the character's window draws it. */
export interface BarLook {
  /** Where the character sits along the band. */
  slot: "start" | "center" | "end";
  /** The island's own background, the band's too. */
  background: string;
  /** The band's height, logical px. */
  thickness: number;
}

export type IslandToCharacter =
  | {
      kind: "look";
      mode: CharacterMode;
      state: BotStateName;
      character: string;
      figure: string;
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

export type CharacterToIsland =
  | { kind: "hello" }
  /** A click on the character beside the open island: closes it (or opens it). */
  | { kind: "open" }
  | { kind: "ping"; sent: number };

/** BotEngine methods the island forwards while the compact character is in its own window. */
export const MIRRORED_CALLS = [
  "hello", "greet", "triggerEmote", "setPermanentEmote", "blink", "squash", "jiggle", "gulp", "slap", "doRoll", "emit",
] as const;

const NAME = "easyisland-link";

export function linkChannel<In, Out>(onMessage: (m: In) => void): (m: Out) => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<In>) => onMessage(e.data);
  return (m) => ch.postMessage(m);
}
