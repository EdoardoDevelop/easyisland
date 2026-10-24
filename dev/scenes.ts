// Staged island states for the README screenshots, in the browser preview only:
//   /?scene=overview   (greeting, compact, overview, approval, chat, drop, actions,
//                       threecx, clipboard, media, network, meteo, suggestion, agenti)
// When the scene has settled the page turns transparent and its title says
// "scene ready"; scripts/screenshots.mjs then captures just the island.

import { fillTemplate, receiveSource, toCsv } from "../src/views/custom";
import { run, scopeOf } from "../src/core/expr";
import { rdmLookFor } from "../src/views/rdm";
import type { Island } from "../src/island/island";
import { State, type CustomField } from "../src/core/state";
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
      // The closed island's strip: ?scene=strip&strip=approval|call|live|work|app (&compactStrip=left).
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
      } else if (kind === "app") {
        // The bar of the app in use: Outlook in front, one action of the user's for it.
        State.settings.actions = [...(State.settings.actions ?? []), {
          id: "scene-crm", name: "Apri nel CRM", icon: "i:briefcase", color: "", kind: "url", target: "https://example.com",
          args: "", script: "", shell: "powershell", prompt: "", input: "none", confirm: false, hotkey: "", apps: "outlook.exe",
        }];
        State.foreground = { exe: "outlook.exe", title: "" };
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
    case "files": {
      // File e schermo: drop tile, Cerchia e chiedi, the Tray, the work folder.
      // A work folder of example (the browser preview has no disk).
      const day = Date.now() - 86_400_000;
      const sample: Record<string, { name: string; dir: boolean; size: number }[]> = {
        "": [
          { name: "Clienti", dir: true, size: 0 },
          { name: "Preventivi", dir: true, size: 0 },
          { name: "note-riunione.md", dir: false, size: 3_200 },
          { name: "listino-2026.xlsx", dir: false, size: 84_000 },
        ],
        Clienti: [{ name: "Rossi Srl", dir: true, size: 0 }, { name: "contratto-rossi.pdf", dir: false, size: 512_000 }],
      };
      Bridge.workList = async (rel: string) => ({
        root: "C:\\Users\\Edoardo\\Lavoro", rel, more: false,
        entries: (sample[rel] ?? []).map((e) => ({ ...e, rel: rel ? `${rel}/${e.name}` : e.name, at: day })),
      });
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
      // &fresh: a zone just put there by Cerchia e chiedi.
      if (new URLSearchParams(location.search).has("fresh")) {
        State.inbox.unshift({ name: "Schermata 14-10 16.02.png", path: "C:\inbox\Schermata.png", size: 186_000, at: Date.now() - 4_000 });
        State.trayFresh = { name: "Schermata 14-10 16.02.png", until: Date.now() + 300_000 };
      }
      State.notify();
      await wait(2000);
      break;
    }
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
      // ?terminal: Modalità terminale on, the "Automatica" switch in the head (&auto: on).
      if (new URLSearchParams(location.search).has("terminal")) {
        State.settings.chatTerminal = true;
        State.chatAuto = new URLSearchParams(location.search).has("auto");
        State.chatHistory = [
          { id: 1, role: "user", content: "Che file ci sono in questa cartella?" },
          { id: 2, role: "assistant", content: "> ⚙ Esegue · `Get-ChildItem`\n\nCi sono `package.json`, `src` e `README.md`." },
        ];
        State.notify();
      }
      // ?remote: a remote connection open, the 🔌 in the head (&linked: on).
      if (new URLSearchParams(location.search).has("remote")) {
        State.integrations.integration_remote = { loaded: true, configured: true, error: null,
          data: { connected: true, kind: "ssh", host: "10.0.0.5", os: "linux", name: "srv-gestionale", linked: new URLSearchParams(location.search).has("linked") } };
        State.notify();
      }
      // ?second: an answer, its «Seconda opinione» and the button under the last one.
      if (new URLSearchParams(location.search).has("second")) {
        State.chatHistory = [
          { id: 1, role: "user", content: "Quanti giorni di preavviso servono per disdire il contratto?" },
          { id: 2, role: "assistant", content: "Di solito **30 giorni**, con raccomandata o PEC.", engine: "subscription" },
          { id: 3, role: "assistant", content: "Manca un punto: molti contratti chiedono **60 giorni** prima della scadenza annuale. Va controllato l'articolo sulla disdetta.", reviewer: "Gemini" },
        ];
      }
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
      // A cover drawn here: a dusk sky over a hill (?nocover: none).
      const art = document.createElement("canvas");
      art.width = art.height = 300;
      const a = art.getContext("2d")!;
      const sky = a.createLinearGradient(0, 0, 0, 300);
      sky.addColorStop(0, "#3b1d6e"); sky.addColorStop(0.55, "#e0607e"); sky.addColorStop(1, "#f6b26b");
      a.fillStyle = sky; a.fillRect(0, 0, 300, 300);
      a.fillStyle = "#ffe8a3"; a.beginPath(); a.arc(200, 170, 46, 0, Math.PI * 2); a.fill();
      a.fillStyle = "#1c1233"; a.beginPath(); a.moveTo(0, 300); a.quadraticCurveTo(110, 170, 300, 240); a.lineTo(300, 300); a.fill();
      const cover = new URLSearchParams(location.search).has("nocover") ? null : art.toDataURL("image/jpeg", 0.85);
      State.integrations.integration_media = {
        loaded: true, configured: true, error: null,
        data: { active: true, title: song, artist: "Queen", app: "Spotify", playing: true,
          canPrev: true, canNext: true, duration: 354, position: 121, cover },
      };
      State.setFocus(scene === "clipboard" ? "integration_clipboard" : "integration_media");
      // ?summary: the ⌂ tab instead of the card.
      if (new URLSearchParams(location.search).has("summary")) State.summary = true;
      island.alert("overview");
      await wait(2500);
      break;
    }
    case "recorder": {
      // ?activeIntegrations=integration_recorder (&live: recording for 83 s). The card at the end: ?scene=moment&moment=recording.
      await wait(300);
      const live = new URLSearchParams(location.search).has("live") ? { kind: "audio", mic: true, system: true, since: Date.now() - 83_000, path: "C:/Users/x/Videos/EasyIsland/Registrazione.m4a" } : null;
      State.integrations.integration_recorder = {
        loaded: true, configured: true, error: null,
        data: { recording: !!live, live, error: null, folder: "C:/Users/x/Videos/EasyIsland" },
      };
      State.setFocus("integration_recorder");
      State.summary = false;
      island.alert("overview");
      await wait(1500);
      break;
    }
    case "remote": {
      // ?activeIntegrations=integration_remote — the form (&guide: with the guide open);
      // &live: connected to a made-up PC (&linked: linked to the chat). The chat's 🔌: ?scene=chat&remote.
      await wait(300);
      const q = new URLSearchParams(location.search);
      State.integrations.integration_remote = {
        loaded: true, configured: true, error: null,
        data: q.has("live")
          ? { connected: true, kind: "winrm", host: "192.168.1.20", user: "PC-RECEPTION\\admin", os: "windows", name: "PC-RECEPTION",
            system: "Microsoft Windows 11 Pro 10.0.22631", since: Date.now() - 120_000, trustedAdded: true, linked: q.has("linked") }
          : q.has("error")
            ? { connected: false, error: "Collegamento a 192.168.1.20 non riuscito: accesso negato. Controlla utente (NOMEPC\\utente) e password; con un amministratore locale diverso da Administrator serve LocalAccountTokenFilterPolicy (guida)." }
            : { connected: false },
      };
      State.setFocus("integration_remote");
      State.summary = false;
      island.alert("overview");
      island.setPinned(true);
      await wait(400);
      if (q.has("guide")) document.querySelector<HTMLButtonElement>(".rm-foot .link-btn")?.click();
      await wait(1100);
      break;
    }
    case "teams": {
      // ?activeIntegrations=integration_teams (&call: in a meeting with the webcam on).
      await wait(300);
      const call = new URLSearchParams(location.search).has("call");
      State.integrations.integration_teams = {
        loaded: true, configured: true, error: null,
        data: { running: true, inCall: call, mic: call, camera: call },
      };
      const task = State.tasks.find((x) => x.id === "integration_teams");
      if (task) {
        task.steps = [call ? "In riunione · webcam accesa" : "Teams aperto, nessuna riunione"];
        task.state = call ? "working" : "idle";
      }
      State.setFocus("integration_teams");
      State.summary = false;
      island.alert("overview");
      await wait(1500);
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
      // &form: the adapter settings open.
      Object.assign(Bridge, {
        networkAdapters: async () => [
          { index: 4, name: "Ethernet", up: true, wireless: false, virtualHost: false, dhcp: true, dnsAuto: true, main: true,
            addresses: [{ ip: "192.168.1.24", prefix: 24 }], gateway: "192.168.1.1", dns: ["192.168.1.1", "1.1.1.1"] },
          { index: 14, name: "Ethernet 2", up: true, wireless: false, virtualHost: false, dhcp: false, dnsAuto: false, main: false,
            addresses: [{ ip: "10.20.0.15", prefix: 24 }], gateway: "10.20.0.1", dns: ["10.20.0.1"] },
          { index: 27, name: "Wi-Fi", up: false, wireless: true, virtualHost: false, dhcp: true, dnsAuto: true, main: false,
            addresses: [], gateway: "", dns: [] },
        ],
        networkApply: async () => { await wait(600); },
        networkPing: async (target: string) => (target === "gateway" ? "192.168.1.1" : target),
      });
      await wait(300);
      State.widgetStatus.integration_network = {
        id: "integration_network", level: "ok", at: Math.floor(Date.now() / 1000) - 40,
        summary: "Wi-Fi Ufficio · 18 ms",
        fields: [
          { label: "Rete", value: "Wi-Fi Ufficio" },
          { label: "IP locale", value: "192.168.1.24" },
          { label: "IP pubblico", value: "203.0.113.57" },
          { label: "Gateway", value: "192.168.1.1" },
          { label: "DNS", value: "192.168.1.1, 1.1.1.1" },
          { label: "Ethernet 2", value: "10.20.0.15 · gateway 10.20.0.1" },
          { label: "vEthernet (WSL)", value: "172.28.96.1" },
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
    case "notion": {
      // ?activeIntegrations=integration_notion — tasks, pinned pages, + Nota, search (Bridge mocked), the chat on a page; &views.
      const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      const pages = [
        { id: "a1", title: "Piano di lancio Q4", emoji: "🚀", lastEditedAt: ago(12), url: "https://www.notion.so/a1" },
        { id: "a2", title: "Riunione clienti 14 ottobre", emoji: null, lastEditedAt: ago(55), url: "https://www.notion.so/a2" },
        { id: "a3", title: "Ticket aperti", emoji: "🎫", database: true, lastEditedAt: ago(130), url: "https://www.notion.so/a3" },
        { id: "a4", title: "Procedure di assistenza", emoji: "🛠️", lastEditedAt: ago(60 * 26), url: "https://www.notion.so/a4" },
        { id: "a5", title: "Idee EasyIsland", emoji: "💡", lastEditedAt: ago(60 * 50), url: "https://www.notion.so/a5" },
      ];
      Object.assign(Bridge, {
        notionSearch: async (q: string) => { await wait(300); return pages.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())); },
        notionPageText: async () => ["Piano di lancio Q4", "# Obiettivi\n- 500 utenti\n- [ ] Homepage nuova"],
      });
      const day = (n: number) => { const d = new Date(Date.now() + n * 86_400_000); return d.toISOString().slice(0, 10); };
      const tasks = [
        { id: "t1", title: "Rinnovo certificato SSL cliente Rossi", url: "https://www.notion.so/t1", due: day(-2), canTick: true },
        { id: "t2", title: "Chiamare il fornitore per il preventivo", url: "https://www.notion.so/t2", due: day(0), canTick: true },
        { id: "t3", title: "Backup NAS ufficio", url: "https://www.notion.so/t3", due: day(1), canTick: true },
        { id: "t4", title: "Aggiornare la documentazione VPN", url: "https://www.notion.so/t4", due: day(5), canTick: true },
        { id: "t5", title: "Idee per il sito", url: "https://www.notion.so/t5", due: null, canTick: true },
      ];
      Object.assign(Bridge, {
        notionTaskDone: async () => { await wait(400); },
        notionAddTask: async () => { await wait(400); },
        notionPostpone: async () => { await wait(400); },
        notionAddNote: async () => { await wait(500); return "Inbox"; },
      });
      // The mini Notion (notionpage.ts): a page and a database, edits answered at once.
      let n = 0;
      const sp = (t: string, a: Record<string, unknown> = {}) => ({ t, ...a });
      const blk = (type: string, spans: unknown[] = [], more: Record<string, unknown> = {}) => ({ id: `b${++n}`, type, spans, hasChildren: false, ...more });
      const page = {
        kind: "page", id: "a1", title: "Piano di lancio Q4", icon: { emoji: "🚀" }, cover: "", url: "https://www.notion.so/a1", database: null, props: [],
        blocks: [
          blk("callout", [sp("Obiettivo: "), sp("500 utenti", { b: true }), sp(" entro dicembre.")], { emoji: "🎯", color: "blue_background" }),
          blk("heading_1", [sp("Obiettivi")]),
          blk("bulleted_list_item", [sp("Homepage nuova con le "), sp("schermate", { i: true })], { hasChildren: true, children: [blk("bulleted_list_item", [sp("versione inglese")])] }),
          blk("bulleted_list_item", [sp("Post su LinkedIn e "), sp("newsletter", { u: true })]),
          blk("heading_2", [sp("Da fare")]),
          blk("to_do", [sp("Preparare il video demo")], { checked: true }),
          blk("to_do", [sp("Scrivere le note di rilascio")], { checked: false }),
          blk("to_do", [sp("Contattare 10 clienti per la beta")], { checked: false }),
          blk("toggle", [sp("Dettagli tecnici")], { hasChildren: true, children: [blk("paragraph", [sp("Build firmata, aggiornamento da GitHub.")]), blk("code", [sp("npm run pack")], { lang: "shell" })] }),
          blk("quote", [sp("Semplice prima di tutto.")]),
          blk("divider"),
          blk("numbered_list_item", [sp("Beta chiusa")]),
          blk("numbered_list_item", [sp("Beta aperta")]),
          blk("numbered_list_item", [sp("Lancio")]),
          blk("child_page", [], { title: "Comunicato stampa" }),
          blk("bookmark", [], { url: "https://github.com/EdoardoDevelop", caption: "Repository" }),
          blk("paragraph", [sp("Ultimo aggiornamento con "), sp("Marco", { mention: true })]),
        ],
      };
      const status: [string, string][] = [["Da fare", "gray"], ["In corso", "blue"], ["Fatto", "green"]];
      const prioOpts: [string, string][] = [["Alta", "red"], ["Media", "yellow"], ["Bassa", "green"]];
      const cells = (title: string, st: string, pr: string, due: string, ok: boolean) => ({
        Nome: { kind: "title", text: title },
        Stato: { kind: "status", text: st, color: status.find((s) => s[0] === st)?.[1] },
        Priorità: { kind: "select", text: pr, color: prioOpts.find((s) => s[0] === pr)?.[1] },
        Scadenza: { kind: "date", text: due, date: due },
        Cliente: { kind: "rich_text", text: ["Rossi Srl", "Bianchi", "Verdi & C."][title.length % 3] },
        Fatturato: { kind: "checkbox", text: "", checked: ok },
      });
      const db = {
        kind: "database", id: "a3", title: "Ticket aperti", icon: { emoji: "🎫" }, cover: "", url: "https://www.notion.so/a3",
        columns: [
          { name: "Nome", kind: "title", options: [] }, { name: "Stato", kind: "status", options: status },
          { name: "Priorità", kind: "select", options: prioOpts }, { name: "Scadenza", kind: "date", options: [] },
          { name: "Cliente", kind: "rich_text", options: [] }, { name: "Fatturato", kind: "checkbox", options: [] },
        ],
        rows: [
          ["Stampante ufficio non stampa", "Da fare", "Alta", day(0), false],
          ["VPN lenta da casa", "In corso", "Media", day(1), false],
          ["Nuovo PC per Giulia", "In corso", "Bassa", day(4), false],
          ["Rinnovo licenze Office", "Da fare", "Media", day(9), false],
          ["Backup NAS fallito", "Fatto", "Alta", day(-1), true],
        ].map(([a, b, c, d, e], i) => ({ id: `r${i}`, url: `https://www.notion.so/r${i}`, icon: null, cover: "", cells: cells(a as string, b as string, c as string, d as string, e as boolean) })),
      };
      const rowOf = (id: string) => db.rows.find((r) => r.id === id)!;
      Object.assign(Bridge, {
        notionOpenPage: async (id: string) => {
          await wait(500);
          const r = db.rows.find((x) => x.id === id);
          if (r) {
            return { kind: "page", id, title: r.cells.Nome.text, icon: null, cover: "", url: r.url, database: "a3",
              props: Object.entries(r.cells).filter(([k]) => k !== "Nome").map(([name, cell]) => ({ name, cell })),
              blocks: [blk("paragraph", [sp("Segnalato al telefono, da richiamare.")]), blk("to_do", [sp("Controllare i driver")])] };
          }
          return id === "a1" ? page : { ...page, id, title: pages.find((p) => p.id === id)?.title ?? "Pagina", icon: { emoji: "📄" }, blocks: page.blocks.slice(1, 6) };
        },
        notionOpenDatabase: async () => { await wait(500); return db; },
        notionBlockText: async () => { await wait(250); },
        notionBlockCheck: async () => { await wait(250); },
        notionBlockAdd: async (_p: string, _a: string | null, kind: string, spans: unknown[]) => { await wait(250); return blk(kind, spans, kind === "to_do" ? { checked: false } : {}); },
        notionBlockRetype: async (_p: string, _id: string, kind: string, spans: unknown[]) => { await wait(250); return blk(kind, spans); },
        notionBlockDelete: async () => { await wait(250); },
        notionPageTitle: async () => { await wait(250); },
        notionRowSet: async (id: string, name: string, kind: string, value: unknown) => {
          await wait(250);
          const r = rowOf(id) as { cells: Record<string, Record<string, unknown>> };
          const c = r.cells[name];
          if (kind === "checkbox") c.checked = value;
          else { c.text = String(value); if (kind === "date") c.date = String(value); c.color = [...status, ...prioOpts].find((s) => s[0] === value)?.[1]; }
          return r;
        },
        notionRowAdd: async (_db: string, title: string, name?: string, _k?: string, value?: string) => {
          await wait(300);
          const r = { id: `r${++n}`, url: "", icon: null, cover: "", cells: cells(title, name === "Stato" ? value ?? "Da fare" : "Da fare", "Bassa", "", false) };
          db.rows.push(r);
          return r;
        },
        notionPageDelete: async () => { await wait(250); },
        notionImage: async () => { throw new Error("no"); },
      });
      State.settings.integrationConfig.notionPins = pages.filter((p) => ["a1", "a3", "a4", "a2"].includes(p.id))
        .map((p) => ({ id: p.id, title: p.title, emoji: p.emoji, url: p.url, database: !!p.database }));
      State.settings.integrationConfig.notionTasks = { id: "db", title: "Attività", emoji: "✅", url: "https://www.notion.so/db", database: true };
      State.settings.integrationConfig.notionInbox = new URLSearchParams(location.search).has("noinbox") ? null
        : { id: "in", title: "Inbox", emoji: "📥", url: "https://www.notion.so/in", database: false };
      await wait(300);
      // &views: three views saved in the settings, chips in the card, priority dots.
      const withViews = new URLSearchParams(location.search).has("views");
      const prio = (name: string, color: string) => [name, color];
      const data: Record<string, unknown> = { tasks, tasksSet: true };
      if (withViews) {
        State.settings.integrationConfig.notionViews = [
          { name: "Oggi", period: "today", days: 7, undated: false, filters: [], sort: "due" },
          { name: "Ufficio", period: "week", days: 7, undated: true, filters: [{ prop: "Contesto", kind: "multi_select", values: ["Ufficio"] }], sort: "priority" },
          { name: "EasyIsland", period: "all", days: 7, undated: true, filters: [], sort: "due" },
        ];
        State.settings.integrationConfig.notionView = "Ufficio";
        data.byView = {
          Oggi: tasks.slice(0, 2),
          Ufficio: [
            { ...tasks[2], priority: prio("Alta", "red") },
            { ...tasks[0], priority: prio("Media", "yellow") },
            { ...tasks[3], priority: prio("Bassa", "green") },
          ],
          EasyIsland: tasks.slice(3),
        };
      }
      State.integrations.integration_notion = { data, error: null, loaded: true, configured: true };
      State.setFocus("integration_notion");
      island.alert("overview");
      await wait(1500);
      break;
    }
    case "rdm": {
      // ?activeIntegrations=integration_rdm — the card with made-up connections (Bridge mocked);
      // &q=rossi: a search; &nolist: no PowerShell module (the search opens in RDM).
      const q = new URLSearchParams(location.search);
      const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const list = [
        { id: id(1), name: "NAS Rossi", group: "Clienti\\Rossi Srl", host: "192.168.1.10", kind: "RDPConfigured" },
        { id: id(2), name: "Server Rossi", group: "Clienti\\Rossi Srl", host: "srv01.rossi.local", kind: "RDPConfigured" },
        { id: id(3), name: "Firewall Rossi", group: "Clienti\\Rossi Srl", host: "192.168.1.1", kind: "WebBrowser" },
        { id: id(4), name: "Router Bianchi", group: "Clienti\\Bianchi", host: "10.0.0.1", kind: "SSHShell" },
        { id: id(5), name: "Gestionale", group: "Interni", host: "gest.local", kind: "RDPConfigured" },
      ];
      const nolist = q.has("nolist");
      Object.assign(Bridge, {
        rdmSearch: async (text: string) => nolist ? [] : list.filter((e) => text.toLowerCase().split(/\s+/).every((w) => `${e.name} ${e.group} ${e.host}`.toLowerCase().includes(w))),
        rdmOpen: async () => { await wait(200); },
        rdmEdit: async () => {},
        rdmFilter: async () => {},
        rdmQuick: async () => {},
      });
      State.settings.integrationConfig.rdmPins = nolist ? [] : [list[4]];
      State.settings.integrationConfig.rdmRecent = nolist ? [] : [list[1], list[3]];
      await wait(300);
      State.integrations.integration_rdm = { data: nolist ? { count: 0, exe: true, protocol: true } : { count: 214, dataSource: "Ufficio", exe: true, protocol: true }, error: null, loaded: true, configured: true };
      State.setFocus("integration_rdm");
      island.alert("overview");
      if (q.get("q")) {
        await wait(600);
        rdmLookFor(q.get("q") ?? "");
      }
      await wait(1500);
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
        // &plain: a selection without formatting; &lost: formatting the model did not keep.
        formatted: !p.has("plain") && !p.has("lost"),
        lost: p.has("lost"),
      };
      State.rewrite.formattedText = State.rewrite.formatted ? State.rewrite.result : "";
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
    case "custom": {
      // An integration made from the chat (custom.rs): «Preventivi», with rows and totals.
      await wait(300);
      const field = (o: Partial<CustomField>): CustomField =>
        ({ id: "", label: "", kind: "text", options: [], required: false, default: "", help: "", columns: [], formula: "", ...o });
      State.customs = [{
        id: "preventivi", name: "Preventivi", icon: "🧾", color: "#22C55E", description: "Preventivi per i clienti", enabled: true, titleField: "cliente",
        fields: [
          field({ id: "numero", label: "Numero", kind: "counter", prefix: "PREV-{anno}-", digits: 3 }),
          field({ id: "cliente", label: "Cliente", required: true }),
          field({ id: "data", label: "Data", kind: "date", default: "oggi" }),
          field({ id: "voci", label: "Voci", kind: "rows", columns: [
            { id: "descrizione", label: "Descrizione", kind: "text", options: [] },
            { id: "quantita", label: "Quantità", kind: "number", options: [] },
            { id: "prezzo", label: "Prezzo", kind: "money", options: [] },
            { id: "totale_riga", label: "Totale", kind: "computed", options: [], formula: "quantita*prezzo" }] }),
          field({ id: "imponibile", label: "Imponibile", kind: "computed", formula: "sum(totale_riga)" }),
          field({ id: "iva", label: "IVA 22%", kind: "computed", formula: "imponibile*0,22" }),
          field({ id: "totale", label: "Totale", kind: "computed", formula: "imponibile+iva", summary: true }),
          field({ id: "pagamento", label: "Pagamento", kind: "select", options: ["Bonifico 30 gg", "Rimessa diretta"] }),
          field({ id: "urgente", label: "Urgente", kind: "checkbox" }),
          field({ id: "motivo", label: "Motivo dell'urgenza", showIf: "urgente" }),
        ],
        template: "# Preventivo per {{cliente}}\n\n| Voce | Q.tà | Prezzo |\n|---|---|---|\n{{#voci}}| {{descrizione}} | {{quantita}} | {{prezzo}} |\n{{/voci}}\n\n**Totale: {{totale}}**",
        actions: [
          { label: "Salva", kind: "save", prompt: "", url: "", quick: "", database: "", format: "" },
          { label: "Crea il documento", kind: "document", prompt: "", url: "", quick: "", database: "", format: "html" },
          { label: "Compila da una mail", kind: "fill", prompt: "", url: "", quick: "", database: "", format: "" },
          { label: "Esporta CSV", kind: "export", prompt: "", url: "", quick: "", database: "", format: "" },
          { label: "Chiedi un testo d'accompagnamento", kind: "ai", prompt: "Scrivi una mail breve per mandare il preventivo a {{cliente}} (totale {{totale}}).", url: "", quick: "", database: "", format: "" },
        ],
      }];
      // ?dati: a dashboard of data from a service, with an alert (sources in custom.rs).
      State.customs.push({
        id: "server", name: "Server dei clienti", icon: "🖥️", color: "#0EA5E9", description: "Stato e spazio libero", enabled: true, titleField: "",
        fields: [], template: "", actions: [], secrets: ["token"],
        sources: [{ id: "stato", label: "Stato", url: "https://status.esempio.it/api", every: 5, items: "servers", title: "name", subtitle: "client",
          value: "disk", values: { "In linea": "summary.online", "Spenti": "summary.offline" }, alert: "disk > 90 o non online", alertText: "{{name}} ({{client}}): disco {{disk}}%" }],
      });
      const notices: unknown[] = [];
      receiveSource(State.customs[1], "stato", { at: "10:30", data: { summary: { online: 2, offline: 1 }, servers: [
        { name: "SRV-01", client: "Rossi Srl", disk: 71, online: true },
        { name: "SRV-02", client: "Bianchi Spa", disk: 94, online: true },
        { name: "NAS", client: "Studio Verdi", disk: 40, online: false }] } }, (n) => notices.push(n));
      // For the checks of scripts/ (fillTemplate, toCsv, formulas, the alerts said).
      (window as unknown as { customKit: unknown }).customKit = { fillTemplate, toCsv, run, scopeOf, notices, custom: State.customs[0] };
      State.loadIntegrationTasks();
      State.setFocus(new URLSearchParams(location.search).has("dati") ? "custom:server" : "custom:preventivi");
      State.isPinned = true;
      island.alert("overview");
      await wait(1500);
      break;
    }
    case "compiti": {
      // A task of EasyIsland at work (tasks.rs), as its hook payloads reach the
      // island: the plan's steps in the Agenti tab. ?ask: its question card.
      await wait(300);
      (window as unknown as { island: Island }).island = island;
      const task = { easyisland_agent: { id: "compiti", name: "Compiti", color: "#0EA5E9" }, easyisland_host: "compiti",
        session_id: "task-1", cwd: "Resoconto mensile Rossi" };
      handleHook(island, { hook_event_name: "SessionStart", ...task });
      handleHook(island, { hook_event_name: "UserPromptSubmit", prompt: "Resoconto mensile Rossi", ...task });
      for (const step of ["Piano: 4 passi", "Letti i 12 ticket di settembre", "Bozza del resoconto in Notion"]) {
        handleHook(island, { hook_event_name: "PreToolUse", tool_name: "Compito", tool_input: { step }, ...task });
        handleHook(island, { hook_event_name: "PostToolUse", tool_name: "Compito", tool_input: { step }, ...task });
      }
      if (new URLSearchParams(location.search).has("ask")) {
        handleHook(island, { hook_event_name: "PermissionRequest", request_id: "ask-1", tool_name: "AskUserQuestion", ...task,
          tool_input: { questions: [{ question: "Includo anche le ore di ottobre fatturate a parte?", header: "Compito",
            options: [{ label: "Sì", description: "" }, { label: "No", description: "" }], multiSelect: false }] } });
      } else {
        State.setFocus("agent:compiti");
        State.isPinned = true;
        island.alert("overview");
      }
      await wait(1500);
      break;
    }
    case "moment": {
      // A proposal at the right moment (src/island/moments.ts), through the real
      // handler: ?moment=download (default), error, port, server, card, tray, recording.
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
        recording: { kind: "recording", name: "Registrazione 2026-10-16 15.30.12.m4a", path: "C:/x/Registrazione.m4a", size: 1_240_000, seconds: 312 },
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
