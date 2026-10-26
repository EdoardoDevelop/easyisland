// Draws the app icon into the PNG/ICO set Tauri needs. No dependencies: the
// icons are rasterised here and encoded with node:zlib, so the icon stays
// "drawn in code" like the character.
//
// The icon is the island that opens: a pill (the island) melting into a round
// body below it, night blue with a cyan edge, and the four-point sparkle of an
// assistant in the body. Two flat colours, no gradients, so it reads at 16 px
// on a light or dark taskbar (chosen by Edoardo on 26 October 2026, in place
// of the three pills).
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── The island that opens ─────────────────────────────────────────────────────

const NIGHT = [15, 20, 41]; // #0F1429
const CYAN = [51, 217, 255]; // #33D9FF

const SS = 6; // supersampling factor

function capsule(x, y, a, r) {
  const cx = Math.max(-(a - r), Math.min(a - r, x));
  return Math.hypot(x - cx, y) - r;
}

/** Smooth union: the pill and the body melt into one shape. */
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/**
 * Colour at (x, y) in −1…1, or null outside. Small icons (≤ 48 px) get a
 * thicker pill, edge and sparkle, so the shape still reads at 16 px.
 */
function shade(x, y, small) {
  const f = (u, v) => smin(capsule(u, v + 0.42, 0.9, small ? 0.3 : 0.24), Math.hypot(u, v - 0.3) - (small ? 0.4 : 0.36), 0.35);
  const raw = f(x, y);
  if (raw > 0) return null;
  // The melt stretches distances near the neck: divide by the slope, so the
  // edge is equally thick all round.
  const e = 1e-3;
  const d = raw / (Math.hypot(f(x + e, y) - f(x - e, y), f(x, y + e) - f(x, y - e)) / (2 * e) || 1);
  // The four-point sparkle (an astroid) in the body.
  const r = small ? 0.34 : 0.25;
  if (Math.sqrt(Math.abs(x)) + Math.sqrt(Math.abs(y - 0.3)) <= Math.sqrt(r)) return CYAN;
  return d > -0.04 * (small ? 1.8 : 1) ? CYAN : NIGHT;
}

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const small = size <= 48;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = [0, 0, 0];
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = shade(u, v, small);
          if (!c) continue;
          n++;
          c.forEach((k, j) => { col[j] += k; });
        }
      }
      if (!n) continue;
      const o = (y * size + x) * 4;
      px[o] = Math.round(col[0] / n);
      px[o + 1] = Math.round(col[1] / n);
      px[o + 2] = Math.round(col[2] / n);
      px[o + 3] = Math.round((n / (SS * SS)) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderIcon(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
