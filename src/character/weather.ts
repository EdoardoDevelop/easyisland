// The sky the character wears: sun, moon, clouds, fog, rain, snow or a storm
// behind its head, from the Meteo integration (probes.rs `sky_kind`). Drawn by
// the engine before the body, big, so the character stands in front of it. Only falling rain and snow move: the rest is a
// still picture, so a clear sky never keeps the animation loop running.

export type Sky =
  | "sun" | "moon" | "sun-cloud" | "moon-cloud" | "cloud" | "fog"
  | "drizzle" | "rain" | "snow" | "storm";

const SKIES: readonly Sky[] = ["sun", "moon", "sun-cloud", "moon-cloud", "cloud", "fog", "drizzle", "rain", "snow", "storm"];

export function isSky(v: unknown): v is Sky {
  return typeof v === "string" && (SKIES as readonly string[]).includes(v);
}

/** Skies with something falling: they need frames while shown. */
export function skyMoves(s: Sky | null): boolean {
  return s === "drizzle" || s === "rain" || s === "snow" || s === "storm";
}

/**
 * Draws `sky` behind a body whose top is at `top`, centred on `cx`; `unit` is
 * the engine's unit and `t` the time in seconds. With `big` it is the backdrop
 * behind the head, otherwise the small sign above it.
 */
export function drawSky(x: CanvasRenderingContext2D, sky: Sky, unit: number, cx: number, top: number, t: number, big = true) {
  // Right of centre, so the state badge (top left) stays clear.
  const R = big ? unit * 2.4 : unit;
  const ax = big ? cx + unit * 0.58 : cx + R * 0.32;
  const ay = big ? top + unit * 0.1 : top - R * 0.36;
  // Behind the body there are more drops, and the sun and moon sit lower so
  // their rays stay inside the canvas.
  const wide = big ? 2.4 : 1;
  const sy = big ? ay + R * 0.12 : ay;
  x.save();
  switch (sky) {
    case "sun":
      sun(x, ax + R * 0.05, sy, R * 0.2);
      break;
    case "moon":
      moon(x, ax + R * 0.05, sy, R * 0.21);
      break;
    case "sun-cloud":
      sun(x, ax + R * 0.16, sy - R * 0.08, R * 0.17);
      cloud(x, ax - R * 0.06, ay + R * 0.06, R * 0.6, "#F3F6FA");
      break;
    case "moon-cloud":
      moon(x, ax + R * 0.16, sy - R * 0.08, R * 0.17);
      cloud(x, ax - R * 0.06, ay + R * 0.06, R * 0.6, "#E3E8EF");
      break;
    case "cloud":
      cloud(x, ax, ay, R * 0.82, "#E6EBF1");
      break;
    case "fog":
      fog(x, ax, ay, R);
      break;
    case "drizzle":
      fall(x, ax, ay, R, t, { n: 3 * wide, rate: 0.7, drop: "rain", size: 0.07 });
      cloud(x, ax, ay, R * 0.78, "#D5DCE5");
      break;
    case "rain":
      fall(x, ax, ay, R, t, { n: 5 * wide, rate: 1.25, drop: "rain", size: 0.09 });
      cloud(x, ax, ay, R * 0.82, "#BCC6D3");
      break;
    case "snow":
      fall(x, ax, ay, R, t, { n: 5 * wide, rate: 0.45, drop: "snow", size: 0.06 });
      cloud(x, ax, ay, R * 0.82, "#DCE3EC");
      break;
    case "storm":
      fall(x, ax, ay, R, t, { n: 5 * wide, rate: 1.4, drop: "rain", size: 0.09 });
      bolt(x, ax + R * (big ? 0.24 : 0.04), ay + R * 0.12, R, t);
      cloud(x, ax, ay, R * 0.86, "#8C97A8");
      break;
  }
  x.restore();
}

/** A puffy cloud `w` wide centred on (cx, cy), with a darker underside. */
function cloud(x: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string) {
  const puffs: [number, number, number][] = [[-0.28, 0.06, 0.22], [-0.02, -0.08, 0.3], [0.27, 0.05, 0.22]];
  const shape = (dy: number) => {
    x.beginPath();
    for (const [px, py, r] of puffs) {
      x.moveTo(cx + px * w + r * w, cy + py * w + dy);
      x.arc(cx + px * w, cy + py * w + dy, r * w, 0, Math.PI * 2);
    }
    x.roundRect(cx - w * 0.4, cy + dy, w * 0.8, w * 0.22, w * 0.11);
  };
  x.fillStyle = "rgba(40,52,70,0.28)";
  shape(w * 0.05);
  x.fill();
  x.fillStyle = color;
  shape(0);
  x.fill();
}

function sun(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.strokeStyle = "#FFB627";
  x.lineWidth = r * 0.28;
  x.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35);
    x.lineTo(cx + Math.cos(a) * r * 1.75, cy + Math.sin(a) * r * 1.75);
    x.stroke();
  }
  x.fillStyle = "#FFC93C";
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
}

function moon(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // A crescent: the disc minus a disc shifted up-right (even-odd, clipped to the first).
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.clip();
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.arc(cx + r * 0.55, cy - r * 0.35, r * 0.85, 0, Math.PI * 2);
  x.fillStyle = "#F6E7A8";
  x.fill("evenodd");
  x.restore();
}

function fog(x: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  x.strokeStyle = "rgba(214,222,232,0.95)";
  x.lineWidth = R * 0.085;
  x.lineCap = "round";
  for (const [dx, dy, w] of [[-0.04, -0.14, 0.62], [0.06, 0, 0.7], [-0.02, 0.14, 0.5]] as const) {
    x.beginPath();
    x.moveTo(cx + (dx - w / 2) * R, cy + dy * R);
    x.lineTo(cx + (dx + w / 2) * R, cy + dy * R);
    x.stroke();
  }
}

/**
 * Rain or snow falling from under the cloud, spread across its width (never
 * past its sides); each drop loops on its own phase.
 */
function fall(
  x: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number,
  o: { n: number; rate: number; drop: "rain" | "snow"; size: number },
) {
  const len = R * 0.62;
  const n = Math.round(o.n);
  for (let i = 0; i < n; i++) {
    const phase = (t * o.rate + i * 0.618) % 1;
    const a = phase < 0.15 ? phase / 0.15 : 1 - (phase - 0.15) / 0.85;
    const sway = o.drop === "snow" ? Math.sin(t * 2.2 + i * 1.7) * R * 0.04 : 0;
    const px = cx + ((i + 0.5) / n - 0.5) * R * 0.62 + sway;
    const py = cy + R * 0.12 + phase * len;
    const s = R * o.size;
    x.globalAlpha = Math.max(0, a);
    if (o.drop === "rain") {
      x.fillStyle = "#5AB4FF";
      x.beginPath();
      x.moveTo(px, py - s);
      x.quadraticCurveTo(px + s * 0.75, py + s * 0.25, px, py + s * 0.6);
      x.quadraticCurveTo(px - s * 0.75, py + s * 0.25, px, py - s);
      x.fill();
    } else {
      x.fillStyle = "#FFFFFF";
      x.strokeStyle = "rgba(120,140,170,0.6)";
      x.lineWidth = s * 0.3;
      x.beginPath();
      x.arc(px, py, s, 0, Math.PI * 2);
      x.fill();
      x.stroke();
    }
  }
  x.globalAlpha = 1;
}

/** The storm's lightning: there, with a brief flash every few seconds. */
function bolt(x: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number) {
  const k = (t % 2.6) / 2.6;
  x.globalAlpha = k < 0.06 || (k > 0.1 && k < 0.14) ? 1 : 0.55;
  x.fillStyle = "#FFD23F";
  x.beginPath();
  x.moveTo(cx + R * 0.05, cy);
  x.lineTo(cx - R * 0.09, cy + R * 0.2);
  x.lineTo(cx + R * 0.0, cy + R * 0.2);
  x.lineTo(cx - R * 0.07, cy + R * 0.38);
  x.lineTo(cx + R * 0.11, cy + R * 0.14);
  x.lineTo(cx + R * 0.02, cy + R * 0.14);
  x.lineTo(cx + R * 0.1, cy);
  x.closePath();
  x.fill();
  x.globalAlpha = 1;
}

// ── The Meteo card (src/views/weather.ts) ───────────────────────────────────

/** Sky colours, top to bottom, by kind and time of day. */
function skyColors(sky: Sky, day: boolean): [string, string] {
  if (sky === "moon" || sky === "moon-cloud") return ["#0B1430", "#23305C"];
  if (!day) return sky === "storm" ? ["#0E1118", "#262C38"] : ["#141B2B", "#2E3647"];
  switch (sky) {
    case "sun": return ["#2F7FD8", "#7FC3F2"];
    case "sun-cloud": return ["#3A7CC4", "#8DBFE3"];
    case "cloud": return ["#56657A", "#8E9BAC"];
    case "fog": return ["#76808C", "#A9B1BB"];
    case "drizzle": return ["#4A5A6E", "#7D8A9B"];
    case "rain": return ["#36445A", "#64728A"];
    case "snow": return ["#6F7F96", "#B3C0D0"];
    case "storm": return ["#1D2330", "#414A5C"];
  }
}

/** A number from 0 to 1, always the same for the same `i`: particles without state. */
function rnd(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** The clouds' colour in the card's sky. */
function cloudTone(sky: Sky, night: boolean): string {
  switch (sky) {
    case "sun-cloud": return "#F3F6FA";
    case "moon-cloud": return "#56607A";
    case "fog": return "#C9D0D8";
    case "drizzle": return night ? "#3D4556" : "#B7C1CD";
    case "rain": return night ? "#343B4A" : "#9AA6B6";
    case "snow": return night ? "#4A5366" : "#D5DDE7";
    case "storm": return "#5E6878";
    default: return night ? "#4A5366" : "#D9DFE7";
  }
}

/**
 * The card's sky, `w`×`h`, at `t` seconds: its colours and what moves in it
 * (rays turning, clouds drifting, rain, snow, mist, stars, lightning). The
 * card fades it out towards the bottom (CSS mask).
 */
export function drawSkyScene(x: CanvasRenderingContext2D, sky: Sky, day: boolean, w: number, h: number, t: number) {
  const [top, bottom] = skyColors(sky, day);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);

  const night = !day || sky === "moon" || sky === "moon-cloud";
  // Stars on a clear or partly clear night.
  if (night && (sky === "moon" || sky === "moon-cloud" || sky === "cloud")) {
    x.fillStyle = "#FFFFFF";
    for (let i = 0; i < 46; i++) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + rnd(i + 9) * 1.4) + i));
      x.globalAlpha = a * (sky === "cloud" ? 0.4 : 0.9);
      x.beginPath();
      x.arc(rnd(i) * w, rnd(i + 50) * h * 0.75, 0.5 + rnd(i + 100) * 1.1, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  }

  const bx = w * 0.8;
  const by = h * 0.36;
  const r = Math.min(26, h * 0.17);
  if (sky === "sun" || sky === "sun-cloud") {
    // A breathing glow and rays that turn.
    const glow = x.createRadialGradient(bx, by, r * 0.6, bx, by, r * (3.4 + Math.sin(t * 1.3) * 0.25));
    glow.addColorStop(0, "rgba(255,214,90,0.55)");
    glow.addColorStop(1, "rgba(255,214,90,0)");
    x.fillStyle = glow;
    x.fillRect(0, 0, w, h);
    x.save();
    x.translate(bx, by);
    x.rotate(t * 0.15);
    sun(x, 0, 0, r);
    x.restore();
  } else if (sky === "moon" || sky === "moon-cloud") {
    const glow = x.createRadialGradient(bx, by, r * 0.5, bx, by, r * 3);
    glow.addColorStop(0, "rgba(246,231,168,0.28)");
    glow.addColorStop(1, "rgba(246,231,168,0)");
    x.fillStyle = glow;
    x.fillRect(0, 0, w, h);
    moon(x, bx, by, r * 1.05);
  }

  // Lightning lights the whole sky now and then, a bolt somewhere new each time.
  if (sky === "storm") {
    const k = (t % 4.2) / 4.2;
    const flash = k < 0.03 ? 0.5 : k > 0.06 && k < 0.085 ? 0.35 : 0;
    if (flash) {
      x.fillStyle = `rgba(230,236,255,${flash})`;
      x.fillRect(0, 0, w, h);
      x.save();
      bolt(x, w * (0.3 + rnd(Math.floor(t / 4.2)) * 0.5), h * 0.18, h * 1.1, 0.01);
      x.restore();
    }
  }

  // Clouds drifting across and coming back round: a few with the sun, many with rain.
  if (sky !== "sun" && sky !== "moon") {
    const tone = cloudTone(sky, night);
    const n = sky === "sun-cloud" || sky === "moon-cloud" ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const size = (0.22 + rnd(i + 7) * 0.2) * Math.max(w * 0.6, 220);
      const speed = 6 + rnd(i + 3) * 8;
      const span = w + size;
      const cx = ((rnd(i) * span + t * speed) % span) - size / 2;
      const cy = h * (0.18 + rnd(i + 20) * (n > 3 ? 0.32 : 0.2));
      x.globalAlpha = sky === "fog" ? 0.55 : 0.92;
      cloud(x, cx, cy, size * 0.5, tone);
    }
    x.globalAlpha = 1;
  }

  if (sky === "fog") {
    // Bands of mist sliding past each other.
    x.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const y = h * (0.3 + i * 0.13);
      const off = Math.sin(t * 0.25 + i * 1.3) * w * 0.08;
      x.strokeStyle = `rgba(225,230,236,${0.35 + rnd(i) * 0.25})`;
      x.lineWidth = 7 + rnd(i + 4) * 6;
      x.beginPath();
      x.moveTo(w * (0.05 + rnd(i + 8) * 0.15) + off, y);
      x.lineTo(w * (0.6 + rnd(i + 12) * 0.35) + off, y);
      x.stroke();
    }
  }

  if (sky === "drizzle" || sky === "rain" || sky === "storm") {
    // Slanted streaks over the whole sky.
    const n = sky === "drizzle" ? 40 : 90;
    const speed = sky === "drizzle" ? 140 : 260;
    const len = sky === "drizzle" ? 6 : 11;
    x.strokeStyle = night ? "rgba(150,180,220,0.55)" : "rgba(210,228,250,0.7)";
    x.lineWidth = 1.2;
    x.beginPath();
    for (let i = 0; i < n; i++) {
      const y = ((rnd(i) * (h + 20) + t * speed * (0.8 + rnd(i + 30) * 0.4)) % (h + 20)) - 10;
      const px = (((rnd(i + 60) * (w + 40) - y * 0.18) % (w + 40)) + w + 40) % (w + 40);
      x.moveTo(px, y);
      x.lineTo(px - len * 0.25, y + len);
    }
    x.stroke();
  }

  if (sky === "snow") {
    x.fillStyle = "#FFFFFF";
    for (let i = 0; i < 70; i++) {
      const y = ((rnd(i) * (h + 10) + t * (18 + rnd(i + 5) * 22)) % (h + 10)) - 5;
      const px = rnd(i + 40) * w + Math.sin(t * 1.1 + i) * 8;
      x.globalAlpha = 0.6 + rnd(i + 2) * 0.4;
      x.beginPath();
      x.arc(px, y, 1 + rnd(i + 70) * 1.8, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  }
}

/** A small still icon of `sky` in a `size`×`size` box (the card's hours and days). */
export function drawSkyIcon(x: CanvasRenderingContext2D, sky: Sky, size: number) {
  const c = size / 2;
  const drops = (kind: "rain" | "snow" | "drizzle") => {
    const n = kind === "drizzle" ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const px = c + (i - (n - 1) / 2) * size * 0.2;
      const py = size * 0.8 + (i % 2) * size * 0.06;
      if (kind === "snow") {
        x.fillStyle = "#FFFFFF";
        x.beginPath();
        x.arc(px, py, size * 0.055, 0, Math.PI * 2);
        x.fill();
      } else {
        x.strokeStyle = "#5AB4FF";
        x.lineWidth = size * 0.07;
        x.lineCap = "round";
        x.beginPath();
        x.moveTo(px, py - size * 0.06);
        x.lineTo(px - size * 0.03, py + size * 0.06);
        x.stroke();
      }
    }
  };
  x.save();
  switch (sky) {
    case "sun": sun(x, c, c, size * 0.2); break;
    case "moon": moon(x, c, c, size * 0.3); break;
    case "sun-cloud":
      sun(x, c + size * 0.14, c - size * 0.12, size * 0.15);
      cloud(x, c - size * 0.06, c + size * 0.08, size * 0.7, "#F3F6FA");
      break;
    case "moon-cloud":
      moon(x, c + size * 0.14, c - size * 0.14, size * 0.2);
      cloud(x, c - size * 0.06, c + size * 0.08, size * 0.7, "#C9D0DC");
      break;
    case "cloud": cloud(x, c, c, size * 0.85, "#E6EBF1"); break;
    case "fog": fog(x, c, c, size); break;
    case "drizzle": cloud(x, c, c - size * 0.1, size * 0.8, "#D5DCE5"); drops("drizzle"); break;
    case "rain": cloud(x, c, c - size * 0.1, size * 0.8, "#BCC6D3"); drops("rain"); break;
    case "snow": cloud(x, c, c - size * 0.1, size * 0.8, "#DCE3EC"); drops("snow"); break;
    case "storm":
      cloud(x, c, c - size * 0.12, size * 0.8, "#8C97A8");
      bolt(x, c + size * 0.02, c + size * 0.02, size * 0.9, 0.01);
      break;
  }
  x.restore();
}
