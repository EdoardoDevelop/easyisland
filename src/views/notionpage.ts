// The mini Notion of the Notion card: a page chosen in the settings (or
// found with the search) drawn as Notion draws it, edited in place, and a
// database as a table, a board, a list or a gallery. Data and edits go
// through notion_page.rs; deleting sends to Notion's trash, after a second
// click. The view lives outside the card (views.ts does not rebuild it while
// it is open), so what is being typed keeps its caret.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { locale, t } from "../core/i18n";
import { Sound } from "../core/sound";
import { State } from "../core/state";

export interface NotionRefLite { id: string; title: string; emoji?: string | null; url: string; database?: boolean }

interface Span { t: string; b?: boolean; i?: boolean; s?: boolean; u?: boolean; c?: boolean; href?: string; color?: string; mention?: boolean }
interface Block {
  id: string; type: string; hasChildren?: boolean; children?: Block[];
  spans?: Span[]; checked?: boolean; color?: string; emoji?: string; lang?: string; toggle?: boolean;
  url?: string; caption?: string; title?: string; cells?: Span[][]; header?: boolean; target?: string; database?: boolean;
}
interface Icon { emoji?: string; url?: string }
interface Cell { kind: string; text: string; color?: string; checked?: boolean; items?: [string, string][]; date?: string }
interface Column { name: string; kind: string; options: [string, string][] }
interface Row { id: string; url: string; icon: Icon | null; cover: string; cells: Record<string, Cell> }
interface PageDoc { kind: "page"; id: string; title: string; icon: Icon | null; cover: string; url: string; database: string | null; props: { name: string; cell: Cell }[]; blocks: Block[] }
interface DbDoc { kind: "database"; id: string; title: string; icon: Icon | null; cover: string; url: string; columns: Column[]; rows: Row[] }
type Doc = PageDoc | DbDoc;
type DbView = "table" | "board" | "list" | "gallery";

const TEXT_KINDS = new Set(["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout", "code"]);

/** What a new block can be, in Notion's order. */
const KINDS: [string, string, string][] = [
  ["paragraph", "Aa", t("Testo")],
  ["heading_1", "H1", t("Titolo 1")],
  ["heading_2", "H2", t("Titolo 2")],
  ["heading_3", "H3", t("Titolo 3")],
  ["bulleted_list_item", "•", t("Elenco puntato")],
  ["numbered_list_item", "1.", t("Elenco numerato")],
  ["to_do", "☐", t("Da fare")],
  ["toggle", "▸", t("Toggle")],
  ["quote", "❝", t("Citazione")],
  ["callout", "💡", t("Callout")],
  ["code", "</>", t("Codice")],
  ["divider", "—", t("Divisore")],
];

/** Notion's colours in dark mode: text, and the background of tags and callouts. */
const TEXT_COLOR: Record<string, string> = {
  gray: "#9B9B9B", brown: "#BA856F", orange: "#C77D48", yellow: "#CA9849", green: "#529E72",
  blue: "#5E87C9", purple: "#9D68D3", pink: "#D15796", red: "#DF5452",
};
const BG_COLOR: Record<string, string> = {
  default: "#373737", gray: "#3B3B3B", brown: "#4A3228", orange: "#5C3B23", yellow: "#564328", green: "#243D30",
  blue: "#143A4E", purple: "#3C2D49", pink: "#4E2C3C", red: "#522E2A",
};
const TAG_TEXT: Record<string, string> = {
  default: "#D4D4D4", gray: "#D4D4D4", brown: "#E6C6B5", orange: "#F2C49A", yellow: "#F2D58C", green: "#A9D9B9",
  blue: "#A9CBEF", purple: "#D7BCEF", pink: "#EFB8D3", red: "#F4B5AF",
};

const np = {
  stack: [] as NotionRefLite[],
  doc: null as Doc | null,
  loading: false,
  error: "",
  status: "" as "" | "saving" | "saved" | "error",
  statusMsg: "",
  statusTimer: 0,
  el: null as HTMLElement | null,
  open: new Set<string>(),
  images: new Map<string, string>(),
  /** Columns of the databases seen, for the properties of a row opened as a page. */
  columns: new Map<string, Column[]>(),
  focus: null as { id: string; end: boolean } | null,
  onClose: (() => {}) as () => void,
  menu: null as HTMLElement | null,
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/** True while a page is open in the card. */
export function notionPageActive(): boolean {
  return np.stack.length > 0;
}

/** Opens a page or a database in the card; `onClose` when Indietro leaves the first one. */
export function openNotionPage(ref: NotionRefLite, onClose: () => void) {
  np.stack = [ref];
  np.onClose = onClose;
  np.open.clear();
  void load();
}

export function closeNotionPage() {
  np.stack = [];
  np.doc = null;
  closeMenu();
}

/** The view, the same element at every rebuild of the card. */
export function notionPageCard(): HTMLElement {
  if (!np.el) {
    np.el = h("div", { class: "int-card np-card", onpointerdown: () => void Bridge.focusWindow(true) });
    draw();
  }
  return np.el;
}

function go(ref: NotionRefLite) {
  closeMenu();
  np.stack.push(ref);
  void load();
}

function back() {
  closeMenu();
  np.stack.pop();
  if (!np.stack.length) {
    np.doc = null;
    np.onClose();
    return;
  }
  void load();
}

async function load() {
  const ref = np.stack[np.stack.length - 1];
  if (!ref) return;
  np.loading = true;
  np.error = "";
  np.doc = null;
  draw();
  try {
    const doc = (ref.database ? await Bridge.notionOpenDatabase(ref.id) : await Bridge.notionOpenPage(ref.id)) as Doc;
    if (np.stack[np.stack.length - 1] !== ref) return;
    np.doc = doc;
    if (doc.kind === "database") np.columns.set(norm(doc.id), doc.columns);
    // The crumb takes the real title and emoji.
    ref.title = doc.title || ref.title;
    if (doc.icon?.emoji) ref.emoji = doc.icon.emoji;
    if (doc.url) ref.url = doc.url;
  } catch (e) {
    np.error = errText(e);
  }
  np.loading = false;
  draw();
  // The island fits its height to what is now in the card.
  State.notify();
}

const norm = (id: string) => id.replace(/-/g, "");

function saving(p: Promise<unknown>): Promise<boolean> {
  window.clearTimeout(np.statusTimer);
  np.status = "saving";
  drawStatus();
  return p.then(() => {
    np.status = "saved";
    drawStatus();
    np.statusTimer = window.setTimeout(() => { np.status = ""; drawStatus(); }, 1800);
    return true;
  }, (e) => {
    np.status = "error";
    np.statusMsg = errText(e);
    drawStatus();
    return false;
  });
}

let statusEl: HTMLElement | null = null;
function drawStatus() {
  if (!statusEl) return;
  statusEl.className = `np-status${np.status === "error" ? " bad" : ""}`;
  statusEl.textContent = np.status === "saving" ? t("Salvo…") : np.status === "saved" ? t("Salvato ✓") : np.status === "error" ? np.statusMsg : "";
  statusEl.title = statusEl.textContent;
}

// ── Frame ─────────────────────────────────────────────────────────────────────

function draw() {
  const el = np.el;
  if (!el) return;
  closeMenu();
  // The same page drawn again (a toggle, a new block): it stays where it was scrolled.
  const kept = el.querySelector<HTMLElement>(".np-scroll");
  const scrollKey = np.doc ? np.doc.id : "";
  const scrollTop = kept && kept.dataset.page === scrollKey ? kept.scrollTop : 0;
  clear(el);
  const doc = np.doc;
  const ref = np.stack[np.stack.length - 1];
  const crumbs = h("div", { class: "np-crumbs" });
  np.stack.forEach((r, i) => {
    if (i) crumbs.append(h("span", { class: "np-sep", text: "/" }));
    crumbs.append(h("button", {
      class: `np-crumb${i === np.stack.length - 1 ? " on" : ""}`, title: r.title,
      onclick: () => { if (i < np.stack.length - 1) { np.stack = np.stack.slice(0, i + 1); void load(); } },
    }, r.emoji ? h("span", { text: r.emoji }) : svg(r.database ? ICONS.stack : ICONS.doc, 10), h("span", { class: "np-crumb-t", text: r.title || t("Senza titolo") })));
  });
  statusEl = h("span", { class: "np-status" });
  drawStatus();
  const url = doc?.url || ref?.url || "";
  el.append(h("div", { class: "np-head" },
    h("button", { class: "int-back", title: t("Indietro"), onclick: back }, svg(ICONS.chevronLeft, 13, { stroke: 2.4 })),
    crumbs, statusEl,
    h("button", { class: "np-tool", title: t("Ricarica"), text: "↻", onclick: () => void load() }),
    url ? h("button", { class: "np-tool", title: t("Apri in Notion"), onclick: () => void Bridge.openUrl(url) }, svg(ICONS.arrowUpRight, 12)) : null));

  const scroll = h("div", { class: "np-scroll", "data-page": scrollKey });
  el.append(scroll);
  window.setTimeout(() => { if (scrollTop) scroll.scrollTop = scrollTop; }, 0);
  if (np.loading) {
    scroll.append(h("div", { class: "np-skeleton" }, ...[70, 92, 84, 60, 88].map((w) => h("i", { style: `width:${w}%` }))));
    return;
  }
  if (np.error || !doc) {
    scroll.append(h("div", { class: "np-error" },
      h("span", { text: np.error || t("Pagina non disponibile") }),
      url ? h("button", { class: "btn secondary", onclick: () => void Bridge.openUrl(url) }, h("span", { text: t("Apri in Notion") })) : null));
    return;
  }
  if (doc.cover) scroll.append(picture(doc.cover, "np-cover"));
  const top = h("div", { class: `np-top${doc.cover ? " with-cover" : ""}` });
  if (doc.icon?.emoji) top.append(h("div", { class: "np-icon", text: doc.icon.emoji }));
  else if (doc.icon?.url) top.append(picture(doc.icon.url, "np-icon img"));
  top.append(titleEl(doc));
  scroll.append(top);
  if (doc.kind === "page") {
    if (doc.props.length) scroll.append(propsEl(doc));
    const list = h("div", { class: "np-blocks" });
    blocksInto(list, doc.blocks, doc.id, 0);
    scroll.append(list);
    scroll.append(h("button", {
      class: "np-add-end", onclick: () => void addBlock(doc.id, lastId(doc.blocks), "paragraph", []),
    }, svg(ICONS.plus, 11), h("span", { text: t("Fai clic per aggiungere un blocco") })));
  } else {
    scroll.append(databaseEl(doc));
  }
  if (np.focus) {
    const f = np.focus;
    np.focus = null;
    const target = scroll.querySelector<HTMLElement>(`[data-edit="${f.id}"]`);
    if (target) window.setTimeout(() => caret(target, f.end), 0);
  }
}

function titleEl(doc: Doc): HTMLElement {
  const el = h("div", { class: "np-title", contenteditable: "true", spellcheck: "true", "data-placeholder": t("Senza titolo"), text: doc.title });
  let before = doc.title;
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    if (e.key === "Escape") { e.stopPropagation(); el.textContent = before; el.blur(); }
  });
  el.addEventListener("paste", plainPaste);
  el.addEventListener("blur", () => {
    const now = (el.textContent ?? "").trim();
    if (now === before) return;
    before = now;
    doc.title = now;
    const ref = np.stack[np.stack.length - 1];
    if (ref) ref.title = now;
    void saving(doc.kind === "page" ? Bridge.notionPageTitle(doc.id, now) : Promise.reject(t("Il titolo di un database si cambia in Notion")));
  });
  if (doc.kind === "database") el.setAttribute("contenteditable", "false");
  return el;
}

/** A picture from Notion's files, brought in by notion_page.rs (the island loads nothing from the web). */
function picture(url: string, cls: string): HTMLElement {
  const box = h("div", { class: `${cls} np-pic loading` });
  const show = (src: string) => {
    box.classList.remove("loading");
    box.append(h("img", { src, alt: "" }));
  };
  const known = np.images.get(url);
  if (known) show(known);
  else {
    Bridge.notionImage(url).then((src) => {
      if (np.images.size > 60) np.images.clear();
      np.images.set(url, src);
      show(src);
    }, () => {
      box.classList.remove("loading");
      box.classList.add("ext");
      box.append(h("button", { class: "link-btn", text: t("Apri immagine"), onclick: () => void Bridge.openUrl(url) }));
    });
  }
  return box;
}

// ── Text ──────────────────────────────────────────────────────────────────────

function spanNodes(spans: Span[]): Node[] {
  return spans.map((sp) => {
    let node: Node = document.createTextNode(sp.t);
    const wrap = (tag: string) => {
      const e = document.createElement(tag);
      e.append(node);
      node = e;
      return e;
    };
    if (sp.c) wrap("code");
    if (sp.b) wrap("b");
    if (sp.i) wrap("i");
    if (sp.u) wrap("u");
    if (sp.s) wrap("s");
    if (sp.color) {
      const e = wrap("span");
      e.dataset.color = sp.color;
      const bg = sp.color.endsWith("_background");
      const c = sp.color.replace("_background", "");
      e.style.cssText = bg ? `background:${BG_COLOR[c] ?? "transparent"};border-radius:3px` : `color:${TEXT_COLOR[c] ?? "inherit"}`;
    }
    if (sp.mention) wrap("span").className = "np-mention";
    if (sp.href) {
      const a = wrap("a");
      a.dataset.href = sp.href;
      a.title = t("Ctrl+clic per aprire");
    }
    return node;
  });
}

/** The spans of an edited block, read back from its elements. */
function spansOf(root: Node): Span[] {
  const out: Span[] = [];
  const push = (text: string, a: Omit<Span, "t">) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && JSON.stringify({ ...last, t: "" }) === JSON.stringify({ ...a, t: "" })) last.t += text;
    else out.push({ t: text, ...a });
  };
  const walk = (n: Node, a: Omit<Span, "t">) => {
    if (n.nodeType === Node.TEXT_NODE) { push(n.textContent ?? "", a); return; }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    if (tag === "BR") { push("\n", a); return; }
    const b: Omit<Span, "t"> = { ...a };
    if (tag === "B" || tag === "STRONG" || Number(n.style.fontWeight) >= 600 || n.style.fontWeight === "bold") b.b = true;
    if (tag === "I" || tag === "EM" || n.style.fontStyle === "italic") b.i = true;
    if (tag === "U") b.u = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") b.s = true;
    if (tag === "CODE") b.c = true;
    if (tag === "A" && n.dataset.href) b.href = n.dataset.href;
    if (n.dataset.color) b.color = n.dataset.color;
    if ((tag === "DIV" || tag === "P") && out.length) push("\n", a);
    n.childNodes.forEach((c) => walk(c, b));
  };
  root.childNodes.forEach((c) => walk(c, {}));
  const last = out[out.length - 1];
  if (last && last.t.endsWith("\n")) {
    last.t = last.t.slice(0, -1);
    if (!last.t) out.pop();
  }
  // Keys in a fixed order, so the same text compares equal.
  return out.map((sp) => {
    const o: Span = { t: sp.t };
    for (const k of ["b", "i", "s", "u", "c"] as const) if (sp[k]) o[k] = true;
    if (sp.href) o.href = sp.href;
    if (sp.color) o.color = sp.color;
    return o;
  });
}

const sameSpans = (a: Span[], b: Span[]) => JSON.stringify(spansOfList(a)) === JSON.stringify(spansOfList(b));
function spansOfList(list: Span[]): Span[] {
  const box = document.createElement("div");
  box.append(...spanNodes(list));
  return spansOf(box);
}

function caret(el: HTMLElement, end: boolean) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!end);
  sel.removeAllRanges();
  sel.addRange(r);
}

function atStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.setStart(el, 0);
  return r.toString().length === 0;
}

function plainPaste(e: Event) {
  const ev = e as ClipboardEvent;
  ev.preventDefault();
  const text = ev.clipboardData?.getData("text/plain") ?? "";
  document.execCommand("insertText", false, text);
}

// ── Blocks ────────────────────────────────────────────────────────────────────

function lastId(list: Block[]): string | null {
  return list.length ? list[list.length - 1].id : null;
}

/** The list a block is in, and where. */
function locate(id: string, list: Block[] | undefined = (np.doc as PageDoc | null)?.blocks): { list: Block[]; i: number } | null {
  if (!list) return null;
  const i = list.findIndex((b) => b.id === id);
  if (i >= 0) return { list, i };
  for (const b of list) {
    const found = locate(id, b.children);
    if (found) return found;
  }
  return null;
}

function blocksInto(box: HTMLElement, list: Block[], parent: string, depth: number) {
  let number = 0;
  for (const b of list) {
    number = b.type === "numbered_list_item" ? number + 1 : 0;
    box.append(blockEl(b, parent, depth, number));
  }
}

function blockEl(b: Block, parent: string, depth: number, number: number): HTMLElement {
  const wrap = h("div", { class: `np-block t-${b.type}`, "data-id": b.id });
  const editable = TEXT_KINDS.has(b.type);
  // The handle on the left, as in Notion: + adds below, ⋮⋮ for the rest.
  if (editable || b.type === "divider" || b.type === "image" || b.type === "bookmark" || b.type === "child_page" || b.type === "child_database") {
    wrap.append(h("div", { class: "np-handle" },
      h("button", { title: t("Aggiungi un blocco sotto"), onclick: (e: Event) => kindMenu(e.currentTarget as HTMLElement, (k) => void addBlock(parent, b.id, k, [])) }, svg(ICONS.plus, 11)),
      h("button", { title: t("Altro"), onclick: (e: Event) => blockMenu(e.currentTarget as HTMLElement, b, parent) }, h("span", { text: "⋮⋮" }))));
  }
  const body = h("div", { class: "np-body" });
  wrap.append(body);
  const text = () => textEl(b, parent);
  switch (b.type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "quote":
      if (b.toggle) body.append(toggleBtn(b));
      body.append(text());
      break;
    case "bulleted_list_item":
      body.append(h("span", { class: "np-marker", text: ["•", "◦", "▪"][depth % 3] }), text());
      break;
    case "numbered_list_item":
      body.append(h("span", { class: "np-marker num", text: depth % 3 === 1 ? `${String.fromCharCode(96 + Math.min(number, 26))}.` : `${number}.` }), text());
      break;
    case "to_do": {
      const box = h("button", {
        class: `np-check${b.checked ? " on" : ""}`, title: b.checked ? t("Segna da fare") : t("Segna fatto"),
        onclick: () => {
          b.checked = !b.checked;
          box.classList.toggle("on", !!b.checked);
          wrap.classList.toggle("done", !!b.checked);
          if (b.checked) Sound.play("approve");
          void saving(Bridge.notionBlockCheck(b.id, !!b.checked));
        },
      }, svg(ICONS.check, 10, { stroke: 3 }));
      if (b.checked) wrap.classList.add("done");
      body.append(box, text());
      break;
    }
    case "toggle":
      body.append(toggleBtn(b), text());
      break;
    case "callout":
      wrap.style.background = BG_COLOR[(b.color ?? "").replace("_background", "")] ?? BG_COLOR.default;
      body.append(h("span", { class: "np-callout-icon", text: b.emoji || "💡" }), text());
      break;
    case "code":
      body.append(h("div", { class: "np-code" }, h("span", { class: "np-lang", text: b.lang || "" }), text()));
      break;
    case "divider":
      body.append(h("hr"));
      break;
    case "image":
      if (b.url) body.append(picture(b.url, "np-image"));
      if (b.caption) body.append(h("div", { class: "np-caption", text: b.caption }));
      break;
    case "bookmark":
    case "embed":
    case "link_preview":
    case "video":
    case "file":
    case "pdf":
    case "audio":
      body.append(h("button", { class: "np-bookmark", title: b.url ?? "", onclick: () => { if (b.url) void Bridge.openUrl(b.url); } },
        h("span", { class: "np-bm-icon", text: b.type === "video" ? "▶" : b.type === "bookmark" || b.type === "embed" || b.type === "link_preview" ? "🔗" : "📎" }),
        h("span", { class: "np-bm-text" },
          h("b", { text: b.title || b.caption || hostOf(b.url ?? "") || t("Collegamento") }),
          h("small", { text: b.url ?? "" }))));
      break;
    case "child_page":
    case "child_database":
      body.append(h("button", { class: "np-subpage", onclick: () => go({ id: b.id, title: b.title ?? "", url: "", database: b.type === "child_database" }) },
        svg(b.type === "child_database" ? ICONS.stack : ICONS.doc, 13), h("span", { text: b.title || t("Senza titolo") })));
      break;
    case "link_to_page":
      body.append(h("button", { class: "np-subpage", onclick: () => { if (b.target) go({ id: b.target, title: t("Pagina collegata"), url: "", database: !!b.database }); } },
        h("span", { text: "↗" }), h("span", { text: t("Pagina collegata") })));
      break;
    case "equation":
      body.append(h("code", { class: "np-equation", text: (b.spans ?? []).map((s) => s.t).join("") }));
      break;
    case "table":
      body.append(tableEl(b));
      break;
    case "column_list": {
      const cols = h("div", { class: "np-columns" });
      for (const c of b.children ?? []) {
        const col = h("div", { class: "np-column" });
        blocksInto(col, c.children ?? [], c.id, depth);
        cols.append(col);
      }
      body.append(cols);
      return wrap;
    }
    case "synced_block":
    case "column":
      break;
    default:
      body.append(h("button", { class: "np-unsupported", onclick: () => openHere() },
        h("span", { text: t("Blocco «{k}»: si vede in Notion", { k: b.type.replace(/_/g, " ") }) })));
  }
  // What is nested: under lists and to-dos always, under a toggle when open.
  const kids = b.children ?? [];
  const folded = (b.type === "toggle" || b.toggle) && !np.open.has(b.id);
  if (kids.length && !folded && b.type !== "table") {
    const box = h("div", { class: "np-children" });
    blocksInto(box, kids, b.id, depth + 1);
    wrap.append(box);
  } else if (!kids.length && b.hasChildren && !folded && b.type !== "child_page" && b.type !== "child_database" && b.type !== "table") {
    wrap.append(h("button", { class: "np-more", text: t("Altro contenuto: aprilo in Notion"), onclick: () => openHere() }));
  } else if ((b.type === "toggle" || b.toggle) && !folded && !kids.length) {
    wrap.append(h("div", { class: "np-children" }, h("button", { class: "np-empty-toggle", text: t("Toggle vuoto. Fai clic per aggiungere un blocco."),
      onclick: () => void addBlock(b.id, null, "paragraph", []) })));
  }
  return wrap;
}

function openHere() {
  const url = np.doc?.url || np.stack[np.stack.length - 1]?.url;
  if (url) void Bridge.openUrl(url);
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

function toggleBtn(b: Block): HTMLElement {
  const open = np.open.has(b.id);
  return h("button", { class: `np-toggle${open ? " open" : ""}`, title: open ? t("Chiudi") : t("Apri"),
    onclick: () => { if (open) np.open.delete(b.id); else np.open.add(b.id); draw(); } }, svg(ICONS.chevronRight, 11, { stroke: 2.6 }));
}

function tableEl(b: Block): HTMLElement {
  const table = h("table", { class: "np-table" });
  (b.children ?? []).forEach((r, i) => {
    const tr = h("tr", { class: i === 0 && b.header ? "head" : "" });
    for (const c of r.cells ?? []) tr.append(h("td", {}, ...spanNodes(c)));
    table.append(tr);
  });
  return h("div", { class: "np-table-wrap" }, table);
}

/** A block's text, edited in place: saved when leaving it, Invio for a new block. */
function textEl(b: Block, parent: string): HTMLElement {
  const spans = b.spans ?? [];
  // Mentions and equations would become plain text: those blocks stay as they are.
  const locked = spans.some((s) => s.mention);
  const el = h("div", {
    class: "np-text", contenteditable: locked ? "false" : "true", spellcheck: "true", "data-edit": b.id,
    "data-placeholder": b.type === "paragraph" ? t("Scrivi, oppure «/» per i tipi di blocco") : KINDS.find((k) => k[0] === b.type)?.[2] ?? "",
    title: locked ? t("Contiene menzioni: si modifica in Notion") : "",
  }, ...spanNodes(spans));
  if (locked) return el;
  const commit = async (): Promise<void> => {
    const now = spansOf(el);
    if (sameSpans(now, b.spans ?? [])) return;
    b.spans = now;
    await saving(Bridge.notionBlockText(b.id, b.type, now));
  };
  el.addEventListener("paste", plainPaste);
  el.addEventListener("blur", () => void commit());
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a && (e as MouseEvent).ctrlKey && a.dataset.href) void Bridge.openUrl(a.dataset.href);
  });
  el.addEventListener("input", () => {
    // "/" in an empty block, however it was typed: the block types.
    if ((el.textContent ?? "") === "/") {
      el.textContent = "";
      kindMenu(el, (k) => void retype(b, parent, k, []));
      return;
    }
    // Notion's shortcuts at the start of a paragraph: "# ", "- ", "[] "…
    if (b.type !== "paragraph") return;
    const txt = el.textContent ?? "";
    const m = /^(#{1,3}|[-*]|1\.|\[\]|>|```)\s/.exec(txt.replace(/ /g, " "));
    if (!m) return;
    const kind = ({ "#": "heading_1", "##": "heading_2", "###": "heading_3", "-": "bulleted_list_item", "*": "bulleted_list_item",
      "1.": "numbered_list_item", "[]": "to_do", ">": "quote", "```": "code" } as Record<string, string>)[m[1]];
    const rest = spansOf(el);
    if (rest[0]) rest[0].t = rest[0].t.slice(m[0].length);
    void retype(b, parent, kind, rest.filter((s) => s.t));
  });
  el.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Escape") { e.stopPropagation(); el.blur(); return; }
    if (e.key === "Enter" && (e.shiftKey || b.type === "code")) {
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const empty = !(el.textContent ?? "").trim();
      // Invio on an empty list item ends the list, as in Notion.
      if (empty && b.type !== "paragraph" && /list_item|to_do/.test(b.type)) {
        void retype(b, parent, "paragraph", []);
        return;
      }
      const sel = window.getSelection();
      let after: Span[] = [];
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const tail = document.createRange();
        tail.setStart(r.endContainer, r.endOffset);
        tail.setEnd(el, el.childNodes.length);
        const box = document.createElement("div");
        box.append(tail.extractContents());
        after = spansOf(box);
      }
      const kind = /list_item|to_do/.test(b.type) ? b.type : "paragraph";
      void commit().then(() => addBlock(parent, b.id, kind, after, true));
      return;
    }
    if (e.key === "Backspace" && !(el.textContent ?? "").length && !(b.children ?? []).length) {
      e.preventDefault();
      void removeBlock(b, true);
      return;
    }
    if (e.key === "Backspace" && b.type !== "paragraph" && atStart(el) && !(b.children ?? []).length) {
      // At the start of a heading or a list item: back to text.
      e.preventDefault();
      void retype(b, parent, "paragraph", spansOf(el));
      return;
    }
    if (e.key === "/" && !(el.textContent ?? "").length) {
      e.preventDefault();
      kindMenu(el, (k) => void retype(b, parent, k, []));
      return;
    }
    if ((e.key === "ArrowUp" && atStart(el)) || (e.key === "ArrowDown" && atEndOf(el))) {
      const all = [...(np.el?.querySelectorAll<HTMLElement>(".np-text[contenteditable=true]") ?? [])];
      const i = all.indexOf(el);
      const next = all[e.key === "ArrowUp" ? i - 1 : i + 1];
      if (next) { e.preventDefault(); caret(next, e.key === "ArrowUp"); }
    }
    if (e.ctrlKey && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      wrapSelection(el, "code");
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      document.execCommand("strikeThrough");
    }
  });
  return el;
}

function atEndOf(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.setEnd(el, el.childNodes.length);
  return r.toString().length === 0;
}

function wrapSelection(el: HTMLElement, tag: string) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.commonAncestorContainer)) return;
  const w = document.createElement(tag);
  w.append(r.extractContents());
  r.insertNode(w);
}

async function addBlock(parent: string, after: string | null, kind: string, spans: Span[], focusStart = false) {
  const doc = np.doc;
  if (!doc || doc.kind !== "page") return;
  let created: Block | null = null;
  const ok = await saving(Bridge.notionBlockAdd(parent, after, kind, spans).then((b) => { created = b as Block; }));
  if (!ok || !created) return;
  const nb: Block = created;
  const where = after ? locate(after) : null;
  if (where) where.list.splice(where.i + 1, 0, nb);
  else if (norm(parent) === norm(doc.id)) doc.blocks.push(nb);
  else {
    const p = locate(parent);
    if (p) {
      const pb = p.list[p.i];
      pb.children = [...(pb.children ?? []), nb];
      pb.hasChildren = true;
      np.open.add(pb.id);
    }
  }
  np.focus = { id: nb.id, end: !focusStart };
  draw();
}

async function retype(b: Block, parent: string, kind: string, spans: Span[]) {
  if ((b.children ?? []).length || b.hasChildren) {
    np.status = "error";
    np.statusMsg = t("Un blocco con altri blocchi dentro si trasforma in Notion");
    drawStatus();
    return;
  }
  let created: Block | null = null;
  const ok = await saving(Bridge.notionBlockRetype(parent, b.id, kind, spans).then((x) => { created = x as Block; }));
  if (!ok || !created) return;
  const where = locate(b.id);
  if (where) where.list.splice(where.i, 1, created);
  np.focus = { id: (created as Block).id, end: true };
  draw();
}

async function removeBlock(b: Block, focusPrev: boolean) {
  const where = locate(b.id);
  const prev = where && where.i > 0 ? where.list[where.i - 1] : null;
  const ok = await saving(Bridge.notionBlockDelete(b.id));
  if (!ok) return;
  const again = locate(b.id);
  if (again) again.list.splice(again.i, 1);
  if (focusPrev && prev) np.focus = { id: prev.id, end: true };
  draw();
}

// ── Menus ─────────────────────────────────────────────────────────────────────

interface MenuItem { label: string; hint?: string; color?: string; on: () => void; danger?: boolean; confirm?: string; checked?: boolean }

function closeMenu() {
  np.menu?.remove();
  np.menu = null;
}

function popup(anchor: HTMLElement, items: MenuItem[], title?: string) {
  closeMenu();
  const host = np.el;
  if (!host) return;
  const menu = h("div", { class: "np-menu", onpointerdown: (e: Event) => e.stopPropagation() });
  if (title) menu.append(h("div", { class: "np-menu-title", text: title }));
  for (const it of items) {
    const b = h("button", { class: `np-menu-item${it.danger ? " danger" : ""}` },
      it.hint != null ? h("span", { class: "np-menu-hint", text: it.hint }) : null,
      it.color != null ? h("span", { class: "np-tag", style: tagStyle(it.color), text: it.label }) : h("span", { text: it.label }),
      it.checked ? h("span", { class: "np-menu-on" }, svg(ICONS.check, 10, { stroke: 3 })) : null);
    let armed = false;
    b.addEventListener("click", () => {
      if (it.confirm && !armed) {
        armed = true;
        b.classList.add("armed");
        (b.lastElementChild as HTMLElement | null)?.replaceWith(h("span", { text: it.confirm }));
        return;
      }
      closeMenu();
      it.on();
    });
    menu.append(b);
  }
  host.append(menu);
  np.menu = menu;
  const hr = host.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth;
  let top = ar.bottom - hr.top + 4;
  if (top + mh > hr.height - 4) top = Math.max(4, ar.top - hr.top - mh - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(4, Math.min(ar.left - hr.left, hr.width - mw - 4))}px`;
  const away = (e: Event) => {
    if (!menu.isConnected) { document.removeEventListener("pointerdown", away, true); return; }
    if (!menu.contains(e.target as Node)) { closeMenu(); document.removeEventListener("pointerdown", away, true); }
  };
  window.setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } });
}

function kindMenu(anchor: HTMLElement, pick: (kind: string) => void) {
  popup(anchor, KINDS.map(([k, hint, label]) => ({ label, hint, on: () => pick(k) })), t("Blocchi"));
}

function blockMenu(anchor: HTMLElement, b: Block, parent: string) {
  // Elimina first, as in Notion; a second click confirms.
  const items: MenuItem[] = [{ label: t("Elimina"), hint: "🗑", danger: true, confirm: t("Sicuro? Va nel cestino di Notion"), on: () => void removeBlock(b, false) }];
  const nested = (b.children ?? []).length > 0 || !!b.hasChildren;
  if (TEXT_KINDS.has(b.type) && !nested) {
    for (const [k, hint, label] of KINDS) {
      if (k === b.type || k === "divider") continue;
      items.push({ label: t("In {k}", { k: label.toLowerCase() }), hint, on: () => void retype(b, parent, k, b.spans ?? []) });
    }
  }
  if (b.type === "child_page" || b.type === "child_database") {
    items.push({ label: t("Apri qui"), hint: "→", on: () => go({ id: b.id, title: b.title ?? "", url: "", database: b.type === "child_database" }) });
  }
  popup(anchor, items);
}

function tagStyle(color: string): string {
  const c = color || "default";
  return `background:${BG_COLOR[c] ?? BG_COLOR.default};color:${TAG_TEXT[c] ?? TAG_TEXT.default}`;
}

// ── Properties of a row ───────────────────────────────────────────────────────

const EDITABLE = new Set(["title", "rich_text", "number", "select", "status", "multi_select", "checkbox", "date", "url", "email", "phone_number"]);

function propsEl(doc: PageDoc): HTMLElement {
  const cols = doc.database ? np.columns.get(norm(doc.database)) ?? [] : [];
  const grid = h("div", { class: "np-props" });
  for (const p of doc.props) {
    const col = cols.find((c) => c.name === p.name) ?? { name: p.name, kind: p.cell.kind, options: [] };
    grid.append(h("span", { class: "np-prop-name", text: p.name }),
      cellEl(doc.id, col, p.cell, (row) => {
        const c = row.cells[p.name];
        if (c) p.cell = c;
        draw();
      }));
  }
  return grid;
}

// ── Databases ─────────────────────────────────────────────────────────────────

function viewOf(doc: DbDoc): DbView {
  try {
    const v = localStorage.getItem(`np-view:${norm(doc.id)}`);
    if (v === "table" || v === "board" || v === "list" || v === "gallery") return v;
  } catch { /* no storage: the default */ }
  return groupCol(doc) ? "board" : "table";
}

function setView(doc: DbDoc, v: DbView) {
  try { localStorage.setItem(`np-view:${norm(doc.id)}`, v); } catch { /* kept until the next draw only */ }
  draw();
}

/** The column a board groups by: the status, else the first select. */
function groupCol(doc: DbDoc): Column | null {
  return doc.columns.find((c) => c.kind === "status") ?? doc.columns.find((c) => c.kind === "select") ?? null;
}

const titleCol = (doc: DbDoc) => doc.columns.find((c) => c.kind === "title") ?? doc.columns[0];

function databaseEl(doc: DbDoc): HTMLElement {
  const view = viewOf(doc);
  const tabs: [DbView, string, string][] = [["table", "▦", t("Tabella")], ["board", "▥", t("Bacheca")], ["list", "☰", t("Elenco")], ["gallery", "▣", t("Galleria")]];
  const bar = h("div", { class: "np-views" }, ...tabs.filter(([v]) => v !== "board" || groupCol(doc)).map(([v, icon, label]) =>
    h("button", { class: `np-view${v === view ? " on" : ""}`, onclick: () => setView(doc, v) }, h("span", { class: "np-view-i", text: icon }), h("span", { text: label }))),
  h("span", { class: "np-count", text: t("{n} elementi", { n: doc.rows.length }) }));
  const box = h("div", { class: "np-db" }, bar);
  if (view === "board") box.append(boardEl(doc));
  else if (view === "list") box.append(listEl(doc));
  else if (view === "gallery") box.append(galleryEl(doc));
  else box.append(dbTableEl(doc));
  return box;
}

function openRow(r: Row, doc: DbDoc) {
  const title = r.cells[titleCol(doc)?.name ?? ""]?.text ?? "";
  go({ id: r.id, title, emoji: r.icon?.emoji ?? null, url: r.url });
}

function replaceRow(doc: DbDoc, row: Row) {
  const i = doc.rows.findIndex((r) => r.id === row.id);
  if (i >= 0) doc.rows[i] = row;
}

function rowTitle(doc: DbDoc, r: Row): string {
  return r.cells[titleCol(doc)?.name ?? ""]?.text || t("Senza titolo");
}

function rowDelete(doc: DbDoc, r: Row): MenuItem {
  return { label: t("Elimina"), hint: "🗑", danger: true, confirm: t("Sicuro? Va nel cestino di Notion"),
    on: () => void saving(Bridge.notionPageDelete(r.id)).then((ok) => { if (ok) { doc.rows = doc.rows.filter((x) => x.id !== r.id); draw(); } }) };
}

/** A small row of tags for a card: options, dates, boxes. */
function pills(doc: DbDoc, r: Row, skip: string[]): HTMLElement {
  const box = h("div", { class: "np-pills" });
  for (const c of doc.columns) {
    if (skip.includes(c.name) || c.kind === "title") continue;
    const v = r.cells[c.name];
    if (!v) continue;
    if ((c.kind === "select" || c.kind === "status") && v.text) box.append(h("span", { class: "np-tag", style: tagStyle(v.color ?? ""), text: v.text }));
    else if (c.kind === "multi_select") for (const [n, col] of v.items ?? []) box.append(h("span", { class: "np-tag", style: tagStyle(col), text: n }));
    else if (c.kind === "date" && v.date) box.append(h("span", { class: "np-pill-date", text: `📅 ${dayLabel(v.date)}` }));
    else if (c.kind === "checkbox" && v.checked) box.append(h("span", { class: "np-pill-date", text: `☑ ${c.name}` }));
    if (box.childElementCount >= 4) break;
  }
  return box;
}

function dayLabel(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short" }) + (iso.length > 10 ? ` ${d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}` : "");
}

function newRowInput(doc: DbDoc, preset?: { col: Column; value: string }): HTMLElement {
  const input = h("input", { class: "np-new-input", placeholder: t("Nuovo: scrivi il titolo e premi Invio"), spellcheck: "true" }) as HTMLInputElement;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); draw(); }
    if (e.key !== "Enter") return;
    const title = input.value.trim();
    if (!title) return;
    input.disabled = true;
    let row: Row | null = null;
    const p = preset && preset.value
      ? Bridge.notionRowAdd(doc.id, title, preset.col.name, preset.col.kind, preset.value)
      : Bridge.notionRowAdd(doc.id, title);
    void saving(p.then((x) => { row = x as Row; })).then((ok) => {
      if (ok && row) { doc.rows.push(row); Sound.play("blip"); }
      draw();
    });
  });
  window.setTimeout(() => input.focus(), 0);
  return input;
}

function addRowButton(doc: DbDoc, cls: string, preset?: { col: Column; value: string }): HTMLElement {
  const b = h("button", { class: cls }, svg(ICONS.plus, 11), h("span", { text: t("Nuovo") }));
  b.addEventListener("click", () => b.replaceWith(newRowInput(doc, preset)));
  return b;
}

function dbTableEl(doc: DbDoc): HTMLElement {
  const cols = doc.columns.slice(0, 8);
  const table = h("table", { class: "np-grid" });
  table.append(h("tr", {}, ...cols.map((c) => h("th", {}, h("span", { class: "np-kind", text: KIND_ICON[c.kind] ?? "≡" }), h("span", { text: c.name }))), h("th", { class: "np-row-tools" })));
  for (const r of doc.rows) {
    const tr = h("tr", {});
    for (const c of cols) {
      const value = cellEl(r.id, c, r.cells[c.name], (row) => { replaceRow(doc, row); draw(); });
      tr.append(h("td", { class: `k-${c.kind}` }, c.kind === "title"
        ? h("div", { class: "np-title-cell" },
          r.icon?.emoji ? h("span", { class: "np-row-emoji", text: r.icon.emoji }) : null,
          value,
          h("button", { class: "np-open-row", title: t("Apri"), onclick: () => openRow(r, doc) }, h("span", { text: t("APRI") })))
        : value));
    }
    tr.append(h("td", { class: "np-row-tools" }, h("button", { title: t("Altro"), onclick: (e: Event) => popup(e.currentTarget as HTMLElement, [
      { label: t("Apri qui"), hint: "→", on: () => openRow(r, doc) },
      { label: t("Apri in Notion"), hint: "↗", on: () => void Bridge.openUrl(r.url) },
      rowDelete(doc, r),
    ]) }, h("span", { text: "⋯" }))));
    table.append(tr);
  }
  return h("div", { class: "np-grid-wrap" }, table, addRowButton(doc, "np-add-row"));
}

const KIND_ICON: Record<string, string> = {
  title: "Aa", rich_text: "≡", number: "#", select: "◉", multi_select: "☰", status: "◌", date: "📅", checkbox: "☑",
  people: "👤", url: "🔗", email: "@", phone_number: "☏", relation: "↗", formula: "Σ", rollup: "🔍", created_time: "🕒",
  last_edited_time: "🕒", files: "📎", unique_id: "№",
};

function boardEl(doc: DbDoc): HTMLElement {
  const g = groupCol(doc)!;
  const groups: [string, string][] = [...g.options, ["", "default"]];
  const board = h("div", { class: "np-board" });
  for (const [name, color] of groups) {
    const rows = doc.rows.filter((r) => (r.cells[g.name]?.text ?? "") === name);
    if (!name && !rows.length) continue;
    const col = h("div", { class: "np-lane", style: `--lane:${BG_COLOR[color] ?? BG_COLOR.default}` },
      h("div", { class: "np-lane-head" },
        h("span", { class: "np-tag", style: tagStyle(color), text: name || t("Senza {p}", { p: g.name }) }),
        h("span", { class: "np-lane-n", text: String(rows.length) })));
    for (const r of rows) {
      const card = h("div", { class: "np-bcard", "data-row": r.id, onclick: () => openRow(r, doc) },
        r.cover ? picture(r.cover, "np-bcover") : null,
        h("div", { class: "np-bcard-t" }, r.icon?.emoji ? h("span", { text: r.icon.emoji }) : null, h("b", { text: rowTitle(doc, r) })),
        pills(doc, r, [g.name]),
        h("button", { class: "np-bcard-more", title: t("Altro"), onclick: (e: Event) => { e.stopPropagation(); popup(e.currentTarget as HTMLElement, [
          ...groups.filter(([n]) => n && n !== name).map(([n, c]) => ({ label: n, color: c, on: () => void moveRow(doc, r, g, n) })),
          rowDelete(doc, r),
        ], t("Sposta in")); } }, h("span", { text: "⋯" })));
      col.append(card);
    }
    col.append(addRowButton(doc, "np-lane-add", { col: g, value: name }));
    col.dataset.lane = name;
    board.append(col);
  }
  dragCards(board, (rowId, lane) => {
    const r = doc.rows.find((x) => x.id === rowId);
    if (r && (r.cells[g.name]?.text ?? "") !== lane) void moveRow(doc, r, g, lane);
  });
  return board;
}

/**
 * A card dragged to another column of the board, with the pointer (the
 * window's HTML drag and drop is the file drop's, drop.rs): it follows the
 * pointer, the column under it lights up, and on release it moves there.
 */
function dragCards(board: HTMLElement, drop: (rowId: string, lane: string) => void) {
  let drag: { card: HTMLElement; id: string; x: number; y: number; started: boolean; lane: HTMLElement | null } | null = null;
  const laneAt = (x: number, y: number) => [...board.querySelectorAll<HTMLElement>(".np-lane")].find((l) => {
    const r = l.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }) ?? null;
  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".np-bcard");
    if (!card?.dataset.row) return;
    drag = { card, id: card.dataset.row, x: e.clientX, y: e.clientY, started: false, lane: null };
  });
  board.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.started = true;
      board.setPointerCapture(e.pointerId);
      drag.card.classList.add("dragging");
    }
    drag.card.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px) rotate(2deg)`;
    const lane = laneAt(e.clientX, e.clientY);
    if (lane !== drag.lane) {
      drag.lane?.classList.remove("over");
      lane?.classList.add("over");
      drag.lane = lane;
    }
  });
  const finish = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d?.started) return;
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    d.card.classList.remove("dragging");
    d.card.style.transform = "";
    d.lane?.classList.remove("over");
    // The release is not a click on the card.
    const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    board.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => board.removeEventListener("click", swallow, { capture: true }), 0);
    if (d.lane && e.type === "pointerup") drop(d.id, d.lane.dataset.lane ?? "");
  };
  board.addEventListener("pointerup", finish);
  board.addEventListener("pointercancel", finish);
}

async function moveRow(doc: DbDoc, r: Row, g: Column, value: string) {
  // At once on screen, then Notion.
  const cell = r.cells[g.name] ?? { kind: g.kind, text: "" };
  cell.text = value;
  cell.color = g.options.find(([n]) => n === value)?.[1] ?? "default";
  r.cells[g.name] = cell;
  draw();
  let row: Row | null = null;
  const ok = await saving(Bridge.notionRowSet(r.id, g.name, g.kind, value).then((x) => { row = x as Row; }));
  if (ok && row) { replaceRow(doc, row); Sound.play("blip"); }
  if (!ok) void load();
  else draw();
}

function listEl(doc: DbDoc): HTMLElement {
  const box = h("div", { class: "np-list" });
  const check = doc.columns.find((c) => c.kind === "checkbox");
  for (const r of doc.rows) {
    const done = check ? !!r.cells[check.name]?.checked : false;
    box.append(h("div", { class: `np-list-row${done ? " done" : ""}`, role: "button", onclick: () => openRow(r, doc) },
      check ? cellEl(r.id, check, r.cells[check.name], (row) => { replaceRow(doc, row); draw(); }) : null,
      r.icon?.emoji ? h("span", { class: "np-row-emoji", text: r.icon.emoji }) : svg(ICONS.doc, 12),
      h("span", { class: "np-list-t", text: rowTitle(doc, r) }),
      pills(doc, r, check ? [check.name] : [])));
  }
  box.append(addRowButton(doc, "np-add-row"));
  return box;
}

function galleryEl(doc: DbDoc): HTMLElement {
  const box = h("div", { class: "np-gallery" });
  for (const r of doc.rows) {
    const cover = r.cover
      ? picture(r.cover, "np-gcover")
      : h("div", { class: "np-gcover blank", style: `background:${BG_COLOR[Object.values(r.cells).find((c) => c.color)?.color ?? "default"] ?? BG_COLOR.default}` },
        h("span", { text: r.icon?.emoji || rowTitle(doc, r).slice(0, 1).toUpperCase() }));
    box.append(h("div", { class: "np-gcard", role: "button", onclick: () => openRow(r, doc) }, cover,
      h("div", { class: "np-gcard-t" }, r.icon?.emoji && r.cover ? h("span", { text: r.icon.emoji }) : null, h("b", { text: rowTitle(doc, r) })),
      pills(doc, r, [])));
  }
  box.append(addRowButton(doc, "np-gcard np-gadd"));
  return box;
}

/** One property's value, edited where it is: box, option, day, text. */
function cellEl(rowId: string, col: Column, cell: Cell | undefined, done: (row: Row) => void): HTMLElement {
  const v: Cell = cell ?? { kind: col.kind, text: "" };
  const set = (value: unknown) => {
    let row: Row | null = null;
    void saving(Bridge.notionRowSet(rowId, col.name, col.kind, value).then((x) => { row = x as Row; })).then((ok) => { if (ok && row) done(row); });
  };
  if (!EDITABLE.has(col.kind)) return h("span", { class: "np-cell ro", text: v.text, title: v.text });
  switch (col.kind) {
    case "checkbox": {
      const b = h("button", { class: `np-check${v.checked ? " on" : ""}`, onclick: (e: Event) => {
        e.stopPropagation();
        v.checked = !v.checked;
        b.classList.toggle("on", !!v.checked);
        if (v.checked) Sound.play("approve");
        set(!!v.checked);
      } }, svg(ICONS.check, 10, { stroke: 3 }));
      return b;
    }
    case "select":
    case "status": {
      const b = h("button", { class: "np-cell pick", onclick: (e: Event) => {
        e.stopPropagation();
        const opts = col.options.length ? col.options : v.text ? [[v.text, v.color ?? "default"] as [string, string]] : [];
        popup(b, [
          ...opts.map(([n, c]) => ({ label: n, color: c, checked: n === v.text, on: () => set(n) })),
          ...(col.kind === "select" && v.text ? [{ label: t("Nessuno"), hint: "×", on: () => set("") }] : []),
        ], col.name);
      } }, v.text ? h("span", { class: "np-tag", style: tagStyle(v.color ?? ""), text: v.text }) : h("span", { class: "np-empty", text: "—" }));
      return b;
    }
    case "multi_select": {
      const chosen = new Set((v.items ?? []).map(([n]) => n));
      const b = h("button", { class: "np-cell pick", onclick: (e: Event) => {
        e.stopPropagation();
        popup(b, col.options.map(([n, c]) => ({ label: n, color: c, checked: chosen.has(n), on: () => {
          if (chosen.has(n)) chosen.delete(n); else chosen.add(n);
          set([...chosen]);
        } })), col.name);
      } }, ...(v.items?.length ? v.items.map(([n, c]) => h("span", { class: "np-tag", style: tagStyle(c), text: n })) : [h("span", { class: "np-empty", text: "—" })]));
      return b;
    }
    case "date": {
      const b = h("button", { class: "np-cell pick", text: v.date ? dayLabel(v.date) : "—", onclick: (e: Event) => {
        e.stopPropagation();
        const input = h("input", { type: "date", class: "np-date", value: (v.date ?? "").slice(0, 10) }) as HTMLInputElement;
        input.addEventListener("change", () => set(input.value));
        input.addEventListener("blur", () => { if (input.isConnected) input.replaceWith(b); });
        input.addEventListener("keydown", (k) => { if (k.key === "Escape") { k.stopPropagation(); input.replaceWith(b); } });
        b.replaceWith(input);
        input.focus();
        try { input.showPicker(); } catch { /* typed by hand */ }
      } });
      return b;
    }
    default: {
      const el = h("span", { class: `np-cell edit${col.kind === "title" ? " title" : ""}`, contenteditable: "true", spellcheck: "true", text: v.text,
        "data-placeholder": col.kind === "title" ? t("Senza titolo") : "",
        onclick: (e: Event) => e.stopPropagation() });
      el.addEventListener("paste", plainPaste);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); el.blur(); }
        if (e.key === "Escape") { e.stopPropagation(); el.textContent = v.text; el.blur(); }
      });
      el.addEventListener("blur", () => {
        const now = (el.textContent ?? "").trim();
        if (now === v.text.trim()) return;
        v.text = now;
        set(now);
      });
      return el;
    }
  }
}
