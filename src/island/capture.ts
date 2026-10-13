// "Cerchia e chiedi": the screen under the mouse freezes (src-tauri/src/screenshot.rs),
// the island's own window covers it with the frozen picture, dimmed, and the
// user circles or boxes a zone (the zone is the box around the stroke, so a
// circle and a drag from corner to corner both work). Next to the zone: a
// question for the chat, the user's own quick actions (nothing built in), and
// Copia immagine / Copia testo (Windows' OCR) / Nel Vassoio. Esc or the right
// button cancel at once. Coordinates sent to Rust are physical px of the frozen screen.

import { Bridge, type CaptureZone, type DroppedFile } from "../core/bridge";
import { t } from "../core/i18n";
import { State, type QuickAction } from "../core/state";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { renderActionIcon } from "../views/action-icons";

export interface CaptureHandlers {
  /** The zone (saved in the inbox) to the chat; `question` "" = attached, waiting for one. */
  ask(file: DroppedFile, question: string): void;
  /** Done without the chat: a short message from the island. */
  done(message: string): void;
  /** The capture could not start. */
  failed(message: string): void;
}

/** Below this (physical px) a stroke is a click, not a zone. */
const MIN_ZONE = 12;
/** Room left around the stroke, physical px. */
const PAD = 4;

let open = false;

export function capturing(): boolean {
  return open;
}

/** The prompts the user made for selected text or a file: they fit a picture too. */
function zoneActions(): QuickAction[] {
  return (State.settings.actions ?? []).filter((a) => a.kind === "prompt" && a.output !== "replace" && (a.input === "selection" || a.input === "file"));
}

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

export async function startCapture(handlers: CaptureHandlers): Promise<void> {
  if (open) return;
  open = true;
  let screen;
  let pixels: ArrayBuffer;
  try {
    screen = await Bridge.captureBegin();
    pixels = await Bridge.captureFrame();
  } catch (e) {
    open = false;
    void Bridge.captureEnd();
    handlers.failed(errText(e));
    return;
  }
  const { width: W, height: H } = screen;
  if (pixels.byteLength !== W * H * 4) {
    open = false;
    void Bridge.captureEnd();
    handlers.failed(t("Non riesco a leggere lo schermo"));
    return;
  }

  // The frozen screen, kept apart: every redraw starts from it.
  const frozen = document.createElement("canvas");
  frozen.width = W;
  frozen.height = H;
  frozen.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);

  const canvas = h("canvas", { class: "cap-canvas" }) as HTMLCanvasElement;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const hint = h("div", { class: "cap-hint", text: t("Cerchia o riquadra una zona · Esc per annullare") });
  const panel = h("div", { class: "cap-panel", style: "display:none" });
  const root = h("div", { id: "capture", tabindex: "-1" }, canvas, hint, panel);
  document.body.append(root);

  let path: [number, number][] = [];
  let drawing = false;
  let zone: CaptureZone | null = null;
  let busy = false;

  /** Physical px per CSS px of the overlay (the window may sit on a display of another scale). */
  const k = () => W / Math.max(1, canvas.getBoundingClientRect().width);
  const at = (e: PointerEvent): [number, number] => [e.clientX * k(), e.clientY * k()];

  const render = () => {
    ctx.drawImage(frozen, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W, H);
    const box = zone ?? (path.length ? boxOf(path) : null);
    if (box) {
      ctx.drawImage(frozen, box.x, box.y, box.width, box.height, box.x, box.y, box.width, box.height);
      ctx.lineWidth = 2 * k();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    if (drawing && path.length > 1) {
      ctx.save();
      ctx.lineWidth = 4 * k();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#22d3ee";
      ctx.shadowColor = "rgba(34,211,238,0.8)";
      ctx.shadowBlur = 10 * k();
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (const [x, y] of path.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const boxOf = (pts: [number, number][]): CaptureZone => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.min(...xs) - PAD);
    const y0 = Math.max(0, Math.min(...ys) - PAD);
    const x1 = Math.min(W, Math.max(...xs) + PAD);
    const y1 = Math.min(H, Math.max(...ys) + PAD);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  };

  const finish = () => {
    if (!open) return;
    open = false;
    window.removeEventListener("keydown", onKey, true);
    root.remove();
    void Bridge.captureEnd();
  };

  const onKey = (e: KeyboardEvent) => {
    // The island's own keys (Esc closes it, arrows…) wait until the overlay is gone.
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (zone && !busy) {
        // First Esc: the zone goes, the screen stays to draw another.
        zone = null;
        panel.style.display = "none";
        hint.style.display = "";
        render();
        root.focus();
      } else if (!busy) {
        finish();
      }
    }
  };
  window.addEventListener("keydown", onKey, true);

  root.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!busy) finish();
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || busy) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    zone = null;
    path = [at(e)];
    panel.style.display = "none";
    hint.style.display = "none";
    render();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    path.push(at(e));
    render();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const box = boxOf(path);
    path = [];
    if (box.width < MIN_ZONE || box.height < MIN_ZONE) {
      hint.style.display = "";
      render();
      return;
    }
    zone = box;
    render();
    showPanel(box);
  });

  // ── The panel next to the zone ─────────────────────────────────────────────

  const error = h("div", { class: "cap-error", style: "display:none" });
  const input = h("input", { class: "cap-input", type: "text", spellcheck: "false", placeholder: t("Chiedi qualcosa su questa zona…") }) as HTMLInputElement;
  const send = h("button", { class: "cap-send", title: t("Chiedi (Invio)") }, svg(ICONS.send, 15));

  /** Runs one of the panel's choices with the panel busy; an error keeps the overlay up. */
  const run = async (button: HTMLElement | null, job: (z: CaptureZone) => Promise<void>) => {
    if (!zone || busy) return;
    busy = true;
    panel.classList.add("busy");
    button?.classList.add("working");
    error.style.display = "none";
    try {
      await job(zone);
    } catch (e) {
      busy = false;
      panel.classList.remove("busy");
      button?.classList.remove("working");
      error.textContent = errText(e);
      error.style.display = "";
    }
  };
  const ask = (question: string, button: HTMLElement | null) =>
    run(button, async (z) => {
      const file = await Bridge.captureSave(z);
      finish();
      handlers.ask(file, question);
    });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void ask(input.value.trim(), send);
    }
  });
  send.addEventListener("click", () => void ask(input.value.trim(), send));

  const tool = (icon: string, label: string, job: (z: CaptureZone, b: HTMLElement) => Promise<void>) => {
    const b = h("button", { class: "cap-tool" }, svg(icon, 13), h("span", { text: label }));
    b.addEventListener("click", () => void run(b, (z) => job(z, b)));
    return b;
  };
  const tools = h("div", { class: "cap-row" },
    tool(ICONS.copy, t("Copia immagine"), async (z) => {
      await Bridge.captureCopy(z);
      finish();
      handlers.done(t("Zona copiata negli appunti"));
    }),
    tool(ICONS.doc, t("Copia testo"), async (z) => {
      const text = await Bridge.captureText(z);
      finish();
      const lines = text.split("\n").filter((l) => l.trim()).length;
      handlers.done(lines === 1 ? t("Testo copiato: 1 riga") : t("Testo copiato: {n} righe", { n: lines }));
    }),
    tool(ICONS.stack, t("Nel Vassoio"), async (z) => {
      await Bridge.captureSave(z);
      finish();
      handlers.done(t("Zona salvata nel Vassoio"));
    }),
  );

  const actions = zoneActions();
  const chips = actions.length
    ? h("div", { class: "cap-row cap-actions" }, ...actions.map((a) => {
      const color = /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#8e939c";
      const b = h("button", { class: "cap-chip", style: `--c:${color}`, title: a.prompt },
        h("span", { class: "cap-chip-icon" }, renderActionIcon(a.icon, 13)), h("span", { text: a.name || t("Senza nome") }));
      b.addEventListener("click", () => void ask(a.prompt, b));
      return b;
    }))
    : null;

  panel.append(h("div", { class: "cap-ask" }, input, send), chips ?? "", tools, error);
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  const showPanel = (box: CaptureZone) => {
    panel.style.display = "";
    error.style.display = "none";
    const s = 1 / k();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(380, vw - 24);
    panel.style.width = `${pw}px`;
    const ph = panel.offsetHeight;
    const left = Math.min(Math.max(12, box.x * s), vw - pw - 12);
    const below = (box.y + box.height) * s + 10;
    const above = box.y * s - ph - 10;
    const top = below + ph <= vh - 12 ? below : above >= 12 ? above : Math.max(12, (box.y + box.height) * s - ph - 12);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    input.value = "";
    input.focus();
  };

  render();
  // Shown once the window covers the screen, so the picture never flashes in the small window.
  root.style.opacity = "0";
  try {
    await Bridge.captureShow();
  } catch (e) {
    finish();
    handlers.failed(errText(e));
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.style.opacity = "1";
    root.focus();
  }));
}
