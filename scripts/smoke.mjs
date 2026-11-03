// Smoke test of the island in the browser preview, driving Microsoft Edge
// headless over the DevTools protocol (no dependencies, like screenshots.mjs).
// Every scene of dev/scenes.ts is opened, then every row of the menu clicked,
// the island resized, closed and opened again; any exception or console error
// is reported, and the exit code is the number of scenes that had one.
//
//   npm run dev                (in another terminal)
//   node scripts/smoke.mjs     (all)  ·  node scripts/smoke.mjs chat meteo
//   npm run smoke:rapido       (the island's views and the chat only)
//
// Several Edges at once (SMOKE_JOBS, up to 6 of serie), each with its own
// profile and port: one at a time took over ten minutes.
// PREVIEW_URL when the dev server answers only on localhost.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Edge's profile folder. Edge's child processes outlive edge.kill() for a
 * moment and keep it locked: retry, and sweep the ones earlier runs left
 * behind (they piled up to tens of GB in %TEMP%).
 */
function removeProfile(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* the next run sweeps it */ }
}
for (const name of (() => { try { return readdirSync(tmpdir()); } catch { return []; } })()) {
  if (!name.startsWith("easyisland-smoke-")) continue;
  const dir = join(tmpdir(), name);
  try { if (Date.now() - statSync(dir).mtimeMs > 3600_000) removeProfile(dir); } catch { /* gone already */ }
}


const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:1420";
const ALL = "integration_network,integration_weather,integration_zammad,integration_media,integration_clipboard,integration_3cx,integration_system,integration_security,integration_claude_usage,integration_github,integration_n8n";

const SCENES = [
  "greeting", "compact", "overview", "approval", "permission", "chat", "chat&history", "agenti", "compiti", "compiti&ask", "custom", "custom&dati", "agents", "recap", "drop",
  "files", "actions", "threecx", "clipboard", "media", "network", "usage", "meteo", "meteo&sky=storm&night", "suggestion",
  "rewrite", "diff", "finished", "stop", "capture", "strip&strip=approval", "strip&strip=call", "strip&strip=live",
  "strip&strip=work&compactStrip=left",
  "moment", "moment&moment=zip", "moment&moment=tray", "moment&moment=error", "moment&moment=port", "moment&moment=server",
  "moment&moment=card", "daily", "daily&evening", "done", "done&alone", "search", "remember", "remember&empty", "talk", "talk&hearing", "remember&call", "moment&moment=call", "moment&moment=ticket", "moment&moment=agentchat", "agentchat", "agentchat&busy&write", "agentchat&off", "agentchat&empty",
  // Random events, clicks and malformed data (dev/scenes.ts `fuzz`), a few seeds.
  "fuzz&seed=1", "fuzz&seed=2", "fuzz&seed=3", "fuzz&seed=4", "fuzz&seed=5",
];

// The settings window, page by page: every select, switch and field changed.
// Aspetto one tab at a time (src/settings/main.ts → LOOK_TABS).
const SETTINGS = ["generale", ...["tema", "font", "personaggio", "posizione", "barra", "chiusa", "aperta"].map((x) => `aspetto&tab=${x}`), "notifiche", "chat", "claude", "azioni", "compiti", "integrazioni", "widget", "notizie", "backup"];

const EDGE = [
  join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Microsoft/Edge/Application/msedge.exe"),
].find((p) => existsSync(p));
if (!EDGE) {
  console.error("Microsoft Edge non trovato.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One headless Edge with one page, driven over the DevTools protocol. */
class Runner {
  constructor(n) {
    this.port = 9334 + n;
    this.profile = mkdtempSync(join(tmpdir(), "easyisland-smoke-"));
    this.edge = spawn(EDGE, [
      "--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`, "--window-size=1100,800", "about:blank",
    ], { stdio: "ignore" });
    this.nextId = 0;
    this.pending = new Map();
    this.problems = [];
  }

  async target() {
    for (let i = 0; i < 50; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
        const page = list.find((t) => t.type === "page");
        if (page) return page.webSocketDebuggerUrl;
      } catch { /* not up yet */ }
      await sleep(200);
    }
    throw new Error("Edge non risponde sul DevTools protocol.");
  }

  async start() {
    this.ws = new WebSocket(await this.target());
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.problems.push(`eccezione: ${d.exception?.description ?? d.text}`);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
      }
      // A confirm() or alert() of a button: dismissed, or the page would hang.
      if (msg.method === "Page.javascriptDialogOpening") void this.send("Page.handleJavaScriptDialog", { accept: false });
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) this.problems.push(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  }

  async stop() {
    this.ws?.close();
    this.edge.kill();
    await sleep(500);
    removeProfile(this.profile);
  }
}

// What a user does: every menu row, the corner, close and open again.
const EXERCISE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const island = window.island;
  if (!island) return "no island";
  const done = [];
  for (const b of [...document.querySelectorAll("#rail .rail-item")]) {
    b.click();
    await wait(250);
    done.push(b.dataset.rail);
  }
  const g = document.getElementById("island-resize");
  if (g && g.offsetParent) {
    const ev = (type, x, y) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, screenX: x, screenY: y }));
    ev("pointerdown", 400, 400); ev("pointermove", 300, 200); ev("pointermove", 700, 900); ev("pointerup", 700, 900);
    g.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }
  island.collapse?.(true);
  await wait(600);
  island.alert?.("overview");
  await wait(600);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(400);
  return done.join(",");
})()`;

// Every control of a settings page used once, buttons included (dialogs are dismissed).
const SETTINGS_EXERCISE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  for (const el of [...document.querySelectorAll("select")]) {
    for (const o of [...el.options]) { el.value = o.value; el.dispatchEvent(new Event("change", { bubbles: true })); n++; }
  }
  for (const el of [...document.querySelectorAll("input[type=checkbox]")]) {
    el.click(); await wait(10); el.click(); n++;
  }
  for (const el of [...document.querySelectorAll("input[type=text], input:not([type]), input[type=number], textarea")]) {
    el.value = el.type === "number" ? "-1" : "prova «àè» 😀"; el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true })); n++;
  }
  for (const el of [...document.querySelectorAll("main button, .page button")].slice(0, 60)) {
    if (!el.isConnected || el.disabled || !el.offsetParent) continue;
    el.click(); n++; await wait(30);
  }
  await wait(400);
  return n + " controlli";
})()`;

/** A settings page: its lines for the report, and whether it had errors. */
async function runSettings(r, page) {
  r.problems = [];
  await r.send("Page.navigate", { url: `${BASE}/settings.html?page=${page}` });
  // Until its controls are there and stop growing: with several Edges at once
  // a fixed wait found an empty page, and "0 controlli" passed as fine.
  let seen = -1;
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    await sleep(250);
    const n = await r.evaluate(`document.querySelectorAll("select, input, main button, .page button").length`);
    ready = n > 0 && n === seen;
    seen = n;
  }
  if (!ready) r.problems.push("la pagina non è pronta");
  const did = await r.evaluate(SETTINGS_EXERCISE);
  await sleep(300);
  const problems = r.problems.filter((p) => !p.includes("chrome-extension://") && !p.includes("favicon.ico"));
  const lines = [`${problems.length ? "ERRORI" : "ok".padEnd(6)} impostazioni/${page}  [${did}]`];
  for (const p of [...new Set(problems)]) lines.push(`       · ${p.split("\n").slice(0, 4).join("\n         ")}`);
  return { lines, bad: problems.length > 0 };
}

/** A scene of dev/scenes.ts: its lines for the report, and whether it had errors. */
async function run(r, scene) {
  r.problems = [];
  await r.send("Page.navigate", { url: `${BASE}/?scene=${scene}&activeIntegrations=${ALL}` });
  // "permission" leaves the page as it is on purpose (no "scene ready").
  const loose = scene === "permission";
  let ready = false;
  for (let i = 0; i < (loose ? 12 : 100) && !ready; i++) {
    await sleep(250);
    ready = await r.evaluate(`document.title.startsWith("scene ready")`);
  }
  if (!ready && !loose) r.problems.push("la scena non è pronta");
  const rows = await r.evaluate(EXERCISE);
  await sleep(300);
  // Edge's own built-in extensions and the missing favicon are not ours.
  const problems = r.problems.filter((p) => !p.includes("chrome-extension://") && !p.includes("favicon.ico"));
  const lines = [`${(problems.length ? "ERRORI" : "ok").padEnd(6)} ${scene}${rows ? `  [${rows}]` : ""}`];
  for (const p of [...new Set(problems)]) lines.push(`       · ${p.split("\n").slice(0, 4).join("\n         ")}`);
  return { lines, bad: problems.length > 0 };
}

const only = process.argv.slice(2);
const jobs = [
  ...SCENES.filter((scene) => !only.length || only.some((o) => scene.startsWith(o))).map((scene) => ({ scene })),
  ...SETTINGS.filter((page) => !only.length || only.some((o) => `impostazioni/${page}`.startsWith(o) || o === "impostazioni")).map((page) => ({ page })),
];
const width = Math.max(1, Math.min(jobs.length, Number(process.env.SMOKE_JOBS) || Math.min(6, Math.max(1, Math.floor(cpus().length / 2)))));
const results = new Array(jobs.length);
const runners = Array.from({ length: width }, (_, n) => new Runner(n));
const started = Date.now();
let next = 0;
let failed = 0;
try {
  await Promise.all(runners.map(async (r) => {
    await r.start();
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      results[i] = job.scene !== undefined ? await run(r, job.scene) : await runSettings(r, job.page);
      // Progress as it goes; the report in order at the end.
      process.stdout.write(`\r${results.filter(Boolean).length}/${jobs.length} `);
    }
  }));
} finally {
  await Promise.all(runners.map((r) => r.stop()));
}
process.stdout.write("\r");
for (const res of results) {
  if (!res) continue;
  for (const l of res.lines) console.log(l);
  if (res.bad) failed++;
}
console.log(`\n${jobs.length} prove in ${Math.round((Date.now() - started) / 1000)} s con ${width} Edge`);
console.log(failed ? `${failed} scene con errori` : "nessun errore");
process.exit(failed);
