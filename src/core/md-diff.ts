// Changes to files as an editor shows them (26 Nov 2026, Edoardo: «fai subito
// 1», the chat on par with Claude Desktop): lines removed in red and added in
// green, the words that changed marked inside them, «+N −M» on top, in line or
// side by side (the choice is remembered on this PC).
//  - «```modifica» blocks: what an engine changes in a file (Rust steps::edit_block,
//    one JSON line: file, old and new text of each change, `write` for a whole
//    file); folded under their step by typeline.ts foldSteps.
//  - «```diff» / «```patch» blocks of a reply, once closed: the unified diff read.
// The texts compared come from the engine: DOM only (textContent), never markup.

import { diffLines, diffWordsWithSpace } from "diff";
import { t } from "./i18n";
import "./md-diff.css";

type Kind = "same" | "del" | "add" | "gap";
interface Row {
  kind: Kind;
  text: string;
  /** The words of a changed line, those that changed marked. */
  parts?: { text: string; mark: boolean }[];
}

/** Lines of unchanged text kept around a change; a longer run folds into «⋯ N righe uguali». */
const CONTEXT = 2;
/** More rows than this: the card starts with its own height, and scrolls. */
const TALL = 24;
const SPLIT_KEY = "easyisland.diffSplit";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const lines = (s: string) => {
  const out = s.replace(/\r\n?/g, "\n").split("\n");
  if (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
};

/** A run of removed lines and the added ones after it: paired line by line, the changed words marked. */
function pairWords(dels: Row[], adds: Row[]) {
  const n = Math.min(dels.length, adds.length);
  for (let i = 0; i < n; i++) {
    const a = dels[i].text, b = adds[i].text;
    // Too different, or too long to read word by word: the lines stay whole.
    if (a.length + b.length > 1200) continue;
    const parts = diffWordsWithSpace(a, b);
    const same = parts.filter((p) => !p.added && !p.removed).reduce((k, p) => k + p.value.length, 0);
    if (same < Math.min(a.length, b.length) * 0.3) continue;
    dels[i].parts = parts.filter((p) => !p.added).map((p) => ({ text: p.value, mark: !!p.removed }));
    adds[i].parts = parts.filter((p) => !p.removed).map((p) => ({ text: p.value, mark: !!p.added }));
  }
}

/** Every removed run followed by added lines gets its words marked. */
function markWords(rows: Row[]): Row[] {
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "del") { i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === "del") j++;
    let k = j;
    while (k < rows.length && rows[k].kind === "add") k++;
    pairWords(rows.slice(i, j), rows.slice(j, k));
    i = Math.max(k, i + 1);
  }
  return rows;
}

/** The rows of one change: old text against new. */
export function rowsOf(oldText: string, newText: string): Row[] {
  const rows: Row[] = [];
  for (const part of diffLines(oldText, newText)) {
    const kind: Kind = part.added ? "add" : part.removed ? "del" : "same";
    for (const text of lines(part.value)) rows.push({ kind, text });
  }
  return markWords(rows);
}

/** A unified diff («```diff»): its files and rows («@@» lines become gaps with their place). */
export function rowsOfUnified(text: string): { files: string[]; rows: Row[] } {
  const files: string[] = [];
  const rows: Row[] = [];
  for (const line of lines(text)) {
    if (/^(\+\+\+|---) /.test(line)) {
      const name = line.slice(4).replace(/^[ab]\//, "").replace(/\t.*$/, "").trim();
      if (name && name !== "/dev/null" && !files.includes(name)) files.push(name);
    } else if (line.startsWith("@@")) rows.push({ kind: "gap", text: line.replace(/^@@[^@]*@@\s?/, "").trim() || "⋯" });
    else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ") || line === "") rows.push({ kind: "same", text: line.slice(1) });
    // «diff --git», «index …», «\ No newline at end of file»: not lines of the files.
  }
  return { files, rows: markWords(rows) };
}

/** Long runs of unchanged lines folded, `CONTEXT` kept on each side of a change. */
function fold(rows: Row[]): (Row | { kind: "fold"; hidden: Row[] })[] {
  const out: (Row | { kind: "fold"; hidden: Row[] })[] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "same") { out.push(rows[i++]); continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === "same") j++;
    const keepHead = i === 0 ? 0 : CONTEXT;
    const keepTail = j === rows.length ? 0 : CONTEXT;
    if (j - i > keepHead + keepTail + 1) {
      out.push(...rows.slice(i, i + keepHead));
      out.push({ kind: "fold", hidden: rows.slice(i + keepHead, j - keepTail) });
      out.push(...rows.slice(j - keepTail, j));
    } else out.push(...rows.slice(i, j));
    i = j;
  }
  return out;
}

function lineText(r: Row): HTMLElement {
  const code = el("span", "md-diff-text");
  if (r.parts) for (const p of r.parts) code.append(p.mark ? el("mark", undefined, p.text) : document.createTextNode(p.text));
  else code.textContent = r.text || " ";
  return code;
}

const SIGN: Record<Kind, string> = { same: " ", del: "−", add: "+", gap: "" };

/** Rows in line: one under the other, a sign in front. */
function inlineRows(list: ReturnType<typeof fold>, box: HTMLElement) {
  for (const r of list) {
    if (r.kind === "fold") {
      const more = el("button", "md-diff-fold", `⋯ ${t("{n} righe uguali", { n: r.hidden.length })}`);
      more.addEventListener("click", () => {
        const at = more;
        for (const h of r.hidden) at.before(inlineLine(h));
        more.remove();
      });
      box.append(more);
    } else box.append(inlineLine(r));
  }
}

function inlineLine(r: Row): HTMLElement {
  if (r.kind === "gap") return el("div", "md-diff-gap", r.text);
  const row = el("div", `md-diff-line ${r.kind}`);
  row.append(el("span", "md-diff-sign", SIGN[r.kind]), lineText(r));
  return row;
}

/** Rows side by side: the old text on the left, the new on the right, removed and added lines facing. */
function splitRows(list: ReturnType<typeof fold>, box: HTMLElement) {
  const grid = el("div", "md-diff-split");
  const cell = (r: Row | null, side: "old" | "new") => {
    if (!r) return el("div", `md-diff-cell empty ${side}`);
    const c = el("div", `md-diff-cell ${r.kind} ${side}`);
    c.append(lineText(r));
    return c;
  };
  for (let i = 0; i < list.length; ) {
    const r = list[i];
    if (r.kind === "fold") {
      const more = el("button", "md-diff-fold", `⋯ ${t("{n} righe uguali", { n: r.hidden.length })}`);
      more.addEventListener("click", () => {
        const at = more;
        for (const h of r.hidden) at.before(cell(h, "old"), cell(h, "new"));
        more.remove();
      });
      grid.append(more);
      i++;
    } else if (r.kind === "gap") {
      grid.append(el("div", "md-diff-gap", r.text));
      i++;
    } else if (r.kind === "same") {
      grid.append(cell(r, "old"), cell(r, "new"));
      i++;
    } else {
      const dels: Row[] = [], adds: Row[] = [];
      while (i < list.length && list[i].kind === "del") dels.push(list[i++] as Row);
      while (i < list.length && list[i].kind === "add") adds.push(list[i++] as Row);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) grid.append(cell(dels[k] ?? null, "old"), cell(adds[k] ?? null, "new"));
    }
  }
  box.append(grid);
}

function splitWanted(): boolean {
  try {
    return localStorage.getItem(SPLIT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The card: a head (file, «+N −M», In linea / Affiancate, Copia) and the rows of
 * each change. `copy`: what «Copia» copies (the diff as text).
 */
function card(title: Node | null, groups: Row[][], copy: string, cls: string): HTMLElement {
  const box = el("div", `md-diff ${cls}`);
  const head = el("div", "md-diff-head");
  const all = groups.flat();
  const added = all.filter((r) => r.kind === "add").length;
  const removed = all.filter((r) => r.kind === "del").length;
  if (title) head.append(title);
  const stat = el("span", "md-diff-stat");
  if (added) stat.append(el("span", "add", `+${added}`));
  if (removed) stat.append(el("span", "del", `−${removed}`));
  head.append(stat);
  const body = el("div", "md-diff-body");
  let split = splitWanted();
  const mode = el("button", "md-diff-btn");
  const draw = () => {
    body.replaceChildren();
    groups.forEach((rows, i) => {
      if (i > 0) body.append(el("div", "md-diff-gap", "⋯"));
      const list = fold(rows);
      if (split) splitRows(list, body);
      else inlineRows(list, body);
    });
    box.classList.toggle("split", split);
    mode.textContent = split ? t("In linea") : t("Affiancate");
    mode.title = split ? t("Righe tolte e aggiunte una sotto l'altra") : t("Prima a sinistra, dopo a destra");
  };
  mode.addEventListener("click", () => {
    split = !split;
    try { localStorage.setItem(SPLIT_KEY, split ? "1" : "0"); } catch { /* storage off: this card only */ }
    draw();
  });
  const copyBtn = el("button", "md-diff-btn", t("Copia"));
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(copy).then(() => {
      copyBtn.textContent = t("Copiato");
      window.setTimeout(() => (copyBtn.textContent = t("Copia")), 1600);
    });
  });
  // Only removed lines (a deletion) or only added (a new file) read fine in line.
  if (added && removed) head.append(mode);
  head.append(copyBtn);
  draw();
  if (all.length > TALL) box.classList.add("tall");
  box.append(head, body);
  return box;
}

/** The changes as a unified diff, for «Copia». */
function asUnified(file: string, groups: Row[][]): string {
  const out = [`--- ${file}`, `+++ ${file}`];
  for (const rows of groups) {
    out.push("@@");
    for (const r of rows) out.push(`${r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}${r.text}`);
  }
  return out.join("\n");
}

interface EditInfo {
  file?: string;
  edits?: { old?: string; new?: string }[];
  write?: boolean;
  cut?: boolean;
}

/**
 * A «```modifica» block: the file (a link with `openPath`), its changes. Null
 * when the block is not what Rust writes (then nothing is shown: it is not for
 * the user to read as code).
 */
export function editCard(json: string, openPath?: (path: string, e?: MouseEvent) => void): HTMLElement | null {
  let info: EditInfo;
  try {
    info = JSON.parse(json.trim()) as EditInfo;
  } catch {
    return null;
  }
  if (!info?.file || !Array.isArray(info.edits) || !info.edits.length) return null;
  const file = info.file;
  const groups = info.edits.map((e) => rowsOf(String(e.old ?? ""), String(e.new ?? "")));
  const name = file.split(/[\\/]/).pop() || file;
  const title = el(openPath ? "button" : "span", "md-diff-file", name);
  title.title = file;
  if (openPath) title.addEventListener("click", (e) => openPath(file, e as MouseEvent));
  const label = el("span", "md-diff-what", info.write ? t("contenuto scritto") : "");
  const head = document.createDocumentFragment();
  head.append(title, ...(info.write ? [label] : []));
  const wrap = el("span", "md-diff-title");
  wrap.append(head);
  const box = card(wrap, groups, asUnified(file, groups), "md-diff-edit");
  if (info.cut) box.append(el("div", "md-diff-note", t("Modifica lunga: qui solo l'inizio")));
  return box;
}

/**
 * A permission request's change (Edit, MultiEdit, Write and the same of
 * opencode and the chat's terminal) as editCard reads it; null for any other.
 * The same shape as Rust's steps::edit_block, texts cut alike.
 */
export function editJson(tool: string, input: Record<string, unknown>): string | null {
  const s = (...keys: string[]) => keys.map((k) => input[k]).find((v): v is string => typeof v === "string");
  const file = s("file_path", "filePath", "path");
  if (!file) return null;
  const clip = (v: string) => v.slice(0, 8000);
  let edits: { old: string; new: string }[];
  let write = false;
  if (/^(Edit|edit|edit_file)$/.test(tool)) {
    const old = s("old_string", "oldString", "old_text");
    if (old == null) return null;
    edits = [{ old: clip(old), new: clip(s("new_string", "newString", "new_text") ?? "") }];
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    edits = (input.edits as Record<string, unknown>[]).slice(0, 12).map((e) => ({ old: clip(String(e.old_string ?? "")), new: clip(String(e.new_string ?? "")) }));
  } else if (/^(Write|write|write_file)$/.test(tool) && typeof input.content === "string") {
    edits = [{ old: "", new: clip(input.content) }];
    write = true;
  } else return null;
  return JSON.stringify({ file, edits, write });
}

/** A closed «```diff» block of a reply, read as a unified diff. */
export function unifiedCard(text: string): HTMLElement {
  const { files, rows } = rowsOfUnified(text);
  const title = el("span", "md-diff-title");
  title.append(el("span", "md-diff-file", files.length ? files.map((f) => f.split(/[\\/]/).pop()).join(", ") : "diff"));
  if (files.length) title.title = files.join("\n");
  return card(title, [rows], text, "md-diff-reply");
}
