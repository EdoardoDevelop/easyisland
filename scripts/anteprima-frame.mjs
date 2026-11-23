// The page scripts of preview.rs (FRAMES, SNAPSHOT, FIND_ALL, FIND, WAIT, READ,
// EXTRACT) tried in headless Edge (Chromium, as WebView2) on a page with an
// iframe of the same site (as iLO and iDRAC) and one of another site.
//   node scripts/anteprima-frame.mjs src-tauri/src/preview.rs
// No app, no network: two local servers on free ports.
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(process.argv[2], "utf8").replace(/\r\n/g, "\n");
const grab = (name) => { const m = src.match(new RegExp("const " + name + ": &str = r#\"([\\s\\S]*?)\"#;")); if (!m) throw new Error("no " + name); return m[1]; };
const FRAMES = grab("FRAMES"), SNAPSHOT = grab("SNAPSHOT"), FIND_ALL = grab("FIND_ALL"), FIND = grab("FIND"), WAIT = grab("WAIT"), READ = grab("READ"), EXTRACT = grab("EXTRACT");

const pages = {
  "/": `<!doctype html><title>iLO</title><h1>Pagina esterna</h1><div style="height:300px"></div>
<iframe id="app" title="application" src="/inner.html" style="width:600px;height:400px;border:5px solid #000;margin-left:40px"></iframe>
<iframe src="http://127.0.0.1:${0}/other.html" title="altro"></iframe>`,
  "/inner.html": `<!doctype html><body><h2>Firmware</h2><p id="st">In progress</p>
<button id="up" onclick="window.clicks=(window.clicks||0)+1;this.textContent='Cliccato '+window.clicks">Update Firmware</button>
<input id="name" aria-label="Nome file"><button>Aggiungi al carrello</button>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"SPS 4.1.5","offers":{"price":"0","priceCurrency":"EUR"}}</script></body>`,
};
const server = createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end((pages[q.url] || "x").replace("${0}", other.address().port)); });
const other = createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end("<button>Segreto altro sito</button>"); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
await new Promise((ok) => other.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

const port = 9400 + Math.floor(Math.random() * 300);
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ei-frames-"))}`, "--window-size=1100,900", url], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok));
let id = 0; const wait = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((ok) => { const n = ++id; wait.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
await new Promise((r) => setTimeout(r, 1500));

let fails = 0;
const check = (what, ok, detail = "") => { console.log((ok ? "ok   " : "FAIL ") + what + (detail ? "  → " + detail : "")); if (!ok) fails++; };

const snap = await ev(`${FRAMES}(${SNAPSHOT})()`);
console.log(snap.tree);
check("snapshot legge l'iframe dello stesso sito", /\[frame=f1\]:/.test(snap.tree) && /Update Firmware/.test(snap.tree));
check("ref dentro il frame con prefisso", /button "Update Firmware" \[ref=f1e\d+\]/.test(snap.tree));
// Another site's frame: the page script only marks it (address); WebView2 reads it (preview_page.rs).
check("iframe di un altro sito segnato, non letto dallo script", /iframe "altro" [^]*other\.html/.test(snap.tree) && !/Segreto/.test(snap.tree));

const found = await ev(`${FRAMES}(${FIND_ALL})("update firmware")`);
check("preview_find trova nel frame", found.some((l) => /f1e\d+/.test(l)), found.join(" | "));

const ref = snap.tree.match(/Update Firmware" \[ref=(f1e\d+)\]/)[1];
const pt = await ev(`${FRAMES}(${FIND})({ref: "${ref}", selector: "", text: ""}, (el) => { el.scrollIntoView({block: 'center', inline: 'center'}); const r = el.getBoundingClientRect(); const o = window.__eiOff(el); return [r.left + r.width / 2 + o[0], r.top + r.height / 2 + o[1]]; }, false, true)`);
await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.out[0], y: pt.out[1], button: "left", clickCount: 1 });
await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.out[0], y: pt.out[1], button: "left", clickCount: 1 });
await new Promise((r) => setTimeout(r, 200));
const clicks = await ev(`document.getElementById("app").contentWindow.clicks || 0`);
check("clic vero alle coordinate (con lo scarto del frame) colpisce il pulsante", clicks === 1, JSON.stringify(pt));

const bytext = await ev(`${FRAMES}(${FIND})({ref: "", selector: "", text: "Cliccato 1"}, (el) => { el.click(); return 'ok'; }, false, true)`);
check("preview_click per testo dentro il frame", bytext.out === "ok" && (await ev(`document.getElementById("app").contentWindow.clicks`)) === 2);

const typed = await ev(`${FRAMES}(${FIND})({ref: "", selector: "#name", text: ""}, (el) => { el.focus(); const W = el.ownerDocument.defaultView; const proto = el instanceof W.HTMLTextAreaElement ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value'); if (set && set.set && (el instanceof W.HTMLInputElement || el instanceof W.HTMLTextAreaElement)) set.set.call(el, "SPS.fwpkg"); return 'ok'; }, true, false)`);
check("preview_type per selettore dentro il frame", typed.out === "ok" && (await ev(`document.getElementById("app").contentDocument.getElementById("name").value`)) === "SPS.fwpkg");

const guard = await ev(`${FRAMES}(${FIND})({ref: "", selector: "", text: "Aggiungi al carrello"}, (el) => { el.click(); return 'ok'; }, false, true)`);
check("guardia del carrello vale anche nel frame", !!guard.error, guard.error);

check("preview_wait: testo del frame non ancora", (await ev(`${FRAMES}(${WAIT})({text: "Complete", gone: "", selector: ""})`)) === false);
const before = await ev(`${FRAMES}(${WAIT})({hash: true})`);
check("preview_wait changed: uguale prima del cambio", (await ev(`${FRAMES}(${WAIT})({text: "", gone: "", selector: "", before: ${JSON.stringify(before)}})`)) === false);
await ev(`document.getElementById("app").contentDocument.getElementById("st").textContent = "Complete"`);
check("preview_wait: testo comparso nel frame", (await ev(`${FRAMES}(${WAIT})({text: "Complete", gone: "", selector: ""})`)) === true);
check("preview_wait changed: vede il cambio nel frame", (await ev(`${FRAMES}(${WAIT})({text: "", gone: "", selector: "", before: ${JSON.stringify(before)}})`)) === true);
check("preview_wait text_gone nel frame", (await ev(`${FRAMES}(${WAIT})({text: "", gone: "In progress", selector: ""})`)) === true);

const read = await ev(`${FRAMES}${READ}`);
check("preview_read con il testo del frame", /\[frame f1\]/.test(read.text) && /Complete/.test(read.text) && !/Segreto/.test(read.text));

const ex = await ev(`${FRAMES}(${EXTRACT})({ limit: 5, bodies: [] })`);
check("preview_extract legge il prodotto nel frame", ex.items && ex.items.some((p) => /SPS/.test(JSON.stringify(p))), JSON.stringify(ex.items || ex).slice(0, 160));

ws.close(); edge.kill(); server.close(); other.close();
console.log(fails ? `${fails} prove fallite` : "tutte le prove ok");
process.exit(fails ? 1 : 0);
