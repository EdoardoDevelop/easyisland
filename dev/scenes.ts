// Staged island states for the README screenshots, in the browser preview only:
//   /?scene=overview   (greeting, compact, overview, approval, chat, drop)
// When the scene has settled the page turns transparent and its title says
// "scene ready"; scripts/screenshots.mjs then captures just the island.

import type { Island } from "../src/island/island";
import { State } from "../src/core/state";

const CLAUDE = "integration_claude";
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** A Claude Code session at work in the Claude desktop app. */
function session(state: "working" | "approval", steps: string[]) {
  const t = State.tasks.find((x) => x.id === CLAUDE);
  if (!t) return;
  t.name = "easyisland";
  t.sessionCwd = "C:\\Users\\Edoardo\\WORK\\easyisland";
  t.sessionHost = "desktop";
  for (const s of steps) State.appendStep(CLAUDE, s);
  State.updateTask(CLAUDE, state);
}

/** Transparent page, and the signal scripts/screenshots.mjs waits for. */
function frame() {
  document.documentElement.classList.add("shot");
  document.title = "scene ready";
}

export async function runScene(island: Island, scene: string) {
  switch (scene) {
    case "greeting":
      // The launch greeting is already running: catch Slime waving.
      await wait(2100);
      break;
    case "compact":
      // ?hoverStyle=bar&revealDuration=0: the greeting folds into the compact bar.
      await wait(7000);
      break;
    case "overview":
      await wait(300);
      session("working", ["Read · src/character/slime.ts", "Edit · src/character/engine.ts", "Bash · npm run build"]);
      island.alert("overview");
      await wait(2500);
      break;
    case "approval":
      await wait(300);
      session("approval", ["Bash · npm run pack"]);
      State.pendingApproval = {
        requestId: "scene", sessionId: "", tool: "Bash", command: "Bash · npm run pack",
      };
      State.isPinned = true;
      island.alert("approval");
      await wait(2500);
      break;
    case "chat": {
      await wait(300);
      island.alert("prompt");
      await wait(800);
      const input = document.querySelector<HTMLInputElement>(".chat-input");
      if (input) input.value = "Ciao Slime, mi riassumi le novità di oggi?";
      await wait(1800);
      break;
    }
    case "clipboard":
    case "media": {
      // ?activeIntegrations=integration_clipboard,integration_media
      await wait(300);
      const now = Date.now();
      State.integrations.integration_clipboard = {
        loaded: true, configured: true, error: null,
        data: { items: [
          { id: 3, preview: "https://github.com/EdoardoDevelop/easyisland/releases", chars: 52, lines: 1, at: now - 20_000, pinned: false },
          { id: 2, preview: "Via Roma 12, 40121 Bologna", chars: 26, lines: 1, at: now - 300_000, pinned: true },
          { id: 1, preview: "{\"name\":\"easyisland\",\"version\":\"0.2.0\"}", chars: 40, lines: 1, at: now - 900_000, pinned: false },
        ] },
      };
      State.integrations.integration_media = {
        loaded: true, configured: true, error: null,
        data: { active: true, title: "Bohemian Rhapsody", artist: "Queen", app: "Spotify", playing: true,
          canPrev: true, canNext: true, duration: 354, position: 121, cover: null },
      };
      State.setFocus(scene === "clipboard" ? "integration_clipboard" : "integration_media");
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "drop":
      await wait(300);
      island.alert("upload");
      await wait(2500);
      break;
    default:
      return;
  }
  frame();
}
