// "Questo PC": EasyIsland is a phone of the 3CX extension, like the web client.
//
// Signalling goes through the PBX's own protocol (src-tauri/src/threecx: the
// session registers a WebRTC device; calls come pushed as `threecx-webrtc`
// and every step goes back with `threecx_webrtc`). The audio is WebRTC here,
// in the island page, as the web client does it:
//   - outgoing: our offer (with the number) → the PBX's answer
//     ("answer provided") → we confirm;
//   - incoming: the PBX's offer (or a request for one) → our answer, after a
//     click on "Rispondi";
//   - a new offer from the PBX on a call (hold, transfer) is answered at once.
// No STUN server, like the web client: the PBX is the other end.
// Nothing here is stored: SDP, names and numbers live as long as the call.

import { Bridge, onEvent, type ThreecxCall } from "./bridge";
import { t } from "./i18n";
import { State } from "./state";

export interface RtcCall {
  id: number;
  sdpType: number;
  name: string;
  number: string;
  transaction: number;
  sdp: string;
  dialog: string;
  hold: number;
}

interface RtcState {
  registered: boolean;
  calls: RtcCall[];
}

/** WebRTCEndpointSDPState. */
const SDP = {
  terminate: 0,
  offer: 1,
  answer: 2,
  confirm: 3,
  requestOffer: 4,
  answerProvided: 8,
  confirmed: 9,
  initial: 10,
} as const;

interface Media {
  id: number;
  last: RtcCall;
  pc: RTCPeerConnection | null;
  mic: MediaStream | null;
  audio: HTMLAudioElement;
  muted: boolean;
  /** An offer/answer of ours is on its way. */
  busy: boolean;
}

const media = new Map<number, Media>();
let state: RtcState = { registered: false, calls: [] };
let transaction = 0;
/** While we wait for the id of a call we start, the PBX's news about it wait too. */
let held = 0;
let queued: RtcState[] = [];
const listeners = new Set<() => void>();
/** Bumped on every change: the 3CX card is drawn again when it moves. */
let version = 0;

export function onSoftphone(f: () => void) {
  listeners.add(f);
}

export function softphoneVersion(): number {
  return version;
}

function changed() {
  version++;
  for (const f of listeners) f();
}

export function startSoftphone() {
  void onEvent<RtcState>("threecx-webrtc", (s) => {
    if (held > 0) queued.push(s);
    else apply(s);
  });
}

/** The PBX accepted EasyIsland as a phone. */
export function registered(): boolean {
  return state.registered;
}

function blank(id: number): RtcCall {
  return { id, sdpType: SDP.initial, name: "", number: "", transaction: 0, sdp: "", dialog: "", hold: 0 };
}

function newMedia(last: RtcCall): Media {
  const audio = document.createElement("audio");
  audio.autoplay = true;
  return { id: last.id, last, pc: null, mic: null, audio, muted: false, busy: false };
}

function apply(next: RtcState) {
  state = next;
  const byId = new Map(next.calls.map((c) => [c.id, c]));
  for (const m of [...media.values()]) {
    const item = byId.get(m.id);
    if (!item) {
      close(m);
      continue;
    }
    const prev = m.last;
    m.last = item;
    if (prev.sdpType !== item.sdpType || prev.sdp !== item.sdp) {
      void step(prev.sdpType, m).catch((e) => fail(m, e));
    }
  }
  ringIfNeeded();
  changed();
}

/** Ringing on this PC: an offer (or a request for one) we have not answered. */
function ringing(c: RtcCall): boolean {
  return !media.has(c.id) && (c.sdpType === SDP.offer || c.sdpType === SDP.requestOffer);
}

async function step(prevType: number, m: Media) {
  const s = m.last;
  switch (s.sdpType) {
    case SDP.answerProvided:
      if (prevType !== SDP.confirmed && m.pc) await m.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
      await send(s.id, SDP.confirm);
      return;
    case SDP.offer:
    case SDP.requestOffer:
      await answer(m);
      return;
    case SDP.confirmed:
      m.busy = false;
      return;
  }
}

function fail(m: Media, e: unknown) {
  m.busy = false;
  console.warn("softphone:", e);
}

async function send(id: number, sdpType: number, opts: { transaction?: number; sdp?: string; destination?: string; replace?: number } = {}): Promise<number> {
  return Bridge.threecxWebrtc(id, sdpType, opts.transaction ?? null, opts.sdp ?? "", opts.destination ?? "", opts.replace ?? null);
}

/** A fresh peer connection with the microphone on it; the other side plays in `m.audio`. */
async function connect(m: Media): Promise<RTCPeerConnection> {
  m.pc?.close();
  const pc = new RTCPeerConnection({});
  m.pc = pc;
  pc.ontrack = (e) => {
    m.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    void m.audio.play().catch(() => {});
  };
  if (!m.mic || !m.mic.getAudioTracks().some((x) => x.readyState === "live")) {
    try {
      m.mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      throw new Error(t("Microfono non disponibile"));
    }
  }
  for (const track of m.mic.getAudioTracks()) {
    track.enabled = !m.muted;
    pc.addTrack(track, m.mic);
  }
  return pc;
}

/** Our description, sent once every candidate is in it (no trickle ICE with the PBX). */
async function describe(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit): Promise<string> {
  await pc.setLocalDescription(desc);
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>((done) => {
      const timer = window.setTimeout(done, 4000);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          window.clearTimeout(timer);
          done();
        }
      });
    });
  }
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error(t("Il PC non ha preparato l'audio della chiamata"));
  return sdp;
}

/** The PBX's offer answered, or the offer it asked for. */
async function answer(m: Media) {
  if (m.busy) return;
  m.busy = true;
  const s = m.last;
  const pc = await connect(m);
  if (s.sdpType === SDP.offer) {
    await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
    const sdp = await describe(pc, await pc.createAnswer());
    await send(s.id, SDP.answer, { transaction: s.transaction, sdp });
  } else {
    const sdp = await describe(pc, await pc.createOffer());
    await send(s.id, SDP.offer, { transaction: s.transaction, sdp });
  }
}

/** A new call from this PC: to `number`, or (`replace`) a colleague's ringing call taken here. */
async function start(target: { number?: string; replace?: number }) {
  held++;
  ring(false);
  const m = newMedia(blank(0));
  m.busy = true;
  try {
    const pc = await connect(m);
    const sdp = await describe(pc, await pc.createOffer());
    const id = await send(0, SDP.offer, { transaction: transaction++, sdp, destination: target.number, replace: target.replace });
    m.id = id;
    m.last = blank(id);
    media.set(id, m);
  } catch (e) {
    close(m);
    throw e;
  } finally {
    held--;
    if (held === 0) {
      const pending = queued;
      queued = [];
      for (const s of pending) apply(s);
    }
    changed();
  }
}

export function callFromPc(number: string): Promise<void> {
  return start({ number });
}

/** A colleague's ringing call (its connection id) answered on this PC. */
export function pickupOnPc(connection: string): Promise<void> {
  return start({ replace: Number(connection) });
}

/** The call of our phone behind a call of the card (same SIP dialog). */
export function rtcFor(call: ThreecxCall): RtcCall | null {
  if (!state.registered) return null;
  const byDialog = state.calls.find((c) => c.dialog && call.dialog && (call.dialog.includes(c.dialog) || c.dialog.includes(call.dialog)));
  if (byDialog) return byDialog;
  // One call each side: they are the same one.
  return state.calls.length === 1 && !call.dialog ? state.calls[0] : null;
}

/** "Rispondi" on a call ringing on this PC. */
export async function answerOnPc(rtc: RtcCall) {
  ring(false);
  const m = media.get(rtc.id) ?? newMedia(rtc);
  media.set(rtc.id, m);
  try {
    await answer(m);
  } catch (e) {
    close(m);
    throw e;
  } finally {
    changed();
  }
}

/** Our audio is in this call (it is not only ringing here). */
export function onPc(rtc: RtcCall | null): boolean {
  return !!rtc && media.has(rtc.id);
}

export function muted(rtc: RtcCall): boolean {
  return media.get(rtc.id)?.muted ?? false;
}

export function setMuted(rtc: RtcCall, on: boolean) {
  const m = media.get(rtc.id);
  if (!m) return;
  m.muted = on;
  for (const track of m.mic?.getAudioTracks() ?? []) track.enabled = !on;
  changed();
}

/** A key of the keypad, sent as a tone (menus of the other side). */
export function tone(rtc: RtcCall, key: string) {
  const sender = media.get(rtc.id)?.pc?.getSenders().find((s) => s.track?.kind === "audio");
  sender?.dtmf?.insertDTMF(key, 100, 70);
}

/** Microphone off and connection closed: "davanti al cliente" must see the mic free again. */
function close(m: Media) {
  for (const track of m.mic?.getTracks() ?? []) track.stop();
  m.mic = null;
  m.pc?.close();
  m.pc = null;
  m.audio.srcObject = null;
  media.delete(m.id);
}

// ── Ringtone: only while a call rings on this PC ──────────────────────────────
//
// The user's file (Impostazioni → Integrazioni → 3CX) in a loop, or a desk-phone
// trill synthesised here. "Suoneria del PC" off (also from the card) silences it.
// Both play through an <audio> element: a fresh AudioContext opened by a push
// from the PBX (no click) could stay suspended in WebView2 and ring in silence.

let ringFile: HTMLAudioElement | null = null;
/** The user's ringtone as loaded, and the name it was loaded for. */
let custom: { name: string; url: string | null } | null = null;
/** The built-in trill as a WAV, made once. */
let trillWav: string | null = null;

/** A call rings here and the ringtone is on. */
export function ringingHere(): boolean {
  return state.calls.some(ringing);
}

export function ringOn(): boolean {
  return State.settings.integrationConfig?.threecxRing !== false;
}

/** The card's bell: the same setting as Impostazioni, so it stays as chosen. */
export function setRingOn(on: boolean) {
  State.settings.integrationConfig = { ...State.settings.integrationConfig, threecxRing: on };
  void Bridge.saveSettings(State.settings);
  ringIfNeeded();
  changed();
}

function ringIfNeeded() {
  ring(ringingHere() && ringOn());
}

async function customUrl(): Promise<string | null> {
  const name = State.settings.integrationConfig?.threecxRingtone ?? "";
  if (!name) return null;
  if (custom?.name !== name) custom = { name, url: await Bridge.threecxRingtone() };
  return custom.url;
}

function ring(on: boolean) {
  if (!on) {
    ringFile?.pause();
    ringFile = null;
    return;
  }
  if (ringFile) return;
  const file = new Audio();
  file.loop = true;
  file.volume = 0.8;
  ringFile = file;
  const play = (url: string, fallback: boolean) => {
    if (ringFile !== file) return;
    file.src = url;
    void file.play().catch((e) => {
      console.warn("softphone: ringtone", e);
      if (fallback) play(trill(), false);
    });
  };
  void customUrl().then((url) => play(url ?? trill(), !!url), () => play(trill(), false));
}

/** Two short trills (440 + 480 Hz, like a desk phone), then silence: 3 s, looped. */
function trill(): string {
  if (trillWav) return trillWav;
  const rate = 16000;
  const n = rate * 3;
  const data = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  data.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, n * 2, true);
  const fade = 0.02;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let env = 0;
    for (const [from, to] of [[0, 0.4], [0.6, 1.0]]) {
      if (t >= from && t < to) env = Math.min(1, (t - from) / fade, (to - t) / fade);
    }
    const v = env * 0.3 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t));
    data.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  trillWav = URL.createObjectURL(new Blob([data.buffer], { type: "audio/wav" }));
  return trillWav;
}
