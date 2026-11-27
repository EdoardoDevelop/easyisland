// An integration's own page (custom.rs `page`, Edoardo 27 Nov 2026): HTML with
// its scripts, in place of the form. It runs in a sandboxed frame served by
// Rust (eipage://<id>, a CSP of its own: no network, no Tauri, no forms sent);
// its scripts reach EasyIsland only through `easyisland.…`
// (src-tauri/src/custom_page_bridge.js), messages answered here by `serve`.
// What a message can do is what the card does with a click: records, sources,
// calls to the declared hosts (checked and keyed in Rust), its own actions (a
// script still waits for «Esegui»), notices.

import { h } from "./dom";
import { PALETTE } from "../core/diagram";
import type { Custom } from "../core/state";

/** What the card does for the page: one function per request. */
export type PageServe = (op: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PageFrame {
  el: HTMLElement;
  /** An event to the page's scripts (`easyisland.on(name, …)`). */
  send(event: string, value: unknown): void;
}

/** The tallest the frame grows to before the card scrolls it. */
const MAX_HEIGHT = 4000;

/** Black or white, whichever reads on `colour` (any CSS colour: the browser turns it into rgb). */
function inkOn(colour: string): string {
  const probe = document.createElement("span");
  probe.style.color = colour;
  document.body.append(probe);
  const [r, g, b] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
  probe.remove();
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111317" : "#ffffff";
}

/** The island's colours, read from its CSS, for the page's --ei-… variables. */
function theme(): { scheme: string; vars: Record<string, string> } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const scheme = document.documentElement.dataset.scheme === "light" ? "light" : "dark";
  const accent = v("--link", "#38bdf8");
  return {
    scheme,
    vars: {
      text: v("--ink", scheme === "light" ? "#1f2226" : "#f5f6f8"),
      dim: v("--dim", "#9398a1"),
      card: v("--card", scheme === "light" ? "#ffffff" : "#141518"),
      line: v("--int-line", "rgba(127,127,127,0.25)"),
      accent,
      // The style's accent can be almost white (Studio): the text on it, readable.
      "accent-text": inkOn(accent),
      red: v("--red", "#f4505e"),
      green: v("--green", "#22c55e"),
      amber: v("--amber", "#f5a524"),
      font: v("--font", "'Segoe UI', sans-serif"),
      // The chat's chart colours (diagram.ts), for the page's series: --ei-c1 … --ei-c8.
      ...Object.fromEntries(PALETTE.map((c, i) => [`c${i + 1}`, c])),
    },
  };
}

/** Where the page is served: Rust's scheme in the app, the text itself in a browser preview. */
function frameSource(frame: HTMLIFrameElement, c: Custom) {
  const inApp = "__TAURI_INTERNALS__" in window;
  if (inApp) frame.src = `http://eipage.localhost/${encodeURIComponent(c.id)}?v=${hash(c.page ?? "")}`;
  // npm run dev in a browser: no Rust, no scheme; the bridge comes with the scene (dev/scenes.ts).
  else frame.srcdoc = (window as unknown as { eiPageDev?: (page: string) => string }).eiPageDev?.(c.page ?? "") ?? (c.page ?? "");
}

/** A short mark of the page's text: a changed page is a new address, never an old copy. */
function hash(s: string): string {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

export function pageFrame(c: Custom, serve: PageServe, onFocus: (on: boolean, el: HTMLElement) => void): PageFrame {
  const frame = h("iframe", { class: "custom-page", title: c.name }) as HTMLIFrameElement;
  // Scripts only: an opaque origin (nothing of the island's), no popups, no navigation of the island.
  frame.setAttribute("sandbox", "allow-scripts allow-forms");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frameSource(frame, c);
  const send = (event: string, value: unknown) => frame.contentWindow?.postMessage({ ei: 1, event, value }, "*");

  const onMessage = async (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data as { ei?: number; id?: number; op?: string; args?: unknown } | null;
    if (!m || m.ei !== 1 || typeof m.op !== "string") return;
    if (m.op === "ready") {
      send("theme", theme());
      return;
    }
    if (m.op === "focus") {
      onFocus(!!m.args, frame);
      return;
    }
    if (m.op === "height") {
      const px = Math.min(MAX_HEIGHT, Math.max(40, Number(m.args) || 0));
      frame.style.height = `${px}px`;
      return;
    }
    const reply = (msg: Record<string, unknown>) => frame.contentWindow?.postMessage({ ei: 1, id: m.id, ...msg }, "*");
    try {
      const args = (m.args && typeof m.args === "object" ? m.args : {}) as Record<string, unknown>;
      reply({ ok: true, value: await serve(m.op, args) });
    } catch (err) {
      reply({ ok: false, error: String(err instanceof Error ? err.message : err).replace(/^Error:\s*/, "") });
    }
  };
  window.addEventListener("message", onMessage);
  // The theme follows the island's (light, dark, styles).
  const look = new MutationObserver(() => send("theme", theme()));
  look.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme", "class", "style"] });
  // Gone with its card: no listener left behind.
  let shown = false;
  const gone = new MutationObserver(() => {
    if (frame.isConnected) shown = true;
    else if (shown) {
      window.removeEventListener("message", onMessage);
      look.disconnect();
      gone.disconnect();
    }
  });
  queueMicrotask(() => gone.observe(document.body, { childList: true, subtree: true }));
  return { el: frame, send };
}
