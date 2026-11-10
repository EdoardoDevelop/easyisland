// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers asking a
// question about it, plus the user's quick actions that work on a file.

import { buildRecorderPanel } from "./recorder";
import { buildWorkPanel } from "./workdir";
import { buildCollectPanel } from "./collect";
import { fileBadge } from "./filekind";
import { h, clear, svg, tip } from "./dom";
import { showMenu, type MenuItem } from "./ctxmenu";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { fileActions } from "./actions";
import { renderActionIcon } from "./action-icons";
import { Bridge } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";
import { locale, t } from "../core/i18n";

/** Dashed rounded rect drawn as SVG so the dashes can march like on macOS. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

export function buildUpload(actions: ViewActions): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: t("Rilascia qui i tuoi file") });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", t("Immagini"), t("Codice"), t("Documenti")].map((label) => h("span", { text: label })),
  );
  // The tray: what was dropped since EasyIsland started.
  const history = h("button", {
    class: "drop-history", title: t("I file rilasciati sull'isola: da trascinare in un'altra app, aprire o chiedere alla chat"),
    onclick: () => actions.openFiles(),
  }, h("span", { text: t("Vassoio") }), h("span", { class: "arrow", text: "›" }));
  // A zone of the screen instead of a file: "Riquadra e chiedi" (src/island/capture.ts).
  const capture = h("button", {
    class: "drop-history drop-capture", title: t("Riquadra una zona dello schermo: chiedi alla chat, copia il testo o tienila nel Vassoio"),
    onclick: () => actions.captureScreen(),
  }, renderActionIcon("i:camera", 13), h("span", { text: t("Riquadra e chiedi") }));
  const links = h("div", { class: "drop-links" }, capture, history);
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags, links),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
      links.style.display = State.fileDragOver ? "none" : "";
    },
  };
}

export function buildUploading(): ViewHost {
  const label = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const fill = h("div", { class: "up-fill" });
  const glow = h("div", { class: "up-glow" });
  const card = h(
    "div",
    { class: "card up-card" },
    h("div", { class: "up-row" }, label, percent),
    h("div", { class: "up-track" }, fill, glow),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const done = State.uploadProgress >= 0.999;
      const pct = Math.round(State.uploadProgress * 100);
      label.textContent = done
        ? `✓  ${State.droppedFile?.name ?? "File"}`
        : t("Caricamento di {name}", { name: State.droppedFile?.name ?? "file" });
      label.classList.toggle("done", done);
      percent.textContent = done ? "" : `${pct} %`;
      const w = State.uploadProgress * 526;
      fill.style.width = `${w}px`;
      glow.style.transform = `translateX(${Math.max(0, w - 14)}px)`;
      glow.style.opacity = State.uploadProgress > 0.01 ? "1" : "0";
      card.classList.toggle("done", done);
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub", text: t("Cosa vuoi farne?") });
  const row = h("div", { class: "actions" });
  let rowKey: string | null = null;
  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "stack", style: "padding:0 18px 0 max(16px, calc(98px * var(--bot-room, 1)))" }, title, sub, row),
    ),
  );

  return {
    el,
    sync() {
      clear(title);
      title.append(
        h("b", { text: State.droppedFile?.name ?? "file" }),
        document.createTextNode(t(" è pronto.")),
      );

      // The user's file actions sit between the question and the way out.
      const list = fileActions();
      const k = JSON.stringify(list.map((a) => [a.id, a.name]));
      if (k === rowKey) return;
      rowKey = k;
      clear(row);
      row.append(
        h("button", {
          class: "btn primary",
          text: t("Fai una domanda"),
          onclick: () => actions.setView("prompt"),
        }),
        ...list.map((a) => h("button", {
          class: "btn secondary",
          text: a.name || t("Senza nome"),
          title: a.prompt,
          onclick: () => actions.runAction(a),
        })),
        h("button", {
          class: "btn secondary",
          text: t("Vassoio"),
          title: t("Tieni il file nel vassoio"),
          onclick: () => actions.openFiles(),
        }),
        h("button", {
          class: "btn secondary",
          text: t("Annulla"),
          onclick: () => actions.cancelDrop(),
        }),
      );
    },
  };
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale(), { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/** "Estrai…" on a dropped ZIP: what is inside and where to put it. */
export function buildUnzip(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  const list = h("div", { class: "zip-list" });
  const row = h("div", { class: "actions" });
  const body = h("div", { class: "zip-body" }, title, sub, list, row);
  const el = h("div", { class: "view" }, h("div", { class: "card zip-card" }, body));
  let key = "";

  return {
    el,
    sync() {
      const u = State.unzip;
      const file = State.droppedFile;
      if (!u || !file) return;
      const k = `${file.name}|${u.status}|${u.message}|${u.info?.count ?? ""}`;
      if (k === key) return;
      key = k;
      clear(title);
      title.append(h("b", { text: file.name }));
      clear(list);
      clear(row);
      sub.classList.toggle("bad", u.status === "error");
      const btn = (label: string, kind: "primary" | "secondary", fn: () => void) =>
        h("button", { class: `btn ${kind}`, text: label, onclick: fn });
      const back = () => actions.setView(State.defaultView());

      switch (u.status) {
        case "loading":
          sub.textContent = t("Leggo il contenuto…");
          row.append(btn(t("Annulla"), "secondary", back));
          break;
        case "ready":
        case "working": {
          const info = u.info!;
          sub.textContent = t("{n} file · {size} una volta estratti", { n: info.count, size: size(info.size) });
          for (const n of info.names) list.append(h("div", { class: "zip-item", text: n }));
          if (info.count > info.names.length) {
            list.append(h("div", { class: "zip-item more", text: `…e altri ${info.count - info.names.length}` }));
          }
          if (u.status === "working") {
            row.append(h("div", { class: "sub", text: t("Estraggo…") }));
          } else if (file.source) {
            row.append(
              btn(t("Estrai accanto all'originale"), "primary", () => actions.extractZip("beside")),
              btn(t("In Download"), "secondary", () => actions.extractZip("downloads")),
              btn(t("Sul Desktop"), "secondary", () => actions.extractZip("desktop")),
              btn(t("Annulla"), "secondary", back),
            );
          } else {
            row.append(
              btn(t("Estrai in Download"), "primary", () => actions.extractZip("downloads")),
              btn(t("Sul Desktop"), "secondary", () => actions.extractZip("desktop")),
              btn(t("Annulla"), "secondary", back),
            );
          }
          break;
        }
        case "done":
          sub.textContent = t("Estratto in una nuova cartella, già aperta in Esplora file:");
          list.append(h("div", { class: "zip-item dest", text: u.message }));
          row.append(btn(t("Fatto"), "primary", back));
          break;
        case "error":
          sub.textContent = u.message;
          row.append(btn(t("Chiudi"), "secondary", back));
          break;
      }
    },
    fitHeight: () => body.offsetHeight + 24,
  };
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t("adesso");
  if (s < 3600) return t("{n} min fa", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h fa", { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  return d === 1 ? t("ieri") : t("{n} giorni fa", { n: d });
}

/**
 * "File e schermo" in the menu: two tiles (where to drop a file, and "Riquadra e
 * chiedi" for a zone of the screen), then the tray ("Vassoio"): the copies of
 * the files dropped on the island (the inbox), emptied every time EasyIsland
 * starts except the pinned ones. Drag one out into another app, open it, show
 * it in the folder, ask about it again, pin it, take one or all of them out.
 * The originals are never touched.
 */
export function buildFiles(actions: ViewActions): ViewHost {
  const count = h("span", { class: "files-count" });
  const clearAll = h("button", { class: "files-clear" }) as HTMLButtonElement;
  // Grid or list, remembered on this PC (a convenience: it may come back empty).
  let grid = false;
  try { grid = localStorage.getItem("trayLayout") === "grid"; } catch { /* no storage */ }
  const layoutBtn = h("button", { class: "files-layout" }) as HTMLButtonElement;
  const showLayout = () => {
    const label = grid ? t("Mostra come elenco") : t("Mostra come griglia");
    layoutBtn.replaceChildren(svg(grid ? ICONS.rows : ICONS.tiles, 12));
    tip(layoutBtn, label);
    layoutBtn.setAttribute("aria-label", label);
    list.classList.toggle("grid", grid);
  };
  layoutBtn.addEventListener("click", () => {
    grid = !grid;
    try { localStorage.setItem("trayLayout", grid ? "grid" : "list"); } catch { /* no storage */ }
    showLayout();
    key = null;
    State.notify();
  });
  // The two ways in: a file dropped anywhere on the island, or a zone of the screen.
  const dropTile = h("div", { class: "files-tile drop" },
    h("strong", { text: t("Rilascia qui un file") }),
    h("span", { text: t("PDF, immagini, codice, ZIP") }));
  const hotkey = h("span");
  const captureTile = h("button", { class: "files-tile capture",
    title: t("Riquadra una zona dello schermo: chiedi alla chat, copia il testo o tienila nel Vassoio"),
    onclick: () => actions.captureScreen() },
  h("strong", {}, renderActionIcon("i:camera", 14), h("span", { text: t("Riquadra e chiedi") })), hotkey);
  const head = h("div", { class: "files-head" },
    h("b", { text: t("Vassoio") }), count, h("span", { class: "files-head-gap" }), layoutBtn, clearAll);
  const list = h("div", { class: "files-list" });
  showLayout();
  const note = h("div", { class: "files-note",
    text: t("Copie dei file rilasciati: trascinale in un'altra app, gli originali restano dove sono. Al riavvio il Vassoio si svuota, tranne i file fissati.") });
  // Registra: a conversation, the screen or one window (src/views/recorder.ts).
  const recorder = buildRecorderPanel(actions);
  // The work folder (src/views/workdir.ts), separate from the tray.
  const work = buildWorkPanel(actions);
  // La Raccolta: bits from any app, with their source, for the chat (src/views/collect.ts).
  const collect = buildCollectPanel(actions);
  // From the most used down: the ways in, what was dropped, the work folder,
  // then the tools (Raccolta, Registra). Each section under a thin line.
  const body = h("div", { class: "files-body" },
    h("h1", { class: "files-title", text: t("File e schermo") }),
    h("div", { class: "files-tiles" }, dropTile, captureTile),
    h("section", { class: "files-section" }, head, list, note),
    work.el,
    collect.el,
    recorder.el);
  const card = h("div", { class: "card files-card" }, body);
  const el = h("div", { class: "view" }, card);

  // Null until the first draw: an empty tray must still draw its message.
  let key: string | null = null;
  let confirming = false;
  let confirmTimer = 0;

  const resetClear = () => {
    confirming = false;
    clearAll.textContent = t("Svuota");
    clearAll.classList.remove("confirm");
  };
  clearAll.addEventListener("click", async () => {
    if (!confirming) {
      // Two clicks: everything goes at once, and there is no undo.
      confirming = true;
      clearAll.textContent = t("Sicuro? Clic per svuotare");
      clearAll.classList.add("confirm");
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(resetClear, 3500);
      return;
    }
    window.clearTimeout(confirmTimer);
    resetClear();
    await Bridge.inboxClear();
    actions.refreshFiles();
  });
  resetClear();

  // Two actions in sight (Chiedi, Apri), the rest in a menu: one quiet colour,
  // a tooltip and a name for screen readers on each.
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

  return {
    el,
    sync() {
      recorder.sync();
      collect.sync();
      work.sync();
      // The tray's «Sposta nella cartella di lavoro» appears with a work folder.
      const workHere = work.current();
      const workKey = workHere === null ? "-" : workHere;
      dropTile.classList.toggle("over", State.fileDragOver);
      hotkey.textContent = State.settings.hotkeyScreenshot ?? "";
      const files = State.inbox ?? [];
      const fresh = State.trayFresh && State.trayFresh.until > Date.now() ? State.trayFresh.name : "";
      const k = `${fresh}#${workKey}#` + files.map((f) => `${f.name}:${f.at}:${f.kept ? 1 : 0}`).join("|");
      if (k === key) return;
      key = k;
      const total = files.reduce((s, f) => s + f.size, 0);
      count.textContent = files.length ? `· ${files.length} · ${size(total)}` : "";
      clearAll.style.display = files.some((f) => !f.kept) ? "" : "none";
      clear(list);
      // The empty tray says it itself: the note would repeat it.
      note.style.display = files.length ? "" : "none";
      if (files.length === 0) {
        list.append(h("div", { class: "files-empty", text: t("Il vassoio è vuoto. I file che rilasci sull'isola restano qui finché EasyIsland è aperto.") }));
        return;
      }
      for (const f of files) {
        const err = h("span", { class: "files-err" });
        const fail = (e: unknown) => { err.textContent = String(e).replace(/^Error:\s*/, ""); };
        const isFresh = f.name === fresh;
        const row = h("div", { class: `files-row${f.kept ? " kept" : ""}${isFresh ? " fresh" : ""}`, title: t("Trascina in un'altra app · doppio clic: apri"),
          ondblclick: () => void Bridge.inboxOpen(f.name, false).catch(fail) },
        fileBadge(f.name, f.path, { big: grid, stamp: f.at }),
        h("div", { class: "files-info" },
          h("span", { class: "files-name", text: f.name, title: f.name }),
          h("span", { class: "files-meta" },
            isFresh ? h("span", { class: "files-fresh-tag", text: `${t("Appena aggiunta")} · ` }) : null,
            // The pin the note speaks of: a fixed file stays after a restart and «Svuota».
            f.kept ? h("span", { class: "files-pin", title: t("Fissato: resta anche dopo il riavvio e «Svuota»"),
              "aria-label": t("Fissato") }, svg(ICONS.pin, 10)) : null,
            `${size(f.size)} · ${ago(f.at)}`),
          err),
        h("span", { class: "files-tools" },
          iconBtn("chat", t("Chiedi alla chat su questo file"), () => actions.askAboutFile(f)),
          iconBtn("file", t("Apri"), () => void Bridge.inboxOpen(f.name, false).catch(fail)),
          moreBtn(f.name, () => [
            // As tiles only «⋯» is in sight: its menu starts with the two buttons of the list.
            ...(grid ? [
              { label: t("Chiedi alla chat"), run: () => actions.askAboutFile(f) },
              { label: t("Apri"), run: () => void Bridge.inboxOpen(f.name, false).catch(fail) },
            ] : []),
            { label: t("Mostra nella cartella"), sep: grid, run: () => void Bridge.inboxOpen(f.name, true).catch(fail) },
            ...(workHere === null ? [] : [{
              label: workHere ? t("Sposta nella cartella di lavoro, in «{dir}»", { dir: workHere }) : t("Sposta nella cartella di lavoro"),
              run: () => void Bridge.inboxToWork(f.name, workHere, false).then(() => { actions.refreshFiles(); work.reload(); }).catch(fail),
            }]),
            { label: f.kept ? t("Togli la puntina") : t("Fissa nel Vassoio"),
              run: () => void Bridge.inboxKeep(f.name, !f.kept).then(() => actions.refreshFiles()).catch(fail) },
            { label: t("Togli dal vassoio"), sep: true, danger: true,
              run: () => void Bridge.inboxDelete(f.name).then(() => actions.refreshFiles()).catch(fail) },
          ])));
        if (isFresh) {
          // Ask about it or copy it, without looking for the icons.
          const done = h("span", { class: "files-fresh-done" });
          row.append(h("div", { class: "files-fresh-row" },
            h("button", { class: "btn primary", onclick: (e: Event) => { e.stopPropagation(); State.trayFresh = null; actions.askAboutPicture(f); } },
              h("span", { text: t("Chiedi") })),
            /\.png$/i.test(f.name)
              ? h("button", { class: "btn secondary", onclick: (e: Event) => {
                e.stopPropagation();
                void Bridge.inboxCopy(f.name).then(() => { done.textContent = t("Copiata negli appunti ✓"); }).catch(fail);
              } }, h("span", { text: t("Copia") }))
              : null,
            done));
        }
        // Pressed and moved past a few pixels: Windows' drag takes over, so the
        // file can be dropped in a mail, a chat or a folder.
        let press: { x: number; y: number } | null = null;
        row.addEventListener("pointerdown", (e) => {
          press = e.button === 0 && !(e.target as Element).closest("button") ? { x: e.clientX, y: e.clientY } : null;
        });
        row.addEventListener("pointermove", (e) => {
          if (!press || !(e.buttons & 1) || Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
          press = null;
          // Our own file crossing the island must not open the drop view.
          State.draggingOut = true;
          void Bridge.inboxDrag(f.name).catch(fail).finally(() => { State.draggingOut = false; });
        });
        row.addEventListener("pointerup", () => { press = null; });
        list.append(row);
      }
    },
    fitHeight: () => body.offsetHeight + 16,
  };
}
