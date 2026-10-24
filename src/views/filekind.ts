// The icon of a file by its type, for the Vassoio and the work folder (asked by
// Edoardo on 24 Oct 2026), and the preview of pictures (thumbs.rs): the icon
// shows at once, the picture replaces it as soon as Windows hands it over.

import { h } from "./dom";
import { renderActionIcon } from "./action-icons";
import { Bridge } from "../core/bridge";

interface Kind { icon: string; color: string }

const KINDS: [string[], Kind][] = [
  [["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic", "ico", "jfif", "svg"], { icon: "image", color: "#34D399" }],
  [["pdf"], { icon: "file", color: "#F4505E" }],
  [["doc", "docx", "odt", "rtf", "pages"], { icon: "note", color: "#3B82F6" }],
  [["xls", "xlsx", "xlsm", "ods", "csv", "numbers"], { icon: "chart", color: "#22C55E" }],
  [["ppt", "pptx", "odp", "key"], { icon: "chart", color: "#F97316" }],
  [["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "cab"], { icon: "briefcase", color: "#F5A524" }],
  [["mp3", "wav", "flac", "m4a", "ogg", "aac", "wma"], { icon: "music", color: "#EC4899" }],
  [["mp4", "mkv", "mov", "avi", "wmv", "webm", "m4v"], { icon: "play", color: "#EF4444" }],
  [["eml", "msg"], { icon: "mail", color: "#38BDF8" }],
  [["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "cs", "cpp", "c", "h", "php", "rb", "json", "xml", "yml", "yaml", "toml",
    "html", "htm", "css", "scss", "sql", "sh", "ps1", "bat", "cmd", "vbs", "ini", "cfg"], { icon: "code", color: "#A78BFA" }],
  [["txt", "md", "log"], { icon: "note", color: "#94A3B8" }],
  [["exe", "msi", "appx", "msix", "lnk"], { icon: "rocket", color: "#64748B" }],
  [["ttf", "otf", "woff", "woff2"], { icon: "file", color: "#94A3B8" }],
];

export function extOf(name: string): string {
  return name.match(/\.([^.\\/]{1,6})$/)?.[1]?.toLowerCase() ?? "";
}

function kindOf(name: string): Kind {
  const ext = extOf(name);
  return KINDS.find(([exts]) => exts.includes(ext))?.[1] ?? { icon: "file", color: "#38BDF8" };
}

const PICTURES = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic", "ico", "jfif"]);
/** Previews already asked for, by path (and the date, so a changed file is asked again). */
const thumbs = new Map<string, Promise<string | null>>();

/**
 * The icon of `name` (a folder when `dir`), `px` big; a picture at `path` shows
 * its preview instead. `big` is the grid's tile, with the extension under it.
 */
export function fileBadge(name: string, path: string, opts: { dir?: boolean; big?: boolean; stamp?: number } = {}): HTMLElement {
  const px = opts.big ? 30 : 16;
  const kind = opts.dir ? { icon: "folder", color: "#F5A524" } : kindOf(name);
  const el = h("span", { class: `file-badge${opts.big ? " big" : ""}`, style: `color:${kind.color}` }, renderActionIcon(`i:${kind.icon}`, px));
  const ext = extOf(name);
  if (!opts.dir && path && PICTURES.has(ext)) {
    const key = `${path}|${opts.stamp ?? 0}`;
    let p = thumbs.get(key);
    if (!p) {
      p = Bridge.fileThumb(path).catch(() => null);
      thumbs.set(key, p);
    }
    void p.then((url) => {
      if (!url) return;
      el.classList.add("pic");
      el.replaceChildren(h("img", { src: url, alt: "", draggable: "false" }));
    });
  }
  return el;
}
