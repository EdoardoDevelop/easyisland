// The «EasyIsland» folder of Windows' Start menu (startmenu.rs): the chat and
// every integration that is on, each opening in a window of its own (Edoardo,
// 26 Nov 2026). The island knows the integrations and draws their icons (logo,
// the user's emoji, else the colour) as 256-pixel PNGs; Rust writes the
// shortcuts. Done again only when the list, a name, an icon or the setting
// changes, a few seconds after (never during the start's busiest moment).

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { State, isSessionTask, type AgentTask } from "../core/state";
import { markIcon } from "../views/dom";

const SIZE = 256;
let lastKey = "";
let timer = 0;

/** The integrations of the menu: on, not a Claude Code session. */
function entries(): AgentTask[] {
  return State.tasks.filter((x) => !isSessionTask(x) && (x.id.startsWith("integration_") || x.id.startsWith("custom:")));
}

/**
 * What the folder depends on: when it is the same, nothing is written. Not
 * the live colour of a task (it follows its state): only the chosen one.
 */
function keyOf(list: AgentTask[]): string {
  const icons = State.settings.integrationTabIcons ?? {};
  const colors = State.settings.integrationColors ?? {};
  const customs = State.customs.map((c) => `${c.id}:${c.icon ?? ""}`).join(",");
  return `${State.settings.startMenu !== false}|${State.settings.language ?? ""}|${customs}|` +
    list.map((x) => `${x.id}=${x.name}=${colors[x.id] ?? ""}=${icons[x.id] ?? ""}`).join(";");
}

/**
 * After every redraw of the island: the folder follows, 4 s after the first
 * change (never pushed back by more changes: a name that keeps changing
 * would have kept it from ever being written), with the list as it is then.
 */
export function watchStartMenu() {
  if (timer) return;
  const key = keyOf(entries());
  if (key === lastKey) return;
  timer = window.setTimeout(() => {
    timer = 0;
    const list = entries();
    lastKey = keyOf(list);
    void sync(list);
  }, 4000);
}

async function sync(list: AgentTask[]) {
  try {
    const items = [{ id: "chat", name: t("Chat di EasyIsland"), png: await pngOf(null) }];
    for (const task of list) items.push({ id: task.id, name: task.name, png: await pngOf(task) });
    await Bridge.startMenuSync(items);
  } catch (e) {
    void Bridge.log(`menu Start: icone non disegnate (${String(e)})`);
  }
}

/** A rounded tile in the island's dark with the icon in the middle, as base64 PNG. */
async function pngOf(task: AgentTask | null): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#1c1d21";
  g.beginPath();
  g.roundRect(8, 8, SIZE - 16, SIZE - 16, 52);
  g.fill();
  const color = (task && State.settings.integrationColors?.[task.id]) || task?.color || "#4cc2ff";
  const own = task ? State.settings.integrationTabIcons?.[task.id]?.trim() ?? "" : "";
  const custom = task?.id.startsWith("custom:") ? State.customs.find((c) => `custom:${c.id}` === task.id)?.icon ?? "" : "";
  const emoji = (own && !own.startsWith("@")) ? own : custom;
  if (!task) {
    // The chat: a speech bubble in the accent colour.
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(56, 64, 144, 104, 30);
    g.moveTo(92, 160);
    g.lineTo(80, 200);
    g.lineTo(124, 164);
    g.fill();
  } else if (emoji) {
    g.font = `128px "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(emoji, SIZE / 2, SIZE / 2 + 8);
  } else {
    const mark = markIcon(task.id, 150);
    const drawn = mark ? await drawSvg(g, mark, color) : false;
    if (!drawn) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(SIZE / 2, SIZE / 2, 56, 0, Math.PI * 2);
      g.fill();
    }
  }
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

/** A logo (SVG of dom.ts) drawn in the middle, at most 150 px, keeping its shape. */
async function drawSvg(g: CanvasRenderingContext2D, mark: Element, color: string): Promise<boolean> {
  try {
    const el = mark.cloneNode(true) as Element;
    if (el.tagName.toLowerCase() !== "svg") return false;
    el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    el.setAttribute("color", color);
    const w = Number(el.getAttribute("width")) || 150;
    const hh = Number(el.getAttribute("height")) || 150;
    const k = 150 / Math.max(w, hh);
    const text = new XMLSerializer().serializeToString(el).replace(/currentColor/g, color);
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      // A logo that never loads must not hold the whole folder back.
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error("svg"));
        window.setTimeout(() => fail(new Error("svg: tempo scaduto")), 3000);
        img.src = url;
      });
      const dw = w * k, dh = hh * k;
      g.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return false;
  }
}
