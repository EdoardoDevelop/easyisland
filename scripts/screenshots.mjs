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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:1420";
const PORT = 9333;

// The integrations a typical setup shows as pills next to the card.
const PILLS = "integration_network,integration_weather,integration_zammad,integration_media,integration_clipboard,integration_3cx";

const SHOTS = {
  greeting: { url: "/?scene=greeting" },
  compact: { url: `/?scene=compact&hoverStyle=bar&revealDuration=0&activeIntegrations=${PILLS}` },
  overview: { url: `/?scene=overview&activeIntegrations=${PILLS}` },
  approval: { url: "/?scene=approval" },
  chat: { url: "/?scene=chat" },
  drop: { url: "/?scene=drop" },
  actions: { url: "/?scene=actions&activeIntegrations=" },
  threecx: { url: `/?scene=threecx&activeIntegrations=${PILLS}` },
  clipboard: { url: `/?scene=clipboard&activeIntegrations=${PILLS}` },
  media: { url: `/?scene=media&activeIntegrations=${PILLS}` },
  network: { url: `/?scene=network&activeIntegrations=${PILLS}` },
  suggestion: { url: "/?scene=suggestion" },
  // Whole windows, not an island.
  settings: { url: "/settings.html?page=aspetto", page: { w: 980, h: 720 } },
  "settings-integrations": { url: "/settings.html?page=integrazioni", page: { w: 980, h: 720 } },
  "settings-automations": { url: "/settings.html?page=automazioni", page: { w: 980, h: 720 } },
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
  await send("Page.navigate", { url: BASE + s.url });
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
  }
  const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  writeFileSync(join(ROOT, "screenshots", `${name}.png`), Buffer.from(shot.data, "base64"));
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
  rmSync(profile, { recursive: true, force: true });
}
