// «File e schermo» → Cartella di lavoro (workdir.rs, docs/strumenti.md): one
// folder of the user's PC, browsed under the Vassoio. A double click opens a
// folder (or a file with its app); every entry can be asked about, opened,
// shown in Explorer, renamed, moved to another folder of it, copied into the
// Vassoio, dragged out, its path copied, or sent to the Recycle Bin. The
// Vassoio moves its files into the folder shown here (`current`).

import { h, clear, tip, svg } from "./dom";
import { ICONS } from "./icons";
import { showMenu, type MenuItem } from "./ctxmenu";
import { renderActionIcon } from "./action-icons";
import { Bridge, type WorkEntry, type WorkListing } from "../core/bridge";
import { State } from "../core/state";
import type { ViewActions } from "./views";
import { t } from "../core/i18n";
import { size } from "./upload";
import { fileBadge } from "./filekind";

/** A folder read more than this long ago is read again when the view draws. */
const STALE_MS = 5000;

/** The orders a click on the sort button goes through; folders always come first, as in Explorer. */
const SORTS = ["name", "name-desc", "new", "old"] as const;
type Sort = (typeof SORTS)[number];

function sorted(entries: WorkEntry[], sort: Sort): WorkEntry[] {
  const byName = (a: WorkEntry, b: WorkEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    switch (sort) {
      case "name-desc": return byName(b, a);
      case "new": return b.at - a.at || byName(a, b);
      case "old": return a.at - b.at || byName(a, b);
      default: return byName(a, b);
    }
  });
}

export interface WorkPanel {
  el: HTMLElement;
  sync(): void;
  /** The folder shown (relative), where the Vassoio moves files; null without a work folder. */
  current(): string | null;
  /** Read the folder again (after a change made elsewhere). */
  reload(): void;
}

export function buildWorkPanel(actions: ViewActions): WorkPanel {
  let rel = "";
  try { rel = localStorage.getItem("workFolderRel") ?? ""; } catch { /* no storage */ }
  let listing: WorkListing | null = null;
  let error = "";
  let loadedAt = 0;
  let loading = false;
  /** The entry being renamed, the one being moved, the one waiting for «Nel Cestino». */
  let renaming = "";
  let moving: WorkEntry | null = null;
  let trashing: WorkEntry | null = null;
  let newFolder = false;
  let note = "";
  let drawn = "";
  // List or grid, and the order: remembered like the Vassoio's layout.
  let grid = false;
  let sort: Sort = "name";
  try {
    grid = localStorage.getItem("workLayout") === "grid";
    const s = localStorage.getItem("workSort") as Sort | null;
    if (s && SORTS.includes(s)) sort = s;
  } catch { /* no storage */ }

  const crumbs = h("div", { class: "work-crumbs" });
  const list = h("div", { class: "files-list work-list" });
  const banner = h("div", { class: "work-banner" });
  const status = h("div", { class: "files-note" });
  const pick = h("button", { class: "files-clear work-pick", text: t("Scegli…"), title: t("La cartella in cui la chat e Telegram possono lavorare") }) as HTMLButtonElement;
  const headBtn = (title: string, icon: Node) =>
    h("button", { class: "files-layout", title, "aria-label": title }, icon) as HTMLButtonElement;
  const mkdirBtn = headBtn(t("Nuova cartella"), svg(ICONS.plus, 13));
  const revealBtn = headBtn(t("Apri in Esplora file"), renderActionIcon("i:folder", 13));
  const layoutBtn = headBtn(t("Mostra come griglia"), svg(ICONS.tiles, 12));
  const sortBtn = h("button", { class: "files-layout work-sort", title: t("Ordine: clic per cambiarlo (nome, data di modifica)") }) as HTMLButtonElement;
  const sortLabel: Record<Sort, string> = { name: t("Nome A→Z"), "name-desc": t("Nome Z→A"), new: t("Più recenti"), old: t("Meno recenti") };
  // The name on the left, the tools together on the right.
  const head = h("div", { class: "files-head" }, h("b", { text: t("Cartella di lavoro") }), h("span", { class: "files-head-gap" }), sortBtn, layoutBtn, mkdirBtn, revealBtn, pick);
  const el = h("div", { class: "work-panel" }, head, crumbs, banner, list, status);

  const fail = (e: unknown) => { note = String(e).replace(/^Error:\s*/, ""); drawn = ""; State.notify(); };
  const remember = () => { try { localStorage.setItem("workFolderRel", rel); } catch { /* no storage */ } };

  async function load(to = rel) {
    loading = true;
    try {
      listing = await Bridge.workList(to);
      rel = listing.rel;
      error = "";
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "");
      // The subfolder is gone: back to the top.
      if (to) { rel = ""; loading = false; return load(""); }
      listing = null;
      error = msg;
    }
    remember();
    loadedAt = Date.now();
    loading = false;
    drawn = "";
    State.notify();
  }
  const go = (to: string) => { renaming = ""; trashing = null; newFolder = false; note = ""; void load(to); };
  const full = (e: WorkEntry) => listing ? `${listing.root}\\${e.rel.replace(/\//g, "\\")}` : e.rel;

  pick.addEventListener("click", () => {
    void Bridge.workPick().then((p) => { if (p) { rel = ""; void load(""); } }).catch(fail);
  });
  mkdirBtn.addEventListener("click", () => { newFolder = !newFolder; drawn = ""; State.notify(); });
  revealBtn.addEventListener("click", () => void Bridge.workOpen(rel, false).catch(fail));
  layoutBtn.addEventListener("click", () => {
    grid = !grid;
    try { localStorage.setItem("workLayout", grid ? "grid" : "list"); } catch { /* no storage */ }
    drawn = "";
    State.notify();
  });
  sortBtn.addEventListener("click", () => {
    sort = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
    try { localStorage.setItem("workSort", sort); } catch { /* no storage */ }
    drawn = "";
    State.notify();
  });

  // The same row tools as the Vassoio: two in sight, the rest in the island's menu.
  const iconBtn = (icon: string, title: string, fn: () => void) =>
    h("button", { class: "files-act", title, "aria-label": title,
      onclick: (e: Event) => { e.stopPropagation(); fn(); } }, renderActionIcon(`i:${icon}`, 14));
  const moreBtn = (name: string, items: () => MenuItem[]) => {
    const b = h("button", { class: "files-act", title: t("Altre azioni"), "aria-label": t("Altre azioni per «{name}»", { name }),
      "aria-haspopup": "menu" }, svg(ICONS.ellipsis, 14));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = b.getBoundingClientRect();
      const host = (b.closest("#island") as HTMLElement | null) ?? document.body;
      showMenu(host, r.left, r.bottom + 2, "", items());
    });
    return b;
  };
  const redraw = () => { drawn = ""; State.notify(); };
  const textBtn = (label: string, fn: () => void, cls = "btn secondary") =>
    h("button", { class: cls, onclick: (e: Event) => { e.stopPropagation(); fn(); } }, h("span", { text: label }));

  /** An input for a name: Invio confirms, Esc gives up. */
  function nameInput(value: string, done: (v: string) => void, cancel: () => void): HTMLInputElement {
    const input = h("input", { class: "work-input", type: "text", value, spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") cancel();
    });
    input.addEventListener("click", (e) => e.stopPropagation());
    actions.holdOpen(true);
    requestAnimationFrame(() => {
      input.focus();
      // The name without its extension, ready to be typed over.
      const dot = value.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : value.length);
    });
    return input;
  }

  function row(e: WorkEntry): HTMLElement {
    const ext = e.dir ? "" : (e.name.match(/\.([^.]{1,5})$/)?.[1] ?? "").toUpperCase();
    const name = renaming === e.rel
      ? nameInput(e.name, (v) => {
        renaming = "";
        actions.holdOpen(false);
        void Bridge.workRename(e.rel, v).then(() => load()).catch(fail);
      }, () => { renaming = ""; actions.holdOpen(false); drawn = ""; State.notify(); })
      : h("span", { class: "files-name", text: e.name, title: e.name });
    const when = e.at ? new Date(e.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    const meta = grid
      ? (e.dir ? t("cartella") : `${ext ? `${ext} · ` : ""}${size(e.size)}`)
      : [e.dir ? t("cartella") : `${ext ? `${ext} · ` : ""}${size(e.size)}`, when].filter(Boolean).join(" · ");
    const openIt = () => { if (e.dir) go(e.rel); else void Bridge.workOpen(e.rel, false).catch(fail); };
    const r = h("div", { class: `files-row work-row${e.dir ? " dir" : ""}${moving?.rel === e.rel ? " moving" : ""}${trashing?.rel === e.rel ? " trashing" : ""}`,
      title: e.dir ? t("Doppio clic: apri la cartella") : t("Trascina in un'altra app · doppio clic: apri"),
      ondblclick: openIt },
    fileBadge(e.name, full(e), { dir: e.dir, big: grid, stamp: e.at }),
    h("div", { class: "files-info" }, name, h("span", { class: "files-meta", text: meta })),
    h("span", { class: "files-tools" },
      e.dir ? null : iconBtn("chat", t("Chiedi alla chat su questo file"), () => actions.askAboutFile({ name: e.name, path: full(e) })),
      iconBtn(e.dir ? "folder" : "file", e.dir ? t("Apri la cartella") : t("Apri"), openIt),
      moreBtn(e.name, () => [
        // As tiles only «⋯» is in sight: its menu starts with the buttons of the list.
        ...(grid ? [
          ...(e.dir ? [] : [{ label: t("Chiedi alla chat"), run: () => actions.askAboutFile({ name: e.name, path: full(e) }) }]),
          { label: e.dir ? t("Apri la cartella") : t("Apri"), run: openIt },
        ] : []),
        { label: t("Rinomina"), sep: grid, run: () => { renaming = e.rel; trashing = null; redraw(); } },
        { label: t("Sposta…"), run: () => { moving = e; trashing = null; redraw(); } },
        ...(e.dir ? [] : [{ label: t("Nel Vassoio"), run: () => void Bridge.workToInbox(e.rel).then(() => { note = t("«{name}» è nel Vassoio.", { name: e.name }); actions.refreshFiles(); redraw(); }).catch(fail) }]),
        { label: t("Mostra in Esplora file"), sep: true, run: () => void Bridge.workOpen(e.rel, true).catch(fail) },
        { label: t("Copia percorso"), run: () => void navigator.clipboard.writeText(full(e)).then(() => { note = t("Percorso copiato ✓"); redraw(); }).catch(fail) },
        // Asked again in the bar above the list: nothing goes with one click.
        { label: t("Sposta nel Cestino…"), sep: true, danger: true, run: () => { trashing = e; moving = null; redraw(); } },
      ])));
    // Pressed and moved: Windows' drag, as from the Vassoio (folders too).
    let press: { x: number; y: number } | null = null;
    r.addEventListener("pointerdown", (ev) => {
      press = ev.button === 0 && !(ev.target as Element).closest("button, input") ? { x: ev.clientX, y: ev.clientY } : null;
    });
    r.addEventListener("pointermove", (ev) => {
      if (!press || !(ev.buttons & 1) || Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 6) return;
      press = null;
      State.draggingOut = true;
      void Bridge.workDrag(e.rel).catch(fail).finally(() => { State.draggingOut = false; });
    });
    r.addEventListener("pointerup", () => { press = null; });
    return r;
  }

  function draw() {
    clear(crumbs);
    clear(list);
    clear(banner);
    status.textContent = note;
    const has = !!listing;
    mkdirBtn.style.display = has ? "" : "none";
    revealBtn.style.display = has ? "" : "none";
    layoutBtn.style.display = has ? "" : "none";
    sortBtn.style.display = has ? "" : "none";
    layoutBtn.replaceChildren(svg(grid ? ICONS.rows : ICONS.tiles, 12));
    tip(layoutBtn, grid ? t("Mostra come elenco") : t("Mostra come griglia"));
    layoutBtn.setAttribute("aria-label", grid ? t("Mostra come elenco") : t("Mostra come griglia"));
    sortBtn.textContent = sortLabel[sort];
    tip(sortBtn, t("Ordine: clic per cambiarlo (nome, data di modifica)"));
    list.classList.toggle("grid", grid);
    if (!listing) {
      list.append(h("div", { class: "files-empty", text: error || t("Scegli una cartella del PC: la chat e Telegram potranno consultarla e lavorarci.") }));
      return;
    }
    // Where we are: the folder's name, then each subfolder, clickable.
    const rootName = listing.root.split("\\").filter(Boolean).pop() ?? listing.root;
    const parts = listing.rel ? listing.rel.split("/") : [];
    crumbs.append(h("button", { class: "work-crumb", text: rootName, title: listing.root, onclick: () => go("") }));
    parts.forEach((p, i) => {
      crumbs.append(h("span", { class: "work-sep", text: "›" }),
        h("button", { class: "work-crumb", text: p, onclick: () => go(parts.slice(0, i + 1).join("/")) }));
    });
    if (moving) {
      const m = moving;
      banner.append(h("span", { text: t("Sposta «{name}»: apri la cartella di destinazione.", { name: m.name }) }),
        textBtn(t("Sposta qui"), () => {
          moving = null;
          void Bridge.workMove(m.rel, listing?.rel ?? "").then(() => { note = t("Spostato ✓"); return load(); }).catch(fail);
        }, "btn primary"),
        textBtn(t("Annulla"), () => { moving = null; drawn = ""; State.notify(); }));
    }
    if (trashing) {
      const gone = trashing;
      banner.classList.add("danger");
      banner.append(h("span", { text: t("Mettere «{name}» nel Cestino di Windows?", { name: gone.name }) }),
        textBtn(t("Nel Cestino"), () => {
          trashing = null;
          void Bridge.workTrash(gone.rel).then(() => { note = t("«{name}» è nel Cestino.", { name: gone.name }); return load(); }).catch(fail);
        }, "btn danger"),
        textBtn(t("Annulla"), () => { trashing = null; redraw(); }));
    } else banner.classList.remove("danger");
    if (newFolder) {
      const input = nameInput("", (v) => {
        newFolder = false;
        actions.holdOpen(false);
        void Bridge.workMkdir(rel, v).then(() => load()).catch(fail);
      }, () => { newFolder = false; actions.holdOpen(false); drawn = ""; State.notify(); });
      input.placeholder = t("Nome della nuova cartella, poi Invio");
      list.append(h("div", { class: "files-row work-row" }, h("span", { class: "work-icon", style: "color:#F5A524" }, renderActionIcon("i:folder", 14)), input));
    }
    if (listing.rel) {
      const up = parts.slice(0, -1).join("/");
      list.append(h("div", { class: "files-row work-row dir", title: t("Cartella sopra"), ondblclick: () => go(up), onclick: () => go(up) },
        h("span", { class: "work-icon", style: "color:#8E939C" }, h("span", { text: "↰" })),
        h("div", { class: "files-info" }, h("span", { class: "files-name", text: ".." }))));
    }
    if (!listing.entries.length && !newFolder) list.append(h("div", { class: "files-empty", text: t("Cartella vuota.") }));
    for (const e of sorted(listing.entries, sort)) list.append(row(e));
    if (listing.more) list.append(h("div", { class: "files-note", text: t("Sono mostrati i primi 500 elementi.") }));
  }

  return {
    el,
    sync() {
      if (!loading && Date.now() - loadedAt > STALE_MS && !renaming && !newFolder) void load();
      const k = `${loadedAt}|${renaming}|${trashing?.rel ?? ""}|${moving?.rel ?? ""}|${newFolder}|${note}|${grid}|${sort}`;
      if (k === drawn) return;
      drawn = k;
      draw();
    },
    current: () => (listing ? listing.rel : null),
    reload: () => void load(),
  };
}
