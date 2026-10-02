// Draws the app icon into the PNG/ICO set Tauri needs. No dependencies: the
// icons are rasterised here and encoded with node:zlib, so the icon stays
// "drawn in code" like the character.
//
// The icon is the island itself — a pill with a status light and a line of
// content — not the character, which the user can change (Slime or EasyTech).
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── The island ────────────────────────────────────────────────────────────────

const LEFT = [99, 102, 241]; // #6366F1 — the rim, left
const RIGHT = [34, 211, 238]; // #22D3EE — the rim, right
const TOP = [40, 43, 54]; // the island's body, top
const BOTTOM = [17, 18, 24]; // … and bottom
const STATUS = [110, 227, 106]; // #6EE36A — the status light
const TEXT = [236, 238, 244];

const SS = 4; // supersampling factor

/** Signed distance to a horizontal capsule centred on the origin. */
function capsule(x, y, a, r) {
  const cx = Math.max(-(a - r), Math.min(a - r, x));
  return Math.hypot(x - cx, y) - r;
}

const over = (dst, src, a) => dst.map((c, i) => c * (1 - a) + src[i] * a);

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const small = size <= 24;
  const a = size * (small ? 0.48 : 0.45); // half-width of the pill
  const r = size * (small ? 0.3 : 0.24); // half-height = corner radius
  const rim = Math.max(1.1, size * 0.045);
  const cx = size / 2;
  const cy = size / 2;
  const dotX = -a + r * 1.05; // the status light, in the left cap
  const dotR = r * (small ? 0.42 : 0.34);
  const glowR = dotR * 2.1;
  const textX0 = dotX + r * (small ? 0.75 : 0.72);
  const lines = small
    ? [{ y: 0, x1: a - r * 0.55, h: r * 0.24, alpha: 0.95 }]
    : [
        { y: -r * 0.26, x1: a - r * 0.6, h: r * 0.16, alpha: 0.95 },
        { y: r * 0.3, x1: a - r * 1.35, h: r * 0.13, alpha: 0.5 },
      ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pill = 0;
      let inner = 0;
      let dot = 0;
      const text = lines.map(() => 0);
      let glow = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = x + (sx + 0.5) / SS - cx;
          const v = y + (sy + 0.5) / SS - cy;
          if (capsule(u, v, a, r) > 0) continue;
          pill++;
          if (capsule(u, v, a - rim, r - rim) > 0) continue;
          inner++;
          const d = Math.hypot(u - dotX, v);
          if (d <= dotR) { dot++; continue; }
          if (!small && d <= glowR) glow += 1 - (d - dotR) / (glowR - dotR);
          lines.forEach((l, i) => {
            if (capsule(u - (textX0 + l.x1) / 2, v - l.y, (l.x1 - textX0) / 2, l.h) <= 0) text[i]++;
          });
        }
      }
      if (pill === 0) continue;
      const total = SS * SS;
      const t = Math.min(1, Math.max(0, (x - (cx - a)) / (2 * a)));
      const k = Math.min(1, Math.max(0, (y - (cy - r)) / (2 * r)));
      // The rim's gradient first, the dark body over it.
      let col = LEFT.map((c, i) => c + (RIGHT[i] - c) * t);
      col = over(col, TOP.map((c, i) => c + (BOTTOM[i] - c) * k), inner / pill);
      col = over(col, STATUS, 0.35 * (glow / pill));
      lines.forEach((l, i) => { col = over(col, TEXT, l.alpha * (text[i] / pill)); });
      col = over(col, STATUS, dot / pill);

      const o = (y * size + x) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = Math.round((pill / total) * 255);
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
