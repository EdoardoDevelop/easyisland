// The sky the character wears: sun, moon, clouds, fog, rain, snow or a storm
// over its head, from the Meteo integration (probes.rs `sky_kind`). Drawn by
// the engine after the body. Only falling rain and snow move: the rest is a
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
 * Draws `sky` above a body whose top is at `top`, centred on `cx`; `R` is the
 * engine's unit and `t` the time in seconds.
 */
export function drawSky(x: CanvasRenderingContext2D, sky: Sky, R: number, cx: number, top: number, t: number) {
  // Slightly right of centre, so the state badge (top left) stays clear.
  const ax = cx + R * 0.32;
  const ay = top - R * 0.36;
  x.save();
  switch (sky) {
    case "sun":
      sun(x, ax + R * 0.05, ay, R * 0.2);
      break;
    case "moon":
      moon(x, ax + R * 0.05, ay, R * 0.21);
      break;
    case "sun-cloud":
      sun(x, ax + R * 0.16, ay - R * 0.08, R * 0.17);
      cloud(x, ax - R * 0.06, ay + R * 0.06, R * 0.6, "#F3F6FA");
      break;
    case "moon-cloud":
      moon(x, ax + R * 0.16, ay - R * 0.08, R * 0.17);
      cloud(x, ax - R * 0.06, ay + R * 0.06, R * 0.6, "#E3E8EF");
      break;
    case "cloud":
      cloud(x, ax, ay, R * 0.82, "#E6EBF1");
      break;
    case "fog":
      fog(x, ax, ay, R);
      break;
    case "drizzle":
      fall(x, ax, ay, R, t, { n: 3, rate: 0.7, drop: "rain", size: 0.07 });
      cloud(x, ax, ay, R * 0.78, "#D5DCE5");
      break;
    case "rain":
      fall(x, ax, ay, R, t, { n: 5, rate: 1.25, drop: "rain", size: 0.09 });
      cloud(x, ax, ay, R * 0.82, "#BCC6D3");
      break;
    case "snow":
      fall(x, ax, ay, R, t, { n: 5, rate: 0.45, drop: "snow", size: 0.06 });
      cloud(x, ax, ay, R * 0.82, "#DCE3EC");
      break;
    case "storm":
      fall(x, ax, ay, R, t, { n: 5, rate: 1.4, drop: "rain", size: 0.09 });
      bolt(x, ax + R * 0.04, ay + R * 0.12, R, t);
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

/** Rain or snow falling from under the cloud; each drop loops on its own phase. */
function fall(
  x: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number,
  o: { n: number; rate: number; drop: "rain" | "snow"; size: number },
) {
  const len = R * 0.62;
  for (let i = 0; i < o.n; i++) {
    const phase = (t * o.rate + i * 0.618) % 1;
    const a = phase < 0.15 ? phase / 0.15 : 1 - (phase - 0.15) / 0.85;
    const sway = o.drop === "snow" ? Math.sin(t * 2.2 + i * 1.7) * R * 0.04 : 0;
    const px = cx + ((i + 0.5) / o.n - 0.5) * R * 0.6 + sway;
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
