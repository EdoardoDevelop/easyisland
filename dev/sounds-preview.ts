// Every synthesised sound, to listen to while tuning src/core/synth.ts.
// npm run dev, then /dev/sounds-preview.html.

import { SYNTH_SOUNDS, synthBuffer } from "../src/core/synth";

const FAMILIES: [string, string[]][] = [
  ["Avvisi", ["approval", "question", "error", "finish", "work", "think", "search", "rate"]],
  ["Emozioni dello slime", ["greet", "slap", "annoyed", "dizzy", "love", "pop", "proud", "wink", "yawn", "sleep", "peek"]],
  ["Interfaccia", ["open", "close", "hover", "blip", "tick", "send", "attach", "gulp", "approve"]],
];

const ctx = new AudioContext();
const master = ctx.createGain();
master.gain.value = 0.12;
master.connect(ctx.destination);

const vol = document.getElementById("vol") as HTMLInputElement;
const volv = document.getElementById("volv")!;
vol.addEventListener("input", () => { master.gain.value = Number(vol.value); volv.textContent = vol.value; });

const buffers = new Map<string, AudioBuffer>();
let playing: AudioBufferSourceNode[] = [];

function buffer(name: string): AudioBuffer | null {
  if (!buffers.has(name)) {
    const b = synthBuffer(ctx, name);
    if (b) buffers.set(name, b);
  }
  return buffers.get(name) ?? null;
}

async function play(name: string): Promise<number> {
  await ctx.resume();
  const buf = buffer(name);
  if (!buf) return 0;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.start();
  playing.push(src);
  const row = document.getElementById(`row-${name}`);
  row?.classList.add("playing");
  src.onended = () => row?.classList.remove("playing");
  return buf.duration;
}

const list = document.getElementById("list")!;
for (const [title, names] of FAMILIES) {
  const h = document.createElement("h2");
  h.textContent = title;
  const table = document.createElement("table");
  for (const name of names) {
    const tr = document.createElement("tr");
    tr.id = `row-${name}`;
    tr.innerHTML = `<td class="name">${name}</td><td class="label">${SYNTH_SOUNDS[name]?.label ?? ""}</td>`;
    const td = document.createElement("td");
    const b = document.createElement("button");
    b.className = "new";
    b.textContent = "▶ Ascolta";
    b.onclick = () => void play(name);
    td.append(b);
    tr.append(td);
    table.append(tr);
  }
  list.append(h, table);
}

let runToken = 0;
async function playAll() {
  const token = ++runToken;
  for (const [, names] of FAMILIES) {
    for (const name of names) {
      if (token !== runToken) return;
      const d = await play(name);
      await new Promise((r) => setTimeout(r, d * 1000 + 450));
    }
  }
}
document.getElementById("all")!.onclick = () => void playAll();
document.getElementById("stop")!.onclick = () => {
  runToken++;
  for (const s of playing) { try { s.stop(); } catch { /* already ended */ } }
  playing = [];
};
