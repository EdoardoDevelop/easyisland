// Staged island states for the README screenshots, in the browser preview only:
//   /?scene=overview   (greeting, compact, overview, approval, chat, drop, actions,
//                       threecx, clipboard, media, network, suggestion)
// When the scene has settled the page turns transparent and its title says
// "scene ready"; scripts/screenshots.mjs then captures just the island.

import type { Island } from "../src/island/island";
import { State } from "../src/core/state";
import { handleHook } from "../src/island/hooks";

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
      // A copied picture: a fake screenshot thumbnail (an error dialog on a blue desktop).
      const shot = document.createElement("canvas");
      shot.width = 96;
      shot.height = 54;
      const g = shot.getContext("2d")!;
      g.fillStyle = "#1e3a8a"; g.fillRect(0, 0, 96, 54);
      g.fillStyle = "#f3f4f6"; g.fillRect(22, 12, 52, 30);
      g.fillStyle = "#ef4444"; g.beginPath(); g.arc(32, 26, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#9ca3af"; g.fillRect(42, 22, 26, 3); g.fillRect(42, 28, 18, 3);
      State.integrations.integration_clipboard = {
        loaded: true, configured: true, error: null,
        data: { items: [
          { id: 4, kind: "image", preview: "", chars: 0, lines: 1, at: now - 5_000, pinned: false,
            thumb: shot.toDataURL(), width: 1280, height: 720 },
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
    case "threecx": {
      // ?activeIntegrations=integration_3cx — a call ringing and one in progress.
      await wait(300);
      const now = Date.now();
      State.integrations.integration_3cx = {
        loaded: true, configured: true, error: null,
        data: {
          mode: "user", connected: true, number: "101", name: "Mario Rossi", profile: "1", missed: 3,
          profiles: [{ id: "1", name: "Disponibile" }, { id: "2", name: "Assente" }, { id: "3", name: "Non disturbare" }],
          devices: [{ id: "a", name: "App 3CX per Windows" }, { id: "b", name: "Yealink T46U" }],
          calls: [
            { id: "7", state: "ringing", incoming: true, name: "Cliente Srl", number: "+39 051 123456", since: now, canAnswer: true },
            { id: "5", state: "connected", incoming: false, name: "", number: "0512345678", since: now - 95_000, canAnswer: false },
          ],
        },
      };
      State.setFocus("integration_3cx");
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "network": {
      // ?activeIntegrations=integration_network,… — an integration run as a check.
      await wait(300);
      State.widgetStatus.integration_network = {
        id: "integration_network", level: "ok", at: Math.floor(Date.now() / 1000) - 40,
        summary: "Wi-Fi Ufficio · 18 ms",
        fields: [
          { label: "IP locale", value: "192.168.1.24" },
          { label: "IP pubblico", value: "203.0.113.57" },
          { label: "Wi-Fi", value: "Ufficio (5 GHz, 86%)" },
          { label: "VPN", value: "nessuna" },
          { label: "Latenza", value: "18 ms" },
        ],
      };
      State.setFocus("integration_network");
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "actions": {
      // The ⚡ tab: the user's quick actions and the suggestions for the app in front.
      await wait(300);
      const base = { args: "", script: "", shell: "powershell" as const, prompt: "", input: "clipboard" as const, confirm: true, hotkey: "", target: "" };
      State.settings.actions = [
        { ...base, id: "a1", name: "Portale clienti", icon: "i:globe", color: "#38BDF8", kind: "url", target: "https://example.com" },
        { ...base, id: "a2", name: "Desktop remoto", icon: "i:remote", color: "#A78BFA", kind: "app", target: "mstsc" },
        { ...base, id: "a3", name: "Spooler", icon: "i:printer", color: "#F5A524", kind: "script", script: "Restart-Service Spooler" },
        { ...base, id: "a4", name: "Spiega errore", icon: "i:bolt", color: "#22C55E", kind: "prompt", prompt: "Spiega questo errore", hotkey: "Ctrl+Alt+E" },
      ];
      State.foreground = { exe: "outlook.exe", title: "Posta in arrivo - Outlook" };
      island.alert("actions");
      // The tab grows to fit four actions: give it time to settle.
      await wait(4000);
      break;
    }
    case "suggestion":
      // A proposal from the habits (habits.rs), as the island shows it.
      await wait(300);
      island.showNotice({
        title: "Apro Outlook alle 08:50?",
        text: "Negli ultimi 21 giorni hai aperto Outlook verso le 08:55 in 13 giorni su 15 lavorativi.",
        level: "info", url: "", suggestion: "time|outlook.exe|wd|08:30",
      });
      await wait(2500);
      break;
    case "drop":
      await wait(300);
      island.alert("upload");
      await wait(2500);
      break;
    case "permission":
      // Not a screenshot: a real PermissionRequest through the hook handler while
      // the island shows another tab, to check the card shows, stays and returns.
      // The island is left on window.island to drive the rest by hand.
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      session("working", ["Read · src/island/hooks.ts"]);
      island.alert("actions");
      await wait(600);
      handleHook(island, {
        hook_event_name: "PermissionRequest", request_id: "scene", session_id: "s",
        cwd: "C:\\Users\\Edoardo\\WORK\\easyisland", tool_name: "Bash",
        tool_input: { command: "npm run pack" },
      });
      return;
    default:
      return;
  }
  frame();
}
