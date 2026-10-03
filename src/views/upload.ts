// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers asking a
// question about it, plus the user's quick actions that work on a file.

import { h, clear } from "./dom";
import { State } from "../core/state";
import { fileActions } from "./actions";
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

export function buildUpload(): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: "Rilascia qui i tuoi file" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", "Immagini", "Codice", "Documenti"].map((t) => h("span", { text: t })),
  );
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
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
