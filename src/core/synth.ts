// Sounds made in code, like the character and the icon: every sound is
// synthesised into a mono buffer from a few primitives (tones with glides,
// vibrato and a jelly "wobble", filtered noise). No files, nothing borrowed.
//
// The slime's own sounds (slap, gulp, greet…) are soft and squishy; the alerts
// (permission, question, error, finished) stay short and easy to tell apart.

export const SYNTH_RATE = 44100;

type Wave = "sine" | "triangle" | "soft-square";

interface ToneOpts {
  /** Start and end frequency, Hz; the glide is exponential. */
  f0: number;
  f1?: number;
  wave?: Wave;
  gain?: number;
  /** Seconds of fade-in. */
  attack?: number;
  /** Decay curve: higher = faster fall after the attack. */
  decay?: number;
  /** Pitch vibrato: rate Hz, depth (fraction of the frequency). */
  vibrato?: [number, number];
  /** Jelly wobble: amplitude wobble rate Hz and depth, fading out. */
  wobble?: [number, number];
}

interface NoiseOpts {
  gain?: number;
  /** One-pole low-pass cutoff, Hz (sweeps from lp0 to lp1). */
  lp0?: number;
  lp1?: number;
  /** One-pole high-pass cutoff, Hz. */
  hp?: number;
  attack?: number;
  decay?: number;
}

const TAU = Math.PI * 2;

function wave(kind: Wave, phase: number): number {
  switch (kind) {
    case "triangle": return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case "soft-square": return Math.tanh(2.5 * Math.sin(phase)) / Math.tanh(2.5);
    default: return Math.sin(phase);
  }
}

/** Attack ramp, then a smooth fall to zero at the end of the note. */
function envelope(t: number, dur: number, attack: number, decay: number): number {
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const k = Math.min(1, t / dur);
  return a * Math.pow(1 - k, decay);
}

class Mix {
  readonly data: Float32Array<ArrayBuffer>;
  constructor(seconds: number) {
    this.data = new Float32Array(Math.ceil(seconds * SYNTH_RATE));
  }

  tone(at: number, dur: number, o: ToneOpts): this {
    const { f0, f1 = f0, wave: w = "sine", gain = 1, attack = 0.004, decay = 1.6, vibrato, wobble } = o;
    const start = Math.floor(at * SYNTH_RATE);
    const n = Math.min(Math.floor(dur * SYNTH_RATE), this.data.length - start);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SYNTH_RATE;
      const k = t / dur;
      let f = f0 * Math.pow(f1 / f0, k);
      if (vibrato) f *= 1 + vibrato[1] * Math.sin(TAU * vibrato[0] * t);
      phase += (TAU * f) / SYNTH_RATE;
      let amp = gain * envelope(t, dur, attack, decay);
      if (wobble) amp *= 1 + wobble[1] * Math.sin(TAU * wobble[0] * t) * Math.exp(-t * 5);
      this.data[start + i] += wave(w, phase) * amp;
    }
    return this;
  }

  noise(at: number, dur: number, o: NoiseOpts = {}): this {
    const { gain = 1, lp0 = 8000, lp1 = lp0, hp = 0, attack = 0.002, decay = 2 } = o;
    const start = Math.floor(at * SYNTH_RATE);
    const n = Math.min(Math.floor(dur * SYNTH_RATE), this.data.length - start);
    let seed = 12345;
    let low = 0;
    let lowHp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SYNTH_RATE;
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      const x = (seed / 0x7fffffff) * 2 - 1;
      const fc = lp0 * Math.pow(lp1 / lp0, t / dur);
      low += (1 - Math.exp((-TAU * fc) / SYNTH_RATE)) * (x - low);
      let y = low;
      if (hp > 0) {
        lowHp += (1 - Math.exp((-TAU * hp) / SYNTH_RATE)) * (y - lowHp);
        y -= lowHp;
      }
      this.data[start + i] += y * gain * envelope(t, dur, attack, decay);
    }
    return this;
  }

  /** Scales the whole sound so its peak is `peak`. */
  normalise(peak: number): Float32Array<ArrayBuffer> {
    let max = 0;
    for (const v of this.data) max = Math.max(max, Math.abs(v));
    if (max > 0) for (let i = 0; i < this.data.length; i++) this.data[i] *= peak / max;
    return this.data;
  }
}

/** A short note of a chord or arpeggio. */
const note = (m: Mix, at: number, f: number, dur: number, w: Wave = "triangle", gain = 1) =>
  m.tone(at, dur, { f0: f, wave: w, gain, decay: 2.2 });

/** The slime's squish: a falling sine with a jelly wobble, and a soft thud. */
const blop = (m: Mix, at: number, f0: number, f1: number, dur: number, gain = 1) => {
  m.tone(at, dur, { f0, f1, gain, decay: 1.8, wobble: [22, 0.45] });
  m.noise(at, Math.min(0.06, dur), { gain: gain * 0.25, lp0: 1200, lp1: 300, decay: 3 });
};

export interface SynthSound {
  /** What it is for, in the island. */
  label: string;
  make: () => Float32Array<ArrayBuffer>;
}

export const SYNTH_SOUNDS: Record<string, SynthSound> = {
  // ── Interface ────────────────────────────────────────────────────────────
  peek: { label: "l'isola si affaccia", make: () => { const m = new Mix(0.16); m.tone(0, 0.14, { f0: 520, f1: 820, decay: 1.4, wobble: [18, 0.3] }); return m.normalise(0.057); } },
  open: { label: "l'isola si apre", make: () => { const m = new Mix(0.2); m.tone(0, 0.18, { f0: 440, f1: 760, wave: "triangle", decay: 1.3 }); m.tone(0.05, 0.13, { f0: 880, f1: 1150, gain: 0.35, decay: 2 }); return m.normalise(0.059); } },
  close: { label: "l'isola si chiude", make: () => { const m = new Mix(0.18); m.tone(0, 0.16, { f0: 760, f1: 420, wave: "triangle", decay: 1.5 }); return m.normalise(0.051); } },
  hover: { label: "il mouse passa sopra", make: () => { const m = new Mix(0.05); m.tone(0, 0.045, { f0: 1500, f1: 1700, decay: 2.5 }); return m.normalise(0.02); } },
  blip: { label: "piccola conferma", make: () => { const m = new Mix(0.08); m.tone(0, 0.07, { f0: 1050, f1: 1250, decay: 2 }); return m.normalise(0.03); } },
  tick: { label: "clic leggero", make: () => { const m = new Mix(0.03); m.noise(0, 0.02, { lp0: 9000, hp: 2500, decay: 4 }); m.tone(0, 0.015, { f0: 2400, gain: 0.4, decay: 3 }); return m.normalise(0.016); } },
  send: { label: "messaggio inviato", make: () => { const m = new Mix(0.24); m.noise(0, 0.2, { lp0: 1200, lp1: 6000, hp: 400, gain: 0.5, attack: 0.04, decay: 1.5 }); m.tone(0.02, 0.18, { f0: 520, f1: 1250, decay: 1.6 }); return m.normalise(0.054); } },
  attach: { label: "file allegato", make: () => { const m = new Mix(0.16); m.noise(0, 0.02, { lp0: 6000, hp: 1500, decay: 3, gain: 0.6 }); blop(m, 0.015, 700, 380, 0.13, 0.9); return m.normalise(0.19); } },
  gulp: { label: "inghiotte il file", make: () => { const m = new Mix(0.36); blop(m, 0, 420, 140, 0.18); blop(m, 0.15, 300, 110, 0.2, 0.7); return m.normalise(0.21); } },
  approve: { label: "permesso concesso", make: () => { const m = new Mix(0.26); note(m, 0, 784, 0.12); note(m, 0.09, 1175, 0.16); return m.normalise(0.147); } },

  // ── Alerts ───────────────────────────────────────────────────────────────
  approval: { label: "serve un permesso", make: () => { const m = new Mix(0.5); for (const [at, f] of [[0, 988], [0.14, 1319], [0.28, 988]] as const) { note(m, at, f, 0.2, "triangle"); note(m, at, f * 2, 0.12, "sine", 0.18); } return m.normalise(0.24); } },
  question: { label: "Claude fa una domanda", make: () => { const m = new Mix(0.36); m.tone(0, 0.14, { f0: 620, f1: 700, wave: "triangle", decay: 1.2 }); m.tone(0.13, 0.22, { f0: 760, f1: 1050, wave: "triangle", decay: 1.6 }); return m.normalise(0.18); } },
  error: { label: "errore", make: () => { const m = new Mix(0.42); m.tone(0, 0.17, { f0: 392, f1: 370, wave: "soft-square", gain: 0.7, decay: 1.2 }); m.tone(0.17, 0.24, { f0: 294, f1: 262, wave: "soft-square", gain: 0.7, decay: 1.6 }); return m.normalise(0.165); } },
  finish: { label: "lavoro finito", make: () => { const m = new Mix(0.62); [523, 659, 784, 1047].forEach((f, i) => note(m, i * 0.075, f, 0.38 - i * 0.04)); m.tone(0.24, 0.36, { f0: 2093, gain: 0.12, decay: 2.5 }); return m.normalise(0.45); } },
  work: { label: "si mette al lavoro", make: () => { const m = new Mix(0.24); note(m, 0, 587, 0.12, "sine"); note(m, 0.08, 880, 0.15, "sine"); return m.normalise(0.05); } },
  think: { label: "sta pensando", make: () => { const m = new Mix(0.36); m.tone(0, 0.34, { f0: 440, f1: 466, gain: 0.7, attack: 0.05, decay: 1.4, vibrato: [5, 0.01] }); m.tone(0.04, 0.3, { f0: 659, gain: 0.3, attack: 0.05, decay: 1.6 }); return m.normalise(0.087); } },
  search: { label: "sta cercando", make: () => { const m = new Mix(0.34); [740, 880, 1047].forEach((f, i) => m.tone(i * 0.09, 0.08, { f0: f, f1: f * 1.08, decay: 2 })); return m.normalise(0.096); } },
  rate: { label: "limite raggiunto", make: () => { const m = new Mix(0.5); [620, 520, 430].forEach((f, i) => m.tone(i * 0.13, 0.18, { f0: f, f1: f * 0.94, wave: "triangle", decay: 1.5 })); return m.normalise(0.14); } },

  // ── Emotes (the slime) ───────────────────────────────────────────────────
  greet: { label: "saluto all'avvio (boing)", make: () => { const m = new Mix(0.6); m.tone(0, 0.5, { f0: 260, f1: 620, decay: 1.4, wobble: [11, 0.55], vibrato: [11, 0.04] }); m.tone(0.12, 0.3, { f0: 990, f1: 1240, gain: 0.25, decay: 2 }); return m.normalise(0.25); } },
  slap: { label: "schiaffo (splat)", make: () => { const m = new Mix(0.32); m.noise(0, 0.08, { lp0: 4000, lp1: 600, gain: 0.9, decay: 2.5 }); blop(m, 0, 260, 90, 0.28, 0.9); return m.normalise(0.13); } },
  annoyed: { label: "infastidito (hmpf)", make: () => { const m = new Mix(0.36); m.tone(0, 0.14, { f0: 300, f1: 270, wave: "soft-square", gain: 0.6, decay: 1 }); m.tone(0.15, 0.2, { f0: 240, f1: 200, wave: "soft-square", gain: 0.6, decay: 1.4 }); return m.normalise(0.062); } },
  dizzy: { label: "gli gira la testa", make: () => { const m = new Mix(0.75); m.tone(0, 0.7, { f0: 820, f1: 300, wave: "triangle", decay: 1.1, vibrato: [7, 0.09], wobble: [7, 0.4] }); return m.normalise(0.22); } },
  love: { label: "cuori", make: () => { const m = new Mix(0.62); [1047, 1319, 1568].forEach((f, i) => m.tone(i * 0.1, 0.4, { f0: f, decay: 2.2, vibrato: [6, 0.012], gain: 0.8 })); return m.normalise(0.16); } },
  pop: { label: "bollicina (pop)", make: () => { const m = new Mix(0.08); m.tone(0, 0.06, { f0: 700, f1: 1700, decay: 2.5 }); m.noise(0, 0.01, { lp0: 7000, hp: 2000, gain: 0.4, decay: 3 }); return m.normalise(0.046); } },
  proud: { label: "fiero", make: () => { const m = new Mix(0.5); note(m, 0, 659, 0.16); note(m, 0.12, 988, 0.32); m.tone(0.12, 0.32, { f0: 1976, gain: 0.12, decay: 2 }); return m.normalise(0.25); } },
  wink: { label: "occhiolino", make: () => { const m = new Mix(0.14); m.tone(0, 0.11, { f0: 1250, f1: 1900, decay: 2 }); return m.normalise(0.025); } },
  yawn: { label: "sbadiglio", make: () => { const m = new Mix(0.85); m.tone(0, 0.8, { f0: 520, f1: 240, wave: "triangle", attack: 0.12, decay: 1.2, vibrato: [4, 0.03] }); m.noise(0.05, 0.6, { lp0: 900, lp1: 400, gain: 0.12, attack: 0.15, decay: 1.5 }); return m.normalise(0.117); } },
  sleep: { label: "si addormenta (zzz)", make: () => { const m = new Mix(0.9); m.tone(0, 0.85, { f0: 220, f1: 175, attack: 0.2, decay: 1.2, wobble: [3, 0.6] }); m.noise(0.1, 0.7, { lp0: 700, gain: 0.1, attack: 0.2, decay: 1.4 }); return m.normalise(0.049); } },
};

/** The synthesised sound `name` as an AudioBuffer for `ctx`, or null if unknown. */
export function synthBuffer(ctx: BaseAudioContext, name: string): AudioBuffer | null {
  const s = SYNTH_SOUNDS[name];
  if (!s) return null;
  const data = s.make();
  const buf = ctx.createBuffer(1, data.length, SYNTH_RATE);
  buf.copyToChannel(data, 0);
  return buf;
}
