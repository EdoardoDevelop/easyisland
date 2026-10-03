// Dev harness: plays the whole drop sequence in a plain browser so the
// choreography can be watched without an OLE drag. Not part of the app bundle.

import { UploadCanvas } from "../src/upload/canvas";
import { UploadSeq } from "../src/upload/sequence";
import { State, type QuickAction } from "../src/core/state";

State.droppedFile = { name: "rapport-q3.pdf", path: "C:/tmp/rapport-q3.pdf" };

// File actions on the choose card; `?azioni=0` shows the card without them.
const sample = (id: string, name: string, color: string): QuickAction => ({
  id, name, icon: "", color, kind: "prompt", target: "", args: "", script: "",
  shell: "powershell", prompt: `${name} (prova)`, input: "file", confirm: true, hotkey: "",
});
const count = Number(new URLSearchParams(location.search).get("azioni") ?? "2");
State.settings.actions = [
  sample("a1", "Analizza log", "#f59e0b"),
  sample("a2", "Riassumi", "#60a5fa"),
  sample("a3", "Traduci in inglese", "#a78bfa"),
  sample("a4", "Spiega questo errore molto lungo", "#f472b6"),
].slice(0, count);

const stage = document.getElementById("stage")!;
const clock = document.getElementById("clock")!;

const canvas = new UploadCanvas({
  ask: () => (clock.textContent = "ASK clicked"),
  cancel: () => (clock.textContent = "CANCEL clicked"),
  runAction: (a) => (clock.textContent = `ACTION ${a.name} clicked`),});
canvas.el.classList.add("on");
canvas.el.style.position = "absolute";
canvas.el.style.left = "0";
stage.append(canvas.el);

// The cursor walks in from the right, settles over the box, then drops.
// The whole thing restarts every 12 s so it can be watched (and screenshotted)
// without reloading the page.
const CYCLE = 12;
let start = performance.now();
let dropped = false;
UploadSeq.enterZone(520, 96);

function loop(now: number) {
  let t = (now - start) / 1000;
  if (t >= CYCLE) {
    start = now;
    t = 0;
    dropped = false;
    UploadSeq.enterZone(520, 96);
  }
  if (!dropped) {
    const x = 520 - Math.min(1, t / 0.9) * 260;
    UploadSeq.updateCursor(x, 96);
    if (t >= 1.2) {
      dropped = true;
      UploadSeq.performDrop(2.4);
    }
  }
  canvas.draw(UploadSeq.frame(), now / 1000);
  clock.textContent = `t = ${t.toFixed(2)} s${dropped ? "  (dropped)" : "  (dragging)"}`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
