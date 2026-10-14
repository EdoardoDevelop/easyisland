// Staged island states for the README screenshots, in the browser preview only:
//   /?scene=overview   (greeting, compact, overview, approval, chat, drop, actions,
//                       threecx, clipboard, media, network, meteo, suggestion, agenti)
// When the scene has settled the page turns transparent and its title says
// "scene ready"; scripts/screenshots.mjs then captures just the island.

import type { Island } from "../src/island/island";
import { State } from "../src/core/state";
import { Bridge } from "../src/core/bridge";
import { handleHook } from "../src/island/hooks";
import { handleIntegration, handleWidget } from "../src/island/integrations";
import { Recap } from "../src/island/recap";
import { Daily } from "../src/island/daily";
import { handleMoment } from "../src/island/moments";
import { setHistoryDemo } from "../src/views/chat";

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
  // Every scene can be driven from the console (and by the checks): `window.island`.
  (window as unknown as { island: Island; State: typeof State }).island = island;
  (window as unknown as { State: typeof State }).State = State;
  switch (scene) {
    case "greeting":
      // The launch greeting is already running: catch Slime waving.
      await wait(2100);
      break;
    case "compact":
      // ?hoverStyle=bar&revealDuration=0: the greeting folds into the compact bar.
      await wait(7000);
      break;
    case "strip": {
      // The closed island's strip: ?scene=strip&strip=approval|call|live|work (&compactStrip=left).
      await wait(300);
      island.collapse(true);
      const kind = new URLSearchParams(location.search).get("strip") ?? "approval";
      const now = Date.now();
      if (kind === "approval") {
        session("approval", ["Bash · npm run pack"]);
        State.pendingApproval = {
          requestId: "scene", taskId: CLAUDE, sessionId: "", tool: "Bash", command: "npm run pack", deadline: now + 94_000,
        };
        State.isPinned = true;
      } else if (kind === "call" || kind === "live") {
        State.integrations.integration_3cx = {
          loaded: true, configured: true, error: null,
          data: {
            mode: "user", connected: true, number: "101", name: "Mario Rossi",
            calls: [kind === "call"
              ? { id: "7", state: "ringing", incoming: true, name: "Cliente Srl", number: "+39 051 123456", since: now, canAnswer: true, dialog: "" }
              : { id: "5", state: "connected", incoming: false, name: "", number: "0512345678", since: now - 109_000, canAnswer: false, dialog: "" }],
          },
        };
      } else {
        session("working", ["Read · src/views/strip.ts", "Bash · npm run build"]);
      }
      island.showInStrip();
      await wait(1500);
      break;
    }
    case "overview":
      await wait(300);
      session("working", ["Read · src/character/slime.ts", "Edit · src/character/engine.ts", "Bash · npm run build"]);
      // Panoramica: each tile with its latest line, as the integrations write them.
      for (const [id, line] of [
        ["integration_network", "Wi-Fi Ufficio · 12 ms"], ["integration_weather", "Bologna: 14°, poco nuvoloso"],
        ["integration_zammad", "3 ticket tuoi, 1 non assegnato"], ["integration_clipboard", "8 elementi, 1 immagine"],
        ["integration_media", "Lo-fi beats — Chillhop"], ["integration_3cx", "Libero · interno 101"],
      ]) {
        const t = State.tasks.find((x) => x.id === id);
        if (t) t.steps = [line];
      }
      island.alert("overview");
      await wait(2500);
      break;
    case "files":
      // File e schermo: drop tile, Cerchia e chiedi, the Tray.
      await wait(300);
      State.isPinned = true;
      island.alert("overview");
      await wait(400);
      await island.openFiles();
      // A few files in the tray (the browser preview has no inbox).
      State.inbox = [
        { name: "preventivo-ottobre.pdf", path: "C:\inbox\preventivo-ottobre.pdf", size: 248_000, at: Date.now() - 600_000, kept: true },
        { name: "schermata.png", path: "C:\inbox\schermata.png", size: 412_000, at: Date.now() - 120_000 },
        { name: "log-server.zip", path: "C:\inbox\log-server.zip", size: 1_800_000, at: Date.now() - 60_000 },
      ];
      State.notify();
      await wait(2000);
      break;
    case "approval":
      await wait(300);
      session("approval", ["Bash · npm run pack"]);
      State.pendingApproval = {
        requestId: "scene", sessionId: "", tool: "Bash", command: "Bash · npm run pack", deadline: Date.now() + 94_000,
      };
      State.isPinned = true;
      island.alert("approval");
      await wait(2500);
      break;
    case "chat": {
      await wait(300);
      // ?long: a pasted path with no spaces in the history.
      if (new URLSearchParams(location.search).has("long")) {
        State.chatHistory = [
          { id: 1, role: "user", content: "Cos'è C:\\Users\\Edoardo\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings_senza_spazi.json?" },
          { id: 2, role: "assistant", content: "È il file delle impostazioni di **Windows Terminal**." },
        ];
      }
      // ?history: the list of earlier conversations, open.
      if (new URLSearchParams(location.search).has("history")) {
        const now = Date.now();
        setHistoryDemo([
          { id: "a", title: "Come si rinnova un certificato Let's Encrypt su IIS?", engine: "subscription", updated: now - 600_000, turns: 3 },
          { id: "b", title: "Riassumi questo PDF del preventivo per il cliente Rossi in tre punti", engine: "api", updated: now - 86_400_000, turns: 1 },
          { id: "c", title: "Script PowerShell per elencare le stampanti di rete", engine: "opencode", updated: now - 9 * 86_400_000, turns: 5 },
        ]);
        island.alert("prompt");
        await wait(500);
        document.querySelector<HTMLButtonElement>(".history-btn")?.click();
        await wait(800);
        break;
      }
      // ?window: a window the character was dropped on (window_drop.rs), with a
      // drawn thumbnail; ?pick: the character being carried, over a window.
      const params = new URLSearchParams(location.search);
      if (params.has("window")) {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 40;
        const g = c.getContext("2d")!;
        g.fillStyle = "#f3f4f6";
        g.fillRect(0, 0, 64, 40);
        g.fillStyle = "#2563eb";
        g.fillRect(0, 0, 64, 7);
        g.fillStyle = "#9ca3af";
        for (let y = 12; y < 36; y += 6) g.fillRect(6, y, 30 + ((y * 7) % 20), 2);
        State.chatWindow = {
          appName: "Google Chrome", title: "Errore 502 Bad Gateway — portale clienti", name: "Finestra.png", path: "C:\\x\\Finestra.png",
          thumb: c.toDataURL(),
        };
      }
      if (params.has("pick")) State.windowPick = { over: "Microsoft Excel — Preventivi 2026.xlsx" };
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
      // ?long: overlong texts, to check that nothing runs out of the card.
      if (new URLSearchParams(location.search).has("long")) {
        (State.integrations.integration_clipboard.data.items as unknown[]).unshift(
          { id: 6, preview: "C:\\Users\\Edoardo\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings_senza_spazi.json",
            chars: 110, lines: 1, at: now - 1_000, pinned: false },
          { id: 5, preview: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
            chars: 2400, lines: 40, at: now - 2_000, pinned: false });
      }
      const song = new URLSearchParams(location.search).has("long")
        ? "Bohemian Rhapsody (Remastered 2011, versione estesa dal vivo a Wembley)" : "Bohemian Rhapsody";
      State.integrations.integration_media = {
        loaded: true, configured: true, error: null,
        data: { active: true, title: song, artist: "Queen", app: "Spotify", playing: true,
          canPrev: true, canNext: true, duration: 354, position: 121, cover: null },
      };
      State.setFocus(scene === "clipboard" ? "integration_clipboard" : "integration_media");
      // ?summary: the ⌂ tab instead of the card.
      if (new URLSearchParams(location.search).has("summary")) State.summary = true;
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
            { id: "7", state: "ringing", incoming: true, name: "Cliente Srl", number: "+39 051 123456", since: now, canAnswer: true, dialog: "" },
            { id: "5", state: "connected", incoming: false, name: "", number: "0512345678", since: now - 95_000, canAnswer: false, dialog: "" },
          ],
          // Team, chat, voicemail and queues: the footer opens them (the PBX answers are faked below).
          team: [
            { number: "102", name: "Anna Bianchi", presence: "available", status: "Disponibile", ringingCall: null, mobile: "" },
            { number: "103", name: "Bruno Verdi", presence: "busy", status: "Disponibile", ringingCall: null, mobile: "" },
            { number: "104", name: "Carla Neri", presence: "ringing", status: "Disponibile", ringingCall: "90", mobile: "" },
            { number: "105", name: "Davide Russo", presence: "away", status: "Torno alle 15", ringingCall: null, mobile: "" },
            { number: "106", name: "Elena Gallo", presence: "dnd", status: "Non disturbare", ringingCall: null, mobile: "" },
            { number: "107", name: "Franco Costa", presence: "offline", status: "Disponibile", ringingCall: null, mobile: "" },
          ],
          unread: 2, unreadByChat: { "7": 2 }, voicemail: 1, queue: true,
        },
      };
      const ago = (min: number) => now - min * 60_000;
      const msg = (id: number, mine: boolean, from: string, text: string, min: number) =>
        ({ id, conversation: 7, mine, from, text, file: null, at: ago(min), isNew: !mine && min < 5, system: false });
      Object.assign(Bridge, {
        threecxChats: async () => [
          { id: 7, name: "Anna Bianchi", external: false, group: false, number: "102", last: "Mi richiami quando puoi?", lastAt: ago(2), lastMine: false, unread: 2 },
          { id: 8, name: "Ufficio tecnico", external: false, group: true, number: "", last: "Domani il server va giù alle 7", lastAt: ago(90), lastMine: true, unread: 0 },
          { id: 9, name: "Visitatore del sito", external: true, group: false, number: "", last: "Buongiorno, avete assistenza il sabato?", lastAt: ago(60 * 26), lastMine: false, unread: 0 },
        ],
        threecxMessages: async () => [
          msg(1, false, "Anna Bianchi", "Ciao Mario, il cliente di Bologna ha chiamato di nuovo", 30),
          msg(2, true, "Mario Rossi", "Ok, lo sento io dopo pranzo", 25),
          msg(3, false, "Anna Bianchi", "Perfetto grazie!", 4),
          msg(4, false, "Anna Bianchi", "Mi richiami quando puoi?", 2),
        ],
        threecxChatWith: async (numbers: string[]) =>
          ({ id: 7, name: "Anna Bianchi", external: false, group: false, number: numbers[0], last: "", lastAt: 0, lastMine: false, unread: 0 }),
        threecxVoicemails: async () => [
          { id: 1, name: "Cliente Srl", number: "0511234567", at: ago(40), seconds: 42, isNew: true, transcription: "Buongiorno, sono Rossi di Cliente Srl, la stampante dell'ufficio non stampa più. Mi richiamate? Grazie." },
          { id: 2, name: "", number: "3331234567", at: ago(60 * 30), seconds: 12, isNew: false, transcription: "" },
        ],
        threecxSend: async () => {}, threecxRead: async () => {}, threecxTyping: async () => {},
        threecxHistory: async (missed: boolean) => [
          { name: "Cliente Srl", number: "0511234567", kind: "missed", at: ago(12), answered: false },
          ...(missed ? [] : [
            { name: "Anna Bianchi", number: "102", kind: "outgoing", at: ago(35), answered: true },
            { name: "", number: "3331234567", kind: "received", at: ago(80), answered: true },
            { name: "Studio Verdi", number: "051987654", kind: "received", at: ago(60 * 26), answered: true },
          ]),
        ],
        threecxContacts: async () => [{ name: "Cliente Srl", company: "Cliente Srl", numbers: ["0511234567"], colleague: false }],
      });
      State.setFocus("integration_3cx");
      (window as unknown as { island: Island }).island = island;
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "capture": {
      // "Cerchia e chiedi" over a pretend desktop: Bridge's capture calls answer
      // from here. `window.capture` tells what the overlay asked for.
      await wait(300);
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(innerWidth * dpr);
      const H = Math.round(innerHeight * dpr);
      const fake = document.createElement("canvas");
      fake.width = W;
      fake.height = H;
      const g = fake.getContext("2d")!;
      const sky = g.createLinearGradient(0, 0, W, H);
      sky.addColorStop(0, "#1e3a8a");
      sky.addColorStop(1, "#0f766e");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#f8fafc";
      g.fillRect(W * 0.12, H * 0.14, W * 0.5, H * 0.6);
      g.fillStyle = "#0f172a";
      g.font = `${Math.round(18 * dpr)}px Segoe UI, sans-serif`;
      ["Errore 0x80070005: accesso negato", "Impossibile salvare il file di configurazione.", "Contatta l'amministratore di sistema."]
        .forEach((line, i) => g.fillText(line, W * 0.15, H * 0.24 + i * 30 * dpr));
      const log: unknown[] = [];
      (window as unknown as { capture: unknown[] }).capture = log;
      State.settings.actions = [
        { id: "a1", name: "Traduci in italiano", icon: "i:globe", color: "#22d3ee", kind: "prompt", target: "", args: "", script: "", shell: "powershell", prompt: "Traduci in italiano", input: "selection", confirm: false, hotkey: "" },
        { id: "a2", name: "Spiega l'errore", icon: "i:bug", color: "#f4505e", kind: "prompt", target: "", args: "", script: "", shell: "powershell", prompt: "Spiega questo errore e come risolverlo", input: "file", confirm: false, hotkey: "" },
      ];
      Object.assign(Bridge, {
        captureBegin: async () => ({ x: 0, y: 0, width: W, height: H }),
        captureFrame: async () => g.getImageData(0, 0, W, H).data.buffer,
        captureShow: async () => { log.push("show"); },
        captureEnd: async () => { log.push("end"); },
        captureSave: async (z: unknown) => { log.push(["save", z]); return { name: "Schermata.png", path: "C:\\inbox\\Schermata.png" }; },
        captureCopy: async (z: unknown) => { log.push(["copy", z]); },
        captureText: async (z: unknown) => { log.push(["text", z]); return "Errore 0x80070005: accesso negato\nImpossibile salvare il file di configurazione."; },
      });
      (window as unknown as { island: Island }).island = island;
      void island.captureScreen();
      await wait(400);
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
    case "usage": {
      // ?activeIntegrations=integration_claude_usage — the plan in the header and on the card;
      // &stale: numbers 7 hours old, Claude Code's login expired (grey in the header).
      await wait(300);
      const now = Math.floor(Date.now() / 1000);
      const stale = new URLSearchParams(location.search).has("stale");
      State.widgetStatus.integration_claude_usage = {
        id: "integration_claude_usage", level: "warn", at: now - 30,
        summary: "Piano: 5 ore 12% · settimana 83% (quasi al limite)",
        plan: { fiveHour: [12, now + 2 * 3600 + 600], sevenDay: [83, now + 3 * 86_400], at: stale ? now - 7 * 3600 : now - 30 },
        fields: [
          { label: "Piano · 5 ore", value: "12% · si azzera tra 2 h 10" },
          { label: "Piano · settimana", value: "83% · si azzera gio 9:00" },
          ...(stale ? [{ label: "Piano aggiornato", value: "7 h fa · l'accesso di Claude Code è scaduto: torna usando Claude Code nel terminale o in VS Code" }] : []),
          { label: "Ultime 5 ore", value: "1,2 M token" },
        ],
      };
      State.setFocus("integration_claude_usage");
      State.isPinned = true;
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "meteo": {
      // ?activeIntegrations=integration_weather&sky=rain (sun, moon, fog, snow, storm…):
      // the sky on the Meteo pill; &idle shows it on the idle character instead (Claude Code focused).
      await wait(300);
      const q = new URLSearchParams(location.search);
      State.widgetStatus.integration_weather = {
        id: "integration_weather", level: "warn", at: Math.floor(Date.now() / 1000) - 60,
        summary: "Bologna: 14°, pioggia probabile a breve (80%)", sky: q.get("sky") ?? "rain",
        fields: [{ label: "Cielo", value: "pioggia" }, { label: "Pioggia (prossime 3 ore)", value: "80%" }],
        // The card's data (probes.rs forecast_of); &night for the night sky.
        forecast: {
          place: "Bologna", temp: 14.3, feels: 12, humidity: 71, wind: 9, windDir: 225,
          day: !q.has("night"), sky: q.get("sky") ?? "rain",
          text: ({ sun: "sereno", moon: "sereno", "sun-cloud": "poco nuvoloso", "moon-cloud": "poco nuvoloso", cloud: "coperto", fog: "nebbia", snow: "neve", storm: "temporale" } as Record<string, string>)[q.get("sky") ?? ""] ?? "pioggia debole",
          sunrise: "07:21", sunset: "18:40", uv: 2,
          hourly: Array.from({ length: 12 }, (_, i) => ({
            hour: String((14 + i) % 24).padStart(2, "0"), temp: 14 - i * 0.4,
            sky: ["rain", "rain", "drizzle", "cloud", "cloud", "sun-cloud", "moon-cloud", "moon", "moon", "moon", "cloud", "fog"][i],
            rain: [80, 70, 45, 20, 10, 0, 0, 0, 0, 5, 10, 15][i],
          })),
          daily: ["rain", "sun-cloud", "sun", "cloud", "storm", "snow", "fog"].map((sky, i) => ({
            date: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10),
            max: [18, 20, 22, 19, 16, 6, 12][i], min: [9, 10, 11, 12, 10, -1, 6][i], sky, text: sky,
            rain: [90, 20, 0, 10, 70, 60, 5][i],
          })),
        },
      };
      if (q.has("idle")) {
        State.settings.integrationConfig.weatherOnCharacter = true;
        State.setFocus(CLAUDE);
      } else State.setFocus("integration_weather");
      State.isPinned = true;
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
        { ...base, id: "a5", name: "Server Rossi", icon: "i:remote", color: "#A78BFA", kind: "app", target: "mstsc", folder: "i:remote Clienti" },
        { ...base, id: "a6", name: "Server Bianchi", icon: "i:remote", color: "#A78BFA", kind: "app", target: "mstsc", folder: "i:remote Clienti" },
        { ...base, id: "a7", name: "Pulizia temp", icon: "i:printer", color: "#F5A524", kind: "script", script: "cleanmgr", folder: "Manutenzione" },
      ];
      State.foreground = { exe: "outlook.exe", title: "Posta in arrivo - Outlook" };
      island.alert("actions");
      // The tab grows to fit four actions: give it time to settle.
      await wait(4000);
      break;
    }
    case "finished": {
      // The "ha finito" card with a long answer and «Continua» (try &islandHeight=440:
      // the island must keep its height while typing in the field).
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      const t = State.tasks.find((x) => x.id === CLAUDE);
      if (!t) break;
      t.name = "easyisland";
      t.sessionHost = "terminal";
      t.sessionPid = { pid: 1234, exe: "claude.exe" };
      t.lastMessage = Array.from({ length: 12 }, (_, i) =>
        `- **Punto ${i + 1}:** una riga di risposta abbastanza lunga da andare a capo nella card dell'isola.`).join("\n");
      State.updateTask(CLAUDE, "finished");
      State.setFocus(CLAUDE);
      State.isPinned = true;
      island.alert("finished");
      await wait(900);
      break;
    }
    case "rewrite": {
      // "Sostituisci": a mail paragraph selected in Outlook, before and after.
      // &loading stops on the wait; &changed on the selection that moved.
      await wait(300);
      const p = new URLSearchParams(location.search);
      State.rewrite = {
        id: "scene", label: "Più formale", prompt: "",
        original: "Ciao Marco, ti giro il preventivo, dacci un'occhiata quando puoi e fammi sapere se va bene così o se c'è da cambiare qualcosa.",
        result: p.has("loading") ? "" : "Gentile Marco,\n\nLe inoltro il preventivo richiesto. Quando avrà modo di esaminarlo, Le chiedo cortesemente di farmi sapere se è adeguato o se desidera apportare delle modifiche.\n\nCordiali saluti",
        status: p.has("loading") ? "loading" : "ready",
        message: p.has("changed") ? "La selezione è cambiata e non ho sostituito niente: selezionala di nuovo o usa «Copia»." : "",
      };
      State.isPinned = true;
      island.alert("rewrite");
      await wait(900);
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
    case "diff": {
      // Edits as the relay sends them (hook/src/diff.rs), through the real handler.
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      const cwd = "C:\\Users\\Edoardo\\WORK\\easyisland";
      const edit = (file: string, diff: object) => {
        const tool_input = { file_path: `${cwd}\\${file}` };
        handleHook(island, { hook_event_name: "PreToolUse", cwd, tool_name: "Edit", tool_input });
        handleHook(island, { hook_event_name: "PostToolUse", cwd, tool_name: "Edit", tool_input,
          easyisland_diff: { file: tool_input.file_path, ...diff } });
      };
      session("working", ["Read · src/views/ticker.ts"]);
      island.alert("overview");
      edit("src\\views\\ticker.ts", { added: 3, removed: 1, too_big: false, hunks: [{ old: 52, new: 52, lines: [
        " function setText(row: Row, text: string) {",
        "   if (row.text === text) return;",
        "-  row.shimmer.textContent = text;",
        "+  row.text = text;",
        "+  fill(row.shimmer, text);",
        "+  fill(row.dim, text);",
        " }",
      ] }] });
      edit("src\\core\\state.ts", { added: 2, removed: 0, too_big: false, hunks: [{ old: 0, new: 0, lines: [
        "   stepIndex: number;", "+  stepSeq?: number;", "+  lastMessage?: string | null;",
      ] }] });
      edit("src\\core\\state.ts", { added: 1, removed: 1, too_big: false, hunks: [{ old: 640, new: 642, lines: [
        "   appendStep(id: string, step: string) {", "-    t.stepIndex = 0;", "+    t.stepSeq = 0;", "   }",
      ] }] });
      edit("dist\\bundle.js", { added: 5200, removed: 4100, too_big: true, hunks: [] });
      await wait(2500);
      break;
    }
    case "agents": {
      // Codex and Gemini CLI as the relay forwards them (hook/src/agents.rs).
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      const codex = { id: "codex", name: "Codex", color: "#10A37F" };
      const gemini = { id: "gemini", name: "Gemini CLI", color: "#4285F4" };
      const cwd = "C:\\Users\\Edoardo\\WORK\\gestionale";
      handleHook(island, { hook_event_name: "SessionStart", cwd, easyisland_agent: codex });
      handleHook(island, { hook_event_name: "UserPromptSubmit", cwd, prompt: "Correggi il calcolo dell'IVA", easyisland_agent: codex });
      handleHook(island, { hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command: "cargo test" }, easyisland_agent: codex });
      handleHook(island, { hook_event_name: "PostToolUse", cwd, tool_name: "Patch", easyisland_agent: codex,
        easyisland_diffs: [
          { file: "src/iva.rs", added: 2, removed: 1, too_big: false, hunks: [{ old: 0, new: 0, lines: [" fn iva(x: f64) -> f64 {", "-    x * 0.20", "+    // aliquota ordinaria", "+    x * 0.22", " }"] }] },
          { file: "CHANGELOG.md", added: 1, removed: 0, too_big: false, hunks: [{ old: 0, new: 0, lines: ["+- IVA al 22%"] }] },
        ] });
      handleHook(island, { hook_event_name: "SessionStart", cwd: "C:\\Users\\Edoardo\\WORK\\sito", easyisland_agent: gemini });
      handleHook(island, { hook_event_name: "Notification", cwd: "C:\\Users\\Edoardo\\WORK\\sito", easyisland_agent: gemini,
        easyisland_waiting: true, message: "Chiede un permesso nel terminale: rm -rf build" });
      island.alert("overview");
      await wait(1500);
      break;
    }
    case "agenti": {
      // The Agenti tab with two agents: Claude Code at work and opencode as
      // opencode_agent.rs forwards it, so the switch bar shows (.agent-switch).
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      session("working", ["Read · src/views/views.ts", "Edit · src/views/integrations.ts"]);
      const opencode = { id: "opencode", name: "opencode", color: "#FAB283" };
      const cwd = "C:\\Users\\Edoardo\\WORK\\gestionale";
      handleHook(island, { hook_event_name: "SessionStart", cwd, easyisland_agent: opencode, easyisland_host: "opencode" });
      handleHook(island, { hook_event_name: "UserPromptSubmit", cwd, prompt: "Aggiungi l'export in CSV",
        easyisland_agent: opencode, easyisland_host: "opencode" });
      handleHook(island, { hook_event_name: "PreToolUse", cwd, tool_name: "Read", tool_input: { file_path: `${cwd}\\src\\export.rs` },
        easyisland_agent: opencode, easyisland_host: "opencode" });
      // ?claude: the chip of Claude Code selected instead of opencode's.
      State.setFocus(new URLSearchParams(location.search).has("claude") ? CLAUDE : "agent:opencode");
      State.isPinned = true;
      island.alert("overview");
      await wait(1500);
      break;
    }
    case "moment": {
      // A proposal at the right moment (src/island/moments.ts), through the real
      // handler: ?moment=download (default), error, port, server, card, tray.
      await wait(300);
      const host = { alert: (v: never) => island.alert(v), collapse: () => island.collapse(), holdOpen: (on: boolean) => island.setPinned(on) };
      const which = new URLSearchParams(location.search).get("moment") ?? "download";
      const events: Record<string, unknown> = {
        download: { kind: "download", name: "Fattura-ottobre-2026.pdf", path: "C:\\Users\\Edoardo\\Downloads\\Fattura-ottobre-2026.pdf", size: 248_320 },
        zip: { kind: "download", name: "progetto.zip", path: "C:\\Users\\Edoardo\\Downloads\\progetto.zip", size: 18_400_000 },
        tray: { kind: "tray", name: "report-test.html", path: "C:\\x\\report-test.html", size: 12_800 },
        error: { kind: "error", error: "python", summary: "ZeroDivisionError: division by zero", port: null, holder: null,
          text: "Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\n    1/0\nZeroDivisionError: division by zero" },
        port: { kind: "error", error: "port", summary: "Error: listen EADDRINUSE: address already in use :::3000", port: 3000,
          holder: { name: "node.exe", pid: 18244 }, text: "Error: listen EADDRINUSE: address already in use :::3000\n    at Server.setupListenHandle (node:net:1872:16)" },
        server: { kind: "server", port: 5173, url: "http://localhost:5173/", process: "node.exe" },
        card: { kind: "card", id: "card1", title: "Build finita: 3 test falliti", text: "Vuoi che li corregga adesso o preferisci guardarli tu?", level: "warn", buttons: ["Correggi", "Li guardo io"] },
      };
      handleMoment(host, events[which] ?? events.download);
      // It waits for the greeting to end (moments.ts): ready once it is on screen.
      for (let i = 0; i < 40 && State.view !== "moment"; i++) await wait(250);
      await wait(1500);
      break;
    }
    case "daily":
      // The morning card (?evening: the end-of-day one), on made-up numbers.
      await wait(300);
      await Daily.open(island, new URLSearchParams(location.search).has("evening") ? "evening" : "morning");
      await wait(1500);
      break;
    case "recap":
      // Last week's recap, on the made-up week of src/island/recap.ts.
      await wait(300);
      await Recap.open(island);
      await wait(1500);
      break;
    case "stop":
      // A finished session whose last message is long and has markdown in it,
      // through the real Stop handler (?scene=finished is the card on its own).
      await wait(300);
      session("working", ["Edit · src/views/views.ts"]);
      handleHook(island, { hook_event_name: "Stop", cwd: "C:\\Users\\Edoardo\\WORK\\easyisland",
        easyisland_last_message: "Il commit `37fd214` è fatto e la versione con il diff è **installata**. L'app è ripartita alle 21:39 e il relay installato è identico a quello appena compilato. Non ho fatto il push.\n\nPer provarlo su questa sessione ho creato `prova-diff.txt` e poi l'ho modificato." });
      await wait(1500);
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
        permission_suggestions: [
          { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run pack:*" }], behavior: "allow", destination: "localSettings" },
        ],
      });
      return;
    case "fuzz":
      // Not a screenshot: hundreds of random agent events, clicks and malformed
      // integration data (?seed=7&steps=600). Every exception is reported by
      // scripts/smoke.mjs; at the end every session must be back at rest.
      await wait(300);
      await fuzz(island);
      break;
    default:
      return;
  }
  frame();
}


/** A small seeded generator, so a failing run can be replayed with its seed. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

async function fuzz(island: Island) {
  const q = new URLSearchParams(location.search);
  const seed = Number(q.get("seed") ?? 7);
  const steps = Number(q.get("steps") ?? 600);
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const junk = () => pick<unknown>([undefined, null, "", 0, 42, "x".repeat(5000), "à€😀\u0000", {}, [], { a: { b: [1, null] } }, true]);
  const maybe = <T,>(v: T): T => (r() < 0.12 ? junk() : v) as T;
  const agents = [
    undefined,
    { id: "codex", name: "Codex", color: "#10A37F" },
    { id: "opencode", name: "opencode", color: "#FAB283" },
    { id: "gemini", name: "Gemini CLI", color: "#4285F4" },
  ];
  const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification",
    "Stop", "StopFailure", "PermissionRequest", "SubagentStart", "SubagentStop", "PreCompact", "SessionEnd"];
  const tools = ["Bash", "Edit", "Write", "Read", "Grep", "WebFetch", "AskUserQuestion", "ExitPlanMode", "TodoWrite", "mcp__x__y", "Patch"];
  const views = ["overview", "prompt", "actions", "files", "approval", "ask", "finished", "note", "empty", "moment", "daily"] as const;
  const cwds = ["C:\\Users\\Edoardo\\WORK\\easyisland", "C:\\progetti\\gestionale", "/home/x/y", ""];
  const ids = State.tasks.map((t) => t.id);
  const errors: string[] = [];
  const step = async (i: number) => {
    const roll = r();
    if (roll < 0.55) {
      const tool = pick(tools);
      const input = tool === "AskUserQuestion"
        ? { questions: maybe([{ question: "Quale?", header: "H", multiSelect: r() < 0.5, options: [{ label: "A" }, { label: "B" }] }]) }
        : tool === "ExitPlanMode" ? { plan: maybe("1. uno\n2. due") }
        : tool === "TodoWrite" ? { todos: maybe([{ content: "a", status: pick(["pending", "in_progress", "completed"]) }]) }
        : { command: maybe("npm run build"), file_path: maybe("C:\\x\\a.ts"), old_string: maybe("a"), new_string: maybe("b") };
      handleHook(island, {
        hook_event_name: pick(events),
        session_id: maybe(pick(["s1", "s2", "s3"])),
        request_id: maybe(`r${i}`),
        cwd: maybe(pick(cwds)),
        tool_name: maybe(tool),
        tool_input: maybe(input),
        message: maybe(pick(["Claude is waiting for your input", "Rate limit reached", "Vuoi continuare?", "Claude needs your permission to use Bash"])),
        notification_type: maybe(pick(["idle_prompt", "permission_prompt", undefined])),
        prompt: maybe("Correggi il bug"),
        easyisland_last_message: maybe("**Fatto.** `ok`"),
        easyisland_agent: maybe(pick(agents)),
        permission_suggestions: maybe([{ type: "addRules", rules: [{ toolName: tool, ruleContent: "x:*" }], behavior: "allow", destination: "session" }]),
        easyisland_diff: maybe({ file: "C:\\x\\a.ts", added: 3, removed: 1, hunks: [{ old: 1, new: 1, lines: ["-a", "+b"] }] }),
        permission_mode: maybe(pick(["default", "plan", "acceptEdits", "bypassPermissions"])),
      } as never);
    } else if (roll < 0.68) {
      handleIntegration(island, {
        id: pick(ids),
        error: r() < 0.2 ? "rete giù" : null,
        data: maybe({
          calls: maybe([{ id: "1", state: pick(["ringing", "connected", "x"]), incoming: true, name: maybe("Cliente"), number: maybe("051"), since: Date.now() }]),
          connected: maybe(true), unread: maybe(2), items: maybe([{ title: maybe("t") }]), active: maybe(true), title: maybe("Brano"),
        }) as never,
        event: r() < 0.2 ? { success: r() < 0.5, label: "evento", detail: maybe("dettaglio") } : null,
      });
    } else if (roll < 0.78) {
      const id = pick(ids);
      handleWidget(island, {
        id, level: pick(["ok", "warn", "error"] as const), summary: maybe("riassunto"), fields: maybe([{ label: "a", value: "b" }]),
        at: Math.floor(Date.now() / 1000), sky: maybe(pick(["sun", "rain", "storm", "nonsense"])),
        forecast: id === "integration_weather"
          ? maybe({ place: "X", temp: maybe(10), day: maybe(true), sky: maybe("rain"), text: "pioggia",
            hourly: maybe([{ hour: "10", temp: 1, sky: "sun", rain: 5 }]), daily: maybe([{ date: "2026-10-13", min: 1, max: 9, sky: "rain", text: "p", rain: 50 }]) })
          : undefined,
        plan: maybe({ fiveHour: [50, 0] as [number, number] }),
      });
    } else if (roll < 0.9) {
      // A click on something on screen.
      const buttons = [...document.querySelectorAll<HTMLElement>("#island button, #rail .rail-item, #island .summary-row")]
        .filter((b) => b.offsetParent);
      if (buttons.length) pick(buttons).click();
    } else {
      const a = r();
      if (a < 0.3) island.alert(pick(views));
      else if (a < 0.5) island.collapse(r() < 0.5);
      else if (a < 0.7) island.setView(pick(views));
      else if (a < 0.8) State.setFocus(pick(ids));
      else if (a < 0.9) island.showInStrip();
      else {
        // A proposal of moments.rs, its fields sometimes junk.
        const host = { alert: (v: never) => island.alert(v), collapse: () => island.collapse(), holdOpen: (on: boolean) => island.setPinned(on) };
        handleMoment(host, maybe({
          kind: maybe(pick(["download", "tray", "error", "server", "card", "card-expired", "nope"])),
          id: maybe(pick(["card1", "card2"])), name: maybe("a.pdf"), path: maybe("C:\\x\\a.pdf"), size: maybe(1234),
          summary: maybe("Error: x"), text: maybe("Traceback (most recent call last):\nX: y"), port: maybe(pick([3000, 0, 70000])),
          holder: maybe({ name: maybe("node.exe"), pid: maybe(1) }), process: maybe("node.exe"), url: maybe("http://localhost:1/"),
          title: maybe("Titolo"), level: maybe(pick(["ok", "warn", "x"])), buttons: maybe(["A", junk(), "C", "D"]),
        }));
      }
    }
  };
  for (let i = 0; i < steps; i++) {
    try {
      await step(i);
    } catch (e) {
      errors.push(`passo ${i}: ${(e as Error)?.stack ?? e}`);
    }
    if (i % 10 === 0) await wait(16);
  }
  // Every session ends its turn: after the "finito" pause all must be at rest.
  if (State.pendingApproval) island.settleApproval(State.pendingApproval);
  for (const t of State.sessionTasks) {
    const agent = t.id === CLAUDE ? undefined : { id: t.id.slice("agent:".length), name: t.agentName ?? "x", color: t.color };
    handleHook(island, { hook_event_name: "Stop", cwd: "C:\\x", easyisland_agent: agent } as never);
  }
  await wait(5600);
  const busy = State.sessionTasks.filter((t) => !["idle", "sleeping", "finished"].includes(t.state));
  if (busy.length) errors.push(`sessioni non a riposo: ${busy.map((t) => `${t.id}=${t.state}`).join(", ")}`);
  const box = document.getElementById("island")!.getBoundingClientRect();
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) errors.push("misure dell'isola non valide");
  for (const e of errors) console.error(`fuzz (seed ${seed}): ${e}`);
  (window as unknown as { fuzzReport: unknown }).fuzzReport = { seed, steps, errors: errors.length };
}
