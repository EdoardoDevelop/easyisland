// A picture attached to the question, marked before it goes (26 Nov 2026,
// Edoardo): a box around what to look at, an arrow, a line by hand, or a part
// covered (a password, a name). The marks are drawn into a new PNG in the
// Vassoio (chat_image_save), which takes the original's place in the
// question; the original stays in the Vassoio as it was.

import "./chat-mark.css";
import { Bridge, type ChatAttachment } from "../core/bridge";
import { t } from "../core/i18n";
import { h } from "./dom";

type Tool = "box" | "arrow" | "pen" | "hide";
interface Mark {
  tool: Tool;
  color: string;
  pts: { x: number; y: number }[];
}

/** An attachment of the question (State.chatAttach). */
export interface Attached {
  name: string;
  path: string;
  folder?: boolean;
}

const COLORS = ["#ff3b30", "#ffcc00", "#2f9bff", "#34c759"];
const PICTURE = /\.(png|jpe?g|webp|bmp)$/i;

/** A picture the editor can open (not a GIF: its frames would be lost). */
export function markable(a: Attached): boolean {
  return !a.folder && PICTURE.test(a.name);
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" };

/**
 * The editor over `host` (the chat): the marked picture as a new attachment,
 * or null when closed without «Usa».
 */
export function markImage(host: HTMLElement, a: Attached): Promise<ChatAttachment | null> {
  return new Promise((resolve) => {
    const marks: Mark[] = [];
    let tool: Tool = "box";
    let color = COLORS[0];
    let drawing: Mark | null = null;
    let img: HTMLImageElement | null = null;
    let url = "";

    const canvas = h("canvas", { class: "chat-mark-canvas" }) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const stage = h("div", { class: "chat-mark-stage" }, h("div", { class: "chat-mark-wait", text: "…" }));
    const toolBtns = new Map<Tool, HTMLButtonElement>();
    const tools: [Tool, string, string][] = [
      ["box", "▭", t("Riquadro")],
      ["arrow", "➚", t("Freccia")],
      ["pen", "✎", t("Penna")],
      ["hide", "▇", t("Oscura: copre una parte, per password e dati")],
    ];
    const toolRow = h("div", { class: "chat-mark-tools" });
    for (const [id, icon, label] of tools) {
      const b = h("button", { class: "chat-mark-tool", title: label, type: "button" }, h("span", { class: "chat-mark-ico", text: icon }), h("span", { text: label.split(":")[0] })) as HTMLButtonElement;
      b.addEventListener("click", () => pickTool(id));
      toolBtns.set(id, b);
      toolRow.append(b);
    }
    const colorBtns = COLORS.map((c) => {
      const b = h("button", { class: "chat-mark-color", title: t("Colore"), type: "button" }) as HTMLButtonElement;
      b.style.setProperty("--c", c);
      b.addEventListener("click", () => {
        color = c;
        colorBtns.forEach((x) => x.classList.toggle("on", x === b));
      });
      return b;
    });
    colorBtns[0].classList.add("on");
    const undo = h("button", { class: "chat-mark-btn", title: t("Annulla l'ultimo segno (Ctrl+Z)"), type: "button", text: "↶" }) as HTMLButtonElement;
    const cancel = h("button", { class: "chat-mark-btn", type: "button", text: t("Chiudi") }) as HTMLButtonElement;
    const use = h("button", { class: "chat-mark-btn primary", type: "button", text: t("Usa") }) as HTMLButtonElement;
    const hint = h("div", { class: "chat-mark-hint", text: t("Trascina sull'immagine per segnare cosa guardare.") });
    const bar = h("div", { class: "chat-mark-bar" }, toolRow, h("div", { class: "chat-mark-colors" }, ...colorBtns), undo, h("span", { class: "chat-mark-gap" }), cancel, use);
    const box = h("div", { class: "chat-mark", tabindex: "-1" }, bar, stage, hint);

    function pickTool(id: Tool) {
      tool = id;
      toolBtns.forEach((b, k) => b.classList.toggle("on", k === id));
    }
    pickTool("box");

    // Thick enough on screen (3 px as shown) and in the picture itself; never a brush.
    const width = () => {
      const shown = canvas.getBoundingClientRect().width;
      const scale = shown > 0 ? canvas.width / shown : 1;
      const side = Math.min(canvas.width, canvas.height);
      return Math.max(3, Math.round(Math.min(Math.max(side / 180, 3 * scale), side / 60)));
    };

    function drawMark(m: Mark) {
      const [p, q] = [m.pts[0], m.pts[m.pts.length - 1]];
      if (!p || !q) return;
      const w = width();
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = w;
      const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y), bw = Math.abs(q.x - p.x), bh = Math.abs(q.y - p.y);
      if (m.tool === "hide") {
        ctx.fillStyle = "#111318";
        ctx.fillRect(x, y, bw, bh);
      } else if (m.tool === "box") {
        const r = Math.min(w * 2, bw / 2, bh / 2);
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
        ctx.globalAlpha = 0.1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else if (m.tool === "arrow") {
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        const head = w * 4.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x - Math.cos(ang) * head * 0.6, q.y - Math.sin(ang) * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - head * Math.cos(ang - 0.45), q.y - head * Math.sin(ang - 0.45));
        ctx.lineTo(q.x - head * Math.cos(ang + 0.45), q.y - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        m.pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.stroke();
      }
      ctx.restore();
    }

    function redraw() {
      if (!img) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      marks.forEach(drawMark);
      if (drawing) drawMark(drawing);
      undo.disabled = !marks.length;
      use.disabled = !marks.length;
    }

    function at(e: PointerEvent) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!img || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      drawing = { tool, color, pts: [at(e)] };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = at(e);
      if (drawing.tool === "pen") drawing.pts.push(p);
      else drawing.pts[1] = p;
      redraw();
    });
    const end = () => {
      if (!drawing) return;
      const [p, q] = [drawing.pts[0], drawing.pts[drawing.pts.length - 1]];
      // A click without dragging leaves no mark.
      if (drawing.pts.length > 1 && Math.hypot(q.x - p.x, q.y - p.y) > width() * 2) {
        marks.push(drawing);
        hint.style.visibility = "hidden";
      }
      drawing = null;
      redraw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    function close(result: ChatAttachment | null) {
      box.remove();
      if (url) URL.revokeObjectURL(url);
      resolve(result);
    }

    undo.addEventListener("click", () => {
      marks.pop();
      redraw();
    });
    cancel.addEventListener("click", () => close(null));
    use.addEventListener("click", () => {
      if (!marks.length) return;
      use.disabled = true;
      canvas.toBlob(async (blob) => {
        try {
          if (!blob) throw new Error(t("Immagine non salvata"));
          const stem = a.name.replace(/\.[^.]+$/, "");
          const saved = await Bridge.chatImageSave(`${stem} (${t("segnata")}).png`, new Uint8Array(await blob.arrayBuffer()));
          close(saved);
        } catch (err) {
          use.disabled = false;
          hint.style.visibility = "";
          hint.textContent = String(err).replace(/^Error:\s*/, "");
        }
      }, "image/png");
    });
    box.addEventListener("keydown", (e) => {
      e.stopPropagation(); // Escape closes this, not the island
      if (e.key === "Escape") close(null);
      else if (e.key === "Enter" && marks.length) use.click();
      else if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo.click();
      }
    });

    host.append(box);
    box.focus();
    redraw();
    Bridge.fileBytes(a.path)
      .then((bytes) => {
        const ext = a.name.split(".").pop()?.toLowerCase() ?? "png";
        url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "image/png" }));
        const pic = new Image();
        pic.onload = () => {
          img = pic;
          canvas.width = pic.naturalWidth;
          canvas.height = pic.naturalHeight;
          stage.replaceChildren(canvas);
          redraw();
        };
        pic.onerror = () => stage.replaceChildren(h("div", { class: "chat-mark-wait", text: t("Questa immagine non si riesce ad aprire.") }));
        pic.src = url;
      })
      .catch((err) => stage.replaceChildren(h("div", { class: "chat-mark-wait", text: String(err).replace(/^Error:\s*/, "") })));
  });
}
