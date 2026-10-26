// Re-shoots the README screenshots from the browser preview, driving Microsoft
// Edge (already on every Windows PC) headless over the DevTools protocol — no
// dependencies, Node's own WebSocket. Needs the dev server:
//
//   npm run dev                        (in another terminal)
//   node scripts/screenshots.mjs       (all)  ·  node scripts/screenshots.mjs chat
//
// Island scenes are staged by dev/scenes.ts, which sets the page title to
// "scene ready" once the island has settled; the shot is clipped to the island,
// on a transparent background, at 2× for sharp images.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Edge's profile folder. Edge's child processes outlive edge.kill() for a
 * moment and keep it locked: retry, and sweep the ones earlier runs left
 * behind (they piled up to tens of GB in %TEMP%).
 */
function removeProfile(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* the next run sweeps it */ }
}
for (const name of (() => { try { return readdirSync(tmpdir()); } catch { return []; } })()) {
  if (!name.startsWith("easyisland-shot-")) continue;
  const dir = join(tmpdir(), name);
  try { if (Date.now() - statSync(dir).mtimeMs > 3600_000) removeProfile(dir); } catch { /* gone already */ }
}


const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:1420";
const PORT = 9333;
// SHOT_DIR=… saves elsewhere (trying a change without touching the README's
// images); SHOT_QUERY=ui=classic adds to every page's query.
const OUT = process.env.SHOT_DIR ?? join(ROOT, "screenshots");
// Italian unless asked: headless Edge reports English, and the page follows it.
const QUERY = process.env.SHOT_QUERY ?? "lang=it";

// The integrations a typical setup shows as pills next to the card.
const PILLS = "integration_network,integration_weather,integration_zammad,integration_media,integration_clipboard,integration_3cx";

const SHOTS = {
  greeting: { url: "/?scene=greeting" },
  compact: { url: `/?scene=compact&hoverStyle=bar&revealDuration=0&activeIntegrations=${PILLS}` },
  overview: { url: `/?scene=overview&activeIntegrations=${PILLS}` },
  approval: { url: "/?scene=approval" },
  chat: { url: "/?scene=chat" },
  "chat-history": { url: "/?scene=chat&history" },
  agenti: { url: "/?scene=agenti" },
  compiti: { url: "/?scene=compiti" },
  custom: { url: "/?scene=custom" },
  "custom-dati": { url: "/?scene=custom&dati" },
  "compiti-ask": { url: "/?scene=compiti&ask" },
  recap: { url: "/?scene=recap" },
  drop: { url: "/?scene=drop" },
  actions: { url: "/?scene=actions&activeIntegrations=" },
  threecx: { url: `/?scene=threecx&activeIntegrations=${PILLS}` },
  clipboard: { url: `/?scene=clipboard&activeIntegrations=${PILLS}` },
  media: { url: `/?scene=media&activeIntegrations=${PILLS}` },
  network: { url: `/?scene=network&activeIntegrations=${PILLS}` },
  suggestion: { url: "/?scene=suggestion" },
  meteo: { url: `/?scene=meteo&sky=sun-cloud&activeIntegrations=${PILLS}` },
  files: { url: `/?scene=files&activeIntegrations=${PILLS}` },
  "strip-approval": { url: "/?scene=strip&strip=approval" },
  "strip-call": { url: "/?scene=strip&strip=call&activeIntegrations=integration_3cx" },
  rewrite: { url: "/?scene=rewrite" },
  "moment-download": { url: `/?scene=moment&moment=download&activeIntegrations=${PILLS}` },
  "moment-error": { url: `/?scene=moment&moment=port&activeIntegrations=${PILLS}` },
  "moment-card": { url: `/?scene=moment&moment=card&activeIntegrations=${PILLS}` },
  daily: { url: `/?scene=daily&activeIntegrations=${PILLS}` },
  // Every character but the cube, without the island (dev/characters.html).
  characters: { url: "/dev/characters.html" },
  // Whole windows, not an island.
  settings: { url: "/settings.html?page=aspetto", page: { w: 980, h: 720 } },
  "settings-integrations": { url: "/settings.html?page=integrazioni", page: { w: 980, h: 720 } },
  // The flows window (src/flows/), on a ready-made template.
  "settings-automations": { url: "/flussi.html", page: { w: 1180, h: 760 },
    then: `document.querySelector(".fl-side button.primary, button.primary")?.click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelectorAll(".fl-template")[2]?.click();` },
  "settings-compiti": { url: "/settings.html?page=compiti", page: { w: 980, h: 720 } },
  // The memory window (src/memory/), on its made-up memory.
  "memoria-grafo": { url: "/memoria.html?tab=graph&select=p:studio-rossi", page: { w: 1180, h: 760 } },
  "memoria-mappa": { url: "/memoria.html?tab=mind&select=p:studio-rossi", page: { w: 1180, h: 760 } },
  "memoria-concetti": { url: "/memoria.html?tab=concept", page: { w: 1180, h: 760 } },
  "memoria-timeline": { url: "/memoria.html?tab=timeline", page: { w: 1180, h: 760 } },
  // The guide of the homepage (site/guida/, node scripts/guida.mjs).
  guida: { url: "/site/guida/memoria.html", page: { w: 1280, h: 800 } },
  "guide-en": { url: "/site/en/guide/tasks.html", page: { w: 1280, h: 800 } },
  "home-en": { url: "/site/en/index.html", page: { w: 1280, h: 800 } },
};

const EDGE = [
  join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Microsoft/Edge/Application/msedge.exe"),
].find((p) => existsSync(p));
if (!EDGE) {
  console.error("Microsoft Edge non trovato.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "easyisland-shot-"));
const edge = spawn(EDGE, [
  "--headless=new", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--window-size=1100,800", "about:blank",
], { stdio: "ignore" });

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Edge non risponde sul DevTools protocol.");
}

let ws;
let nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

async function shoot(name, s) {
  const page = s.page ?? { w: 760, h: 600 };
  await send("Emulation.setDeviceMetricsOverride", { width: page.w, height: page.h, deviceScaleFactor: 2, mobile: false });
  const url = QUERY ? BASE + s.url + (s.url.includes("?") ? "&" : "?") + QUERY : BASE + s.url;
  await send("Page.navigate", { url });
  let clip = { x: 0, y: 0, width: page.w, height: page.h, scale: 1 };
  if (!s.page) {
    let rect = null;
    for (let i = 0; i < 80 && !rect; i++) {
      await sleep(250);
      rect = await evaluate(`document.title.startsWith("scene ready")
        ? (() => { const r = document.getElementById("island").getBoundingClientRect();
                   return { x: r.left, y: r.top, width: r.width, height: r.height }; })()
        : null`);
    }
    if (!rect) throw new Error("la scena non è pronta");
    clip = { ...rect, scale: 1 };
  } else {
    await sleep(1500);
    // `then`: script run on the page before the shot (a click, a template).
    if (s.then) {
      await evaluate(`(async () => { ${s.then} })()`);
      await sleep(800);
    }
  }
  const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
  console.log(`${name}.png ${Math.round(clip.width)}×${Math.round(clip.height)}`);
}

try {
  ws = new WebSocket(await target());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  };
  await send("Page.enable");
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const only = process.argv.slice(2);
  for (const [name, s] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await shoot(name, s);
    } catch (err) {
      console.log(`${name}.png NON riuscito: ${err.message}`);
    }
  }
} finally {
  ws?.close();
  edge.kill();
  await sleep(500);
  removeProfile(profile);
}
