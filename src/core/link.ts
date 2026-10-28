// The channel between the island's page and the character's own window
// (docs/due-webview.md). Both pages share origin and WebView2 profile, so a
// BroadcastChannel reaches across windows with no round trip through Rust.
// Step 0 carries only what the trial needs; step 1 makes it the full contract.

import type { BotStateName } from "./layout";

export type IslandToCharacter =
  | {
      kind: "look";
      state: BotStateName;
      character: string;
      figure: string;
      color: string | null;
      /** The rest icon's size (px) and whether EasyIsland is paused (dimmed). */
      size: number;
      paused: boolean;
      /** Shown at rest: hidden, it draws nothing and makes no gestures. */
      resting: boolean;
    }
  | { kind: "pong"; sent: number };

export type CharacterToIsland =
  | { kind: "hello" }
  | { kind: "open" }
  | { kind: "ping"; sent: number };

const NAME = "easyisland-link";

export function linkChannel<In, Out>(onMessage: (m: In) => void): (m: Out) => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<In>) => onMessage(e.data);
  return (m) => ch.postMessage(m);
}
