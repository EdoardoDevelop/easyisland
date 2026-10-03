// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers asking a
// question about it, plus the user's quick actions that work on a file.

import { h, clear } from "./dom";
import { State } from "../core/state";
import { fileActions } from "./actions";
import { renderActionIcon } from "./action-icons";
import { Bridge } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";

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
  const title = h("div", { class: "drop-title", text: "Rilascia qui i tuoi file" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", "Immagini", "Codice", "Documenti"].map((t) => h("span", { text: t })),
  );
  // The history of what was dropped, kept in the inbox for a week.
  const history = h("button", {
    class: "drop-history", title: "Cronologia dei file rilasciati sull'isola",
    onclick: () => actions.openFiles(),
  }, h("span", { text: "File caricati" }), h("span", { class: "arrow", text: "›" }));
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags, history),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
      history.style.display = State.fileDragOver ? "none" : "";
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
        : `Caricamento di ${State.droppedFile?.name ?? "file"}`;
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
  const sub = h("div", { class: "sub", text: "Cosa vuoi farne?" });
  const row = h("div", { class: "actions" });
  let rowKey: string | null = null;
  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, sub, row),
    ),
  );

  return {
    el,
    sync() {
      clear(title);
      title.append(
        h("b", { text: State.droppedFile?.name ?? "file" }),
        document.createTextNode(" è pronto."),
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
          text: "Fai una domanda",
          onclick: () => actions.setView("prompt"),
        }),
        ...list.map((a) => h("button", {
          class: "btn secondary",
          text: a.name || "Senza nome",
          title: a.prompt,
          onclick: () => actions.runAction(a),
        })),
        h("button", {
          class: "btn secondary",
          text: "Annulla",
          onclick: () => actions.setView(State.defaultView()),
        }),
      );
    },
  };
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("it-IT", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
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
          sub.textContent = "Leggo il contenuto…";
          row.append(btn("Annulla", "secondary", back));
          break;
        case "ready":
        case "working": {
          const info = u.info!;
          sub.textContent = `${info.count} file · ${size(info.size)} una volta estratti`;
          for (const n of info.names) list.append(h("div", { class: "zip-item", text: n }));
          if (info.count > info.names.length) {
            list.append(h("div", { class: "zip-item more", text: `…e altri ${info.count - info.names.length}` }));
          }
          if (u.status === "working") {
            row.append(h("div", { class: "sub", text: "Estraggo…" }));
          } else if (file.source) {
            row.append(
              btn("Estrai accanto all'originale", "primary", () => actions.extractZip("beside")),
              btn("In Download", "secondary", () => actions.extractZip("downloads")),
              btn("Sul Desktop", "secondary", () => actions.extractZip("desktop")),
              btn("Annulla", "secondary", back),
            );
          } else {
            row.append(
              btn("Estrai in Download", "primary", () => actions.extractZip("downloads")),
              btn("Sul Desktop", "secondary", () => actions.extractZip("desktop")),
              btn("Annulla", "secondary", back),
            );
          }
          break;
        }
        case "done":
          sub.textContent = "Estratto in una nuova cartella, già aperta in Esplora file:";
          list.append(h("div", { class: "zip-item dest", text: u.message }));
          row.append(btn("Fatto", "primary", back));
          break;
        case "error":
          sub.textContent = u.message;
          row.append(btn("Chiudi", "secondary", back));
          break;
      }
    },
    fitHeight: () => body.offsetHeight + 24,
  };
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "adesso";
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ieri" : `${d} giorni fa`;
}

/**
 * "File caricati": the copies of the files dropped on the island (the inbox,
 * swept after a week). Open, show in the folder, ask about it again, delete
 * one or all. The originals are never touched.
 */
export function buildFiles(actions: ViewActions): ViewHost {
  const count = h("span", { class: "files-count" });
  const clearAll = h("button", { class: "files-clear" }) as HTMLButtonElement;
  const head = h("div", { class: "files-head" },
    h("button", { class: "files-back", title: "Indietro", text: "‹", onclick: () => actions.setView("upload") }),
    h("b", { text: "File caricati" }), count, clearAll);
  const list = h("div", { class: "files-list" });
  const note = h("div", { class: "files-note",
    text: "Sono copie: gli originali restano dove sono. Si cancellano da sole dopo una settimana." });
  const body = h("div", { class: "files-body" }, head, list, note);
  const el = h("div", { class: "view" }, h("div", { class: "card files-card" }, body));

  let key = "";
  let confirming = false;
  let confirmTimer = 0;

  const resetClear = () => {
    confirming = false;
    clearAll.textContent = "Elimina tutti";
    clearAll.classList.remove("confirm");
  };
  clearAll.addEventListener("click", async () => {
    if (!confirming) {
      // Two clicks: everything goes at once, and there is no undo.
      confirming = true;
      clearAll.textContent = "Sicuro? Clic per eliminare";
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

  const iconBtn = (icon: string, title: string, color: string, fn: () => void) => {
    const b = h("button", { class: "clip-btn", title, style: `--c:${color}`,
      onclick: (e: Event) => { e.stopPropagation(); fn(); } }, renderActionIcon(`i:${icon}`, 13));
    return b;
  };

  return {
    el,
    sync() {
      const files = State.inbox ?? [];
      const k = files.map((f) => `${f.name}:${f.at}`).join("|");
      if (k === key) return;
      key = k;
      const total = files.reduce((s, f) => s + f.size, 0);
      count.textContent = files.length ? `${files.length} · ${size(total)}` : "";
      clearAll.style.display = files.length ? "" : "none";
      clear(list);
      if (files.length === 0) {
        list.append(h("div", { class: "files-empty", text: "Nessun file. Quelli che rilasci sull'isola compaiono qui." }));
        return;
      }
      for (const f of files) {
        const err = h("span", { class: "files-err" });
        const fail = (e: unknown) => { err.textContent = String(e).replace(/^Error:\s*/, ""); };
        list.append(h("div", { class: "files-row", title: "Doppio clic: apri",
          ondblclick: () => void Bridge.inboxOpen(f.name, false).catch(fail) },
        h("div", { class: "files-info" },
          h("span", { class: "files-name", text: f.name }),
          h("span", { class: "files-meta", text: `${size(f.size)} · ${ago(f.at)}` }),
          err),
        h("span", { class: "files-tools" },
          iconBtn("chat", "Chiedi a Claude su questo file", "#A78BFA", () => actions.askAboutFile(f)),
          iconBtn("file", "Apri", "#38BDF8", () => void Bridge.inboxOpen(f.name, false).catch(fail)),
          iconBtn("folder", "Mostra nella cartella", "#F5A524", () => void Bridge.inboxOpen(f.name, true).catch(fail)),
          iconBtn("trash", "Elimina", "#F4505E", () => {
            void Bridge.inboxDelete(f.name).then(() => actions.refreshFiles()).catch(fail);
          }))));
      }
    },
    fitHeight: () => body.offsetHeight + 16,
  };
}
