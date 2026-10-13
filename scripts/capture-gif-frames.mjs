// Cattura N frame reali dall'anteprima (dev server acceso) per farne GIF vere.
// Uso: node scripts/capture-gif-frames.mjs <outdir>
// Ogni scena: naviga, aspetta il settle, poi scatta 1 frame ogni 150ms.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:1420";
const PORT = 9334;
const OUT = process.argv[2] ?? join(ROOT, "site", "media", "frames");

const PILLS = "integration_network,integration_weather,integration_zammad,integration_media,integration_clipboard,integration_3cx";

// Scena -> {url, frames, waitBefore (ms), clip: 'island'|'full'}
const JOBS = {
  // Goccia che saluta all'avvio (animata): intera finestra piccola
  saluto: { url: "/?scene=greeting", frames: 24, settle: 300, page: { w: 560, h: 420 }, clip: "full" },
  // Isola che si apre sulla panoramica
  isola: { url: `/?scene=overview&activeIntegrations=${PILLS}`, frames: 16, settle: 400, page: { w: 760, h: 600 }, clip: "island" },
  // Permesso di Claude Code
  permesso: { url: "/?scene=approval", frames: 16, settle: 1200, page: { w: 760, h: 600 }, clip: "island" },
  // Fiamma che tremola (animated, 30fps a isola visibile)
  fiamma: { url: "/dev/greeting-preview.html?character=flame", frames: 20, settle: 1500, page: { w: 560, h: 420 }, clip: "full" },
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
const profile = join(tmpdir(), `easyisland-gif-${Date.now()}`);
mkdirSync(profile, { recursive: true });
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

async function capture(job, name) {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  await send("Emulation.setDeviceMetricsOverride", {
    width: job.page.w, height: job.page.h, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: BASE + job.url });
  await sleep(job.settle);
  let clip = null;
  if (job.clip === "island") {
    for (let i = 0; i < 40 && !clip; i++) {
      await sleep(250);
      clip = await evaluate(`document.title.startsWith("scene ready")
        ? (() => { const r = document.getElementById("island").getBoundingClientRect();
                   return { x: r.left, y: r.top, width: r.width, height: r.height }; })()
        : null`);
    }
  } else {
    await sleep(1000);
  }
  for (let i = 0; i < job.frames; i++) {
    const params = { format: "png", captureBeyondViewport: true };
    if (clip) params.clip = { ...clip, scale: 1 };
    const shot = await send("Page.captureScreenshot", params);
    writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.png`), Buffer.from(shot.data, "base64"));
    await sleep(150);
  }
  console.log(`${name}: ${job.frames} frame`);
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
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 30, g: 31, b: 36, a: 255 } });
  const only = process.argv.slice(3);
  for (const [name, job] of Object.entries(JOBS)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await capture(job, name);
    } catch (err) {
      console.log(`${name} NON riuscito: ${err.message}`);
    }
  }
} finally {
  ws?.close();
  edge.kill();
}
console.log("OK");
