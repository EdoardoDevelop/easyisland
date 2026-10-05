// Tooltips drawn in the page. WebView2's own tooltips are separate windows,
// and the island keeps raising itself to the top of the topmost band
// (island.rs → raise_over_taskbar): they ended up behind it. Every `title`
// is moved to `data-tip` on hover, so the native one never shows.

const DELAY_MS = 450;
const GAP = 6;

let tip: HTMLDivElement | null = null;
let target: Element | null = null;
let timer: number | null = null;

function el(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    document.body.append(tip);
  }
  return tip;
}

function hide() {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  target = null;
  if (tip) tip.classList.remove("on");
}

function show(anchor: Element) {
  const text = anchor.getAttribute("data-tip");
  if (!text || !anchor.isConnected) return;
  const t = el();
  t.textContent = text;
  t.classList.add("on");
  // Under the element, or above it when there is no room; always inside the window.
  const r = anchor.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let top = r.bottom + GAP;
  if (top + h > vh - 2) top = Math.max(2, r.top - GAP - h);
  const left = Math.min(Math.max(2, r.left + r.width / 2 - w / 2), Math.max(2, vw - w - 2));
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
}

/** Clicked or scrolled: no tooltip for it until the mouse goes somewhere else. */
let quiet: Element | null = null;

function dismiss() {
  quiet = target;
  hide();
}

function hover(e: Event) {
  const found = (e.target as Element | null)?.closest?.("[title], [data-tip]") ?? null;
  // Also on mousemove: a title set while the mouse is already there (📌 after a click).
  if (found?.hasAttribute("title")) {
    const text = found.getAttribute("title") ?? "";
    found.removeAttribute("title");
    if (text) found.setAttribute("data-tip", text);
    else found.removeAttribute("data-tip");
  }
  const anchor = found?.hasAttribute("data-tip") ? found : null;
  if (anchor === quiet) return;
  quiet = null;
  if (anchor === target) return;
  hide();
  if (!anchor) return;
  target = anchor;
  timer = window.setTimeout(() => {
    timer = null;
    if (target === anchor) show(anchor);
  }, DELAY_MS);
}

export function installTooltips() {
  document.addEventListener("mouseover", hover);
  document.addEventListener("mousemove", hover, { passive: true });
  document.addEventListener("mouseleave", () => { quiet = null; hide(); });
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("wheel", dismiss, { passive: true, capture: true });
  document.addEventListener("keydown", dismiss, true);
}
