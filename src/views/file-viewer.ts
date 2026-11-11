// The viewer of a file inside a card (integrazioni personali): pictures,
// audio and video with their player, PDF in a frame, text and Word as text;
// anything else only «Apri». Bytes come from Rust (file_bytes, no asset
// protocol) as a blob: URL. Elements are kept by path, so a card painted
// again does not stop what is playing.

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { h } from "./dom";

export type ViewKind = "image" | "audio" | "video" | "pdf" | "text" | "other";

const KINDS: Record<string, ViewKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image",
  mp3: "audio", wav: "audio", ogg: "audio", opus: "audio", oga: "audio", aac: "audio", flac: "audio", m4a: "audio", weba: "audio",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
  pdf: "pdf",
  txt: "text", md: "text", csv: "text", json: "text", log: "text", xml: "text", html: "text", htm: "text", ini: "text", yaml: "text", yml: "text",
  docx: "text", dotx: "text", docm: "text", dotm: "text",
};

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", oga: "audio/ogg", aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4", weba: "audio/webm",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  pdf: "application/pdf",
};

function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function viewKind(path: string): ViewKind {
  return KINDS[extOf(path)] ?? "other";
}

interface Kept {
  el: HTMLElement;
  url: string | null;
}

/** The last viewers, by path and place; the oldest go (and their blob: URL). */
const kept = new Map<string, Kept>();
const KEEP = 6;

function forget(key: string) {
  const k = kept.get(key);
  if (!k) return;
  if (k.url) URL.revokeObjectURL(k.url);
  kept.delete(key);
}

export interface ViewerOptions {
  /** A short label above the file (e.g. «Risposta del servizio»). */
  title?: string;
  /** «Salva»: shown when given (a file answered by a service, not kept yet). */
  onSave?: () => void;
  /** Where the viewer lives, so the same file in two places has two players. */
  place?: string;
}

/** The viewer of `path`; the same element for the same path and place. */
export function fileViewer(path: string, opts: ViewerOptions = {}): HTMLElement {
  const key = `${opts.place ?? ""}|${path}|${opts.onSave ? 1 : 0}`;
  const old = kept.get(key);
  if (old) {
    // Most recent last.
    kept.delete(key);
    kept.set(key, old);
    return old.el;
  }
  const kind = viewKind(path);
  const name = path.split(/[\\/]/).pop() ?? path;
  const body = h("div", { class: `file-view-body ${kind}` });
  const open = h("button", { class: "link-btn", text: t("Apri") });
  open.addEventListener("click", () => void Bridge.fileOpen(path, false).catch((e) => console.warn(e)));
  const folder = h("button", { class: "link-btn", text: t("Mostra nella cartella") });
  folder.addEventListener("click", () => void Bridge.fileOpen(path, true).catch((e) => console.warn(e)));
  const bar = h("div", { class: "file-view-bar" }, h("span", { class: "file-view-name", text: name, title: path }));
  if (opts.onSave) {
    const save = h("button", { class: "link-btn", text: t("Salva") });
    save.addEventListener("click", () => opts.onSave?.());
    bar.append(save);
  }
  if (kind === "pdf" || kind === "text") {
    const big = h("button", { class: "link-btn", text: t("Anteprima") });
    big.addEventListener("click", () => void Bridge.previewOpen(path).catch((e) => console.warn(e)));
    bar.append(big);
  }
  bar.append(open, folder);
  const el = h("div", { class: "file-view" }, ...(opts.title ? [h("div", { class: "file-view-title", text: opts.title })] : []), body, bar);
  const entry: Kept = { el, url: null };
  kept.set(key, entry);
  while (kept.size > KEEP) forget(kept.keys().next().value as string);

  const fail = (e: unknown) => {
    body.replaceChildren(h("div", { class: "file-view-empty", text: String(e).replace(/^Error:\s*/, "") }));
  };
  if (kind === "other") {
    body.append(h("div", { class: "file-view-empty", text: t("Questo tipo di file si apre con il suo programma.") }));
  } else if (kind === "text") {
    body.append(h("div", { class: "file-view-empty", text: "…" }));
    Bridge.fileText(path)
      .then((text) => body.replaceChildren(h("pre", { class: "file-view-text", text: text || t("(vuoto)") })))
      .catch(fail);
  } else {
    body.append(h("div", { class: "file-view-empty", text: "…" }));
    Bridge.fileBytes(path)
      .then((bytes) => {
        if (!kept.has(key)) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: MIME[extOf(path)] ?? "application/octet-stream" }));
        entry.url = url;
        let media: HTMLElement;
        if (kind === "image") media = h("img", { src: url, alt: name });
        else if (kind === "audio") media = h("audio", { src: url, controls: true, preload: "metadata" });
        else if (kind === "video") media = h("video", { src: url, controls: true, preload: "metadata" });
        else media = h("iframe", { src: url, title: name });
        media.addEventListener("error", () => fail(t("Il file non si riesce a mostrare: aprilo con «Apri».")));
        body.replaceChildren(media);
      })
      .catch(fail);
  }
  return el;
}
