import { diagramBlock, isDiagram } from "./diagram";
import { highlightInto } from "./highlight";
import { checklist, codeFields, fieldsOf, TASK } from "./md-interactive";
import { calloutBox, calloutOf, dressTable } from "./md-rich";
import { editCard, unifiedCard } from "./md-diff";
import { t } from "./i18n";
// Claude's replies in the chat, read as markdown (HANDOFF 6.6, point 4).
//
// A small renderer, no library: it builds DOM nodes and never touches
// innerHTML, so nothing in a reply can become markup or script (the one
// exception: the colours of fenced code, highlight.ts, whose HTML highlight.js
// escapes itself). What it knows:
// headings, paragraphs, bullet and numbered lists, quotes, tables, rules,
// fenced code (with a "Copia" button), and inline **bold**, *italic*,
// ~~strike~~, `code`, [links](https://…) and bare http(s) addresses. Links
// open only when they are http(s); anything else stays text. With `openPath`,
// file paths become links too: in `code`, as [text](C:\…) or file:///, and
// bare absolute ones (C:\…, \\server\…), with an optional ":line". They carry
// `data-path`; the chat checks which exist (views/chat.ts checkPaths).

/**
 * Claude's markdown read as plain text, for a card or a ticker row: no code
 * fences, heading marks, bold, italics, strike or backticks; a link keeps its text.
 */
export function plainText(md: string): string {
  return md
    // A change to a file (steps::edit_block) is for the eye only.
    .replace(/^```modifica[ \t]*\n[\s\S]*?(?:^```[ \t]*$|$(?![\s\S]))/gm, "")
    // A diagram's code says nothing in a line of text.
    .replace(/^```(?:mermaid|mmd)[ \t]*\n[\s\S]*?(?:^```[ \t]*$|$(?![\s\S]))/gm, t("[diagramma]"))
    .replace(/^```.*$/gm, "")
    .replace(/\[!(note|tip|important|warning|caution)\]\s*/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
    // *italic*, but not a lone "*" or a "2 * 3".
    .replace(/(^|[\s(«"'])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,;:!?»"'])/gm, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Blank lines between paragraphs would take one of the four lines shown.
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** What the renderer needs from the outside (the island passes Bridge.openUrl). */
export interface MarkdownHooks {
  /** `e`: the click, for Ctrl+clic. */
  openUrl(url: string, e?: MouseEvent): void;
  /** A file path (in `code`, a link or bare absolute); `e`: the click. */
  openPath?(path: string, e?: MouseEvent): void;
  /** A block of code in a shell's language: «▶ Nel terminale» shown when true (the chat's terminal). */
  canRun?(lang: string): boolean;
  /** «▶ Nel terminale»: the code written in the chat's terminal, never run by itself. */
  runCode?(code: string, lang: string): void;
  /** «Salva»: the code into a file the user names (Windows' Save dialog). */
  saveCode?(code: string, lang: string): void;
  /** A request written in the chat's field, never sent (a step asked about, a procedure to save). */
  ask?(text: string): void;
}

/** "C:\a\b.ts", "src/app.ts", "./x.md", "~/n.txt": a path, not a word or a command. */
export function looksLikePath(s: string): boolean {
  // "app.ts:42" or "app.ts:42:7": the line does not change what it is.
  s = s.replace(/(:\d+){1,2}$/, "");
  if (s.length < 3 || s.length > 260 || /[\n<>|"*?]/.test(s) || /^\s|\s$/.test(s)) return false;
  if (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s) || /^~[\\/]/.test(s)) return true;
  if (/\s/.test(s) || /^[a-z]+:\/\//i.test(s)) return false;
  return /^(\.{1,2}[\\/])?[\w@.()+-]+([\\/][\w@.()+-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(s) && /[\\/]|\.(md|txt|ts|tsx|js|jsx|mjs|json|html?|css|scss|rs|py|cs|go|java|toml|ya?ml|csv|xml|svg|png|jpe?g|gif|pdf|ps1|bat|cmd|sh|sql|vue|svelte|php|rb|ini|env|log|lock)$/i.test(s);
}

/** Copies `text` and says so on `node` for a moment (class `copied`). */
async function copyWithMark(node: HTMLElement, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    node.classList.add("copied");
    window.setTimeout(() => node.classList.remove("copied"), 1300);
  } catch {
    /* no clipboard here: nothing happens */
  }
}

/** An inline code that copies itself with a click (an IP, a code, a command). */
function copyable(node: HTMLElement, text: string) {
  node.classList.add("md-copyable");
  node.title = t("Clic per copiare");
  node.addEventListener("click", (e) => {
    // Selecting part of it with the mouse is not a click to copy.
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    void copyWithMark(node, text);
  });
}

/** A path that opens: `node` (a <code>, or a new <span>) with `data-path`. */
function pathLink(path: string, node: HTMLElement, hooks: MarkdownHooks): HTMLElement {
  node.classList.add("md-path");
  node.dataset.path = path;
  node.title = path;
  node.addEventListener("click", (e) => {
    e.preventDefault();
    hooks.openPath?.(path, e);
  });
  return node;
}

function link(url: string, label: Node[], hooks: MarkdownHooks): HTMLElement {
  const a = el("a", "md-link");
  a.href = url;
  a.title = url;
  a.append(...label);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    hooks.openUrl(url, e);
  });
  return a;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── Inline ────────────────────────────────────────────────────────────────────

/** A character of a file or folder name in a bare path (no space, no separator, nothing a sentence wraps a path in). */
const NAME_CH = String.raw`[^\s<>"|*?\x60'«»()[\]\\/:]`;
/** A name that may hold single spaces between its words («OneDrive - Easytech SRL»). */
const SPACED = String.raw`${NAME_CH}+(?: ${NAME_CH}+)*`;
/**
 * A bare absolute path: its root, folders (spaces allowed, each ends at «\» or
 * «/»), then a file whose name may hold spaces up to its nearest extension, or
 * a last name without spaces. `(?![\w])` keeps «x.pdf» out of «x.pdfs».
 */
export const BARE_PATH = new RegExp(
  String.raw`(?<![\w\\/\x60])(?:[A-Za-z]:[\\/]|\\\\[\w.$-]+\\)(?:${SPACED}[\\/])*` +
  String.raw`(?:${NAME_CH}+?(?: ${NAME_CH}+?)*?\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w])(?!\.[A-Za-z])|${NAME_CH}*[^\s<>"|*?\x60'«»()[\].,;:!?\\/])?` +
  // «app.ts:42» or «app.ts:42:7»: the line goes with it.
  String.raw`(?::\d+(?::\d+)?)?`,
);

/** Earliest-match inline rules; `code` first so nothing inside it is parsed. */
const INLINE: { re: RegExp; make: (m: RegExpExecArray, hooks: MarkdownHooks) => Node }[] = [
  {
    re: /`([^`\n]+)`/,
    make: (m, hooks) => {
      const code = el("code", "md-code", m[1]);
      const text = m[1].trim();
      if (/^https?:\/\/\S+$/i.test(text)) return link(text, [code], hooks);
      if (hooks.openPath && looksLikePath(text)) return pathLink(text, code, hooks);
      // In the chat: an IP, a code, a short command copied with one click (24 Nov 2026, Edoardo's concept).
      if (hooks.openPath) copyable(code, text);
      return code;
    },
  },
  {
    // [text](C:\a b\c.pdf) and [text](<C:\a b\c.pdf>) too: a Windows path may hold spaces.
    re: /\[([^\]\n]+)\]\((<[^>\n]+>|[A-Za-z]:[\\/][^)\n]+|\\\\[^)\n]+|[^)\s]+)\)/,
    make: (m, hooks) => {
      const url = m[2].replace(/^<(.*)>$/, "$1").trim();
      // [text](C:\…) or [text](file:///C:/…): a path.
      const file = url.match(/^file:\/\/\/(.+)$/i)?.[1];
      if (hooks.openPath && (file || /^([A-Za-z]:[\\/]|\\\\|~[\\/])/.test(url))) {
        let path = url;
        if (file) {
          try { path = decodeURIComponent(file).replace(/\//g, "\\"); } catch { path = file; }
        }
        const span = el("span");
        span.append(...inline(m[1], hooks));
        return pathLink(path, span, hooks);
      }
      if (!/^https?:\/\//i.test(url)) return document.createTextNode(m[1]);
      return link(url, inline(m[1], hooks), hooks);
    },
  },
  // A bare address; the punctuation after it stays text.
  {
    re: /\bhttps?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"»]/i,
    make: (m, hooks) => link(m[0], [document.createTextNode(m[0])], hooks),
  },
  // A bare relative path with backslashes and an extension (WORK\Cardinalini\x.sh,
  // 17 Nov 2026): a link only if the chat finds it (views/chat.ts checkPaths,
  // `data-bare`: otherwise plain text again). The full stop after it stays text.
  {
    re: /(?<![\w\\/`:.])(?:[\w@()+-][\w@.()+-]*\\)+[\w@()+-][\w@.()+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w\\/])/,
    make: (m, hooks) => {
      if (!hooks.openPath) return document.createTextNode(m[0]);
      const span = pathLink(m[0], el("span", "", m[0]), hooks);
      span.dataset.bare = "1";
      return span;
    },
  },
  // A bare absolute path (C:\…, C:/…, \\server\share\…), spaces too (24 Nov
  // 2026, Edoardo: «OneDrive - Easytech SRL\…» was cut at the first space and
  // the click did nothing): folders may hold spaces up to their «\»; the last
  // name runs to its extension (the nearest one), or without one to a space.
  // The punctuation after it stays text.
  {
    re: BARE_PATH,
    make: (m, hooks) => hooks.openPath ? pathLink(m[0], el("span", "", m[0]), hooks) : document.createTextNode(m[0]),
  },
  { re: /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/, make: (m, hooks) => wrap("strong", m[1] ?? m[2], hooks) },
  { re: /~~([^~\n]+?)~~/, make: (m, hooks) => wrap("s", m[1], hooks) },
  // Single * or _ around a word, not inside one (snake_case, 2*3*4 stay as they are).
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/, make: (m, hooks) => wrap("em", m[1] ?? m[2], hooks) },
];

function wrap(tag: "strong" | "em" | "s", text: string, hooks: MarkdownHooks): Node {
  const e = el(tag);
  e.append(...inline(text, hooks));
  return e;
}

export function inline(text: string, hooks: MarkdownHooks): Node[] {
  const out: Node[] = [];
  let rest = text;
  while (rest) {
    let best: { m: RegExpExecArray; rule: (typeof INLINE)[number] } | null = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(document.createTextNode(rest));
      break;
    }
    if (best.m.index > 0) out.push(document.createTextNode(rest.slice(0, best.m.index)));
    out.push(best.rule.make(best.m, hooks));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A table line's cells; "\|" is a bar inside a cell. */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** A cell's content: "<br>" is the only way a table row can hold a line break. */
function cellNodes(text: string, hooks: MarkdownHooks): Node[] {
  const out: Node[] = [];
  text.split(/<br\s*\/?>/i).forEach((part, i) => {
    if (i > 0) out.push(el("br"));
    out.push(...inline(part.trim(), hooks));
  });
  return out;
}

function codeBlock(source: string, lang: string, hooks: MarkdownHooks): HTMLElement {
  const box = el("div", "md-pre");
  // With {{Nome}} fields: what is copied, saved or run is the code as filled in (md-interactive.ts).
  let code = source;
  const head = el("div", "md-pre-head");
  const copy = el("button", "md-copy", t("Copia"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "Copiato ✓";
    } catch {
      copy.textContent = t("Non riuscito");
    }
    window.setTimeout(() => (copy.textContent = t("Copia")), 1600);

  });
  const label = el("span", "md-lang", lang);
  head.append(label);
  // The outputs of a step (claude_cli.rs result_block) are not code to keep or run.
  const output = lang === "esito" || lang === "errore";
  let runBtn: HTMLButtonElement | null = null;
  if (!output && hooks.runCode && hooks.canRun?.(lang)) {
    const run = el("button", "md-copy md-run", `▶ ${t("Nel terminale")}`);
    run.title = t("Scrive il codice nel terminale della chat: lo esegui tu con Invio");
    run.addEventListener("click", () => hooks.runCode?.(code, lang));
    head.append(run);
    runBtn = run;
  }
  if (!output && hooks.saveCode) {
    const save = el("button", "md-copy md-save", t("Salva"));
    save.title = t("Salva il codice in un file");
    save.addEventListener("click", () => hooks.saveCode?.(code, lang));
    head.append(save);
  }
  head.append(copy);
  const pre = el("pre");
  const body = el("code");
  // Colours by language (highlight.ts); a guessed one is named in the head.
  const used = highlightInto(body, code, lang);
  if (!lang && used) label.textContent = used;
  pre.append(body);
  box.append(head, pre);
  if (!output && hooks.openPath && fieldsOf(source).length) {
    box.insertBefore(codeFields(source, (filled, complete) => {
      code = filled;
      highlightInto(body, filled, used || lang);
      if (runBtn) {
        runBtn.disabled = !complete;
        runBtn.title = complete ? t("Scrive il codice nel terminale della chat: lo esegui tu con Invio") : t("Completa prima i campi sopra il codice");
      }
    }), pre);
  }
  return box;
}

/**
 * Long replies with sections (at least three titles): a row of their names on
 * top that scrolls to each (Edoardo's concept, 24 Nov 2026: «Sezioni»).
 */
function outline(blocks: HTMLElement[]): HTMLElement | null {
  const heads = blocks.filter((b) => b.classList.contains("md-h1") || b.classList.contains("md-h2"));
  if (heads.length < 3) return null;
  const row = el("div", "md-outline");
  row.append(el("span", "md-outline-label", t("Sezioni")));
  for (const hEl of heads) {
    const chip = el("button", "md-outline-chip", (hEl.textContent ?? "").trim().slice(0, 40));
    chip.addEventListener("click", () => hEl.scrollIntoView({ behavior: "smooth", block: "start" }));
    row.append(chip);
  }
  return row;
}

/** Renders a whole reply (with its sections' row when it has several, in the chat). */
export function renderMarkdown(text: string, hooks: MarkdownHooks): HTMLElement[] {
  const blocks = renderBlocks(text, hooks);
  const row = hooks.openPath ? outline(blocks) : null;
  return row ? [row, ...blocks] : blocks;
}

function renderBlocks(text: string, hooks: MarkdownHooks): HTMLElement[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: HTMLElement[] = [];
  let para: string[] = [];

  const flush = () => {
    if (!para.length) return;
    const p = el("p", "md-p");
    para.forEach((line, i) => {
      if (i > 0) p.append(el("br"));
      p.append(...inline(line.trim(), hooks));
    });
    blocks.push(p);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      const closed = i < lines.length;
      // A change to a file (steps::edit_block): drawn as lines removed and added, never as its JSON.
      if (fence[2] === "modifica") {
        const card = closed ? editCard(body.join("\n"), hooks.openPath) : null;
        if (card) blocks.push(card);
        continue;
      }
      // A unified diff, once closed: the same card.
      if ((fence[2] === "diff" || fence[2] === "patch") && closed && body.some((l) => /^[-+]/.test(l))) {
        blocks.push(unifiedCard(body.join("\n")));
        continue;
      }
      const block = codeBlock(body.join("\n"), fence[2], hooks);
      // A diagram only once its block is closed: while it streams in it is code.
      blocks.push(isDiagram(fence[2]) && i < lines.length ? diagramBlock(body.join("\n"), block, hooks.saveCode) : block);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const hEl = el("div", `md-h md-h${Math.min(heading[1].length, 3)}`);
      hEl.append(...inline(heading[2], hooks));
      blocks.push(hEl);
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push(el("hr", "md-hr"));
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const start = i;
      const table = el("table", "md-table");
      const thead = el("thead");
      const head = el("tr");
      const rows: string[][] = [cells(line)];
      for (const c of rows[0]) {
        const th = el("th");
        th.append(...cellNodes(c, hooks));
        head.append(th);
      }
      thead.append(head);
      const tbody = el("tbody");
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
        const tr = el("tr");
        const row = cells(lines[i]);
        rows.push(row);
        for (const c of row) {
          const td = el("td");
          td.append(...cellNodes(c, hooks));
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const wrapEl = el("div", "md-table-wrap");
      wrapEl.append(table);
      dressTable(table, wrapEl, rows, lines[start + 1]);
      i--;
      if (hooks.openPath) {
        // «Copia tabella»: tab-separated, as Excel and RDM paste it.
        const plain = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/`([^`]*)`/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").trim();
        const tsv = rows.map((r) => r.map(plain).join("\t")).join("\n");
        const copy = el("button", "md-table-copy", t("Copia tabella"));
        copy.title = t("Copia la tabella, da incollare in Excel o in un'altra tabella");
        copy.addEventListener("click", () => void copyWithMark(copy, tsv));
        const box = el("div", "md-table-box");
        box.append(copy, wrapEl);
        blocks.push(box);
      } else blocks.push(wrapEl);
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1]);
      i--;
      // «Attenzione: …», «Nota: …», «⚠️ …», «[!WARNING]»: a coloured box with its icon and title (md-rich.ts).
      const notice = /^\s*(⚙|💭)/u.test(quoted[0] ?? "") ? null : calloutOf(quoted);
      if (notice) {
        blocks.push(calloutBox(notice.kind, renderBlocks(notice.lines.join("\n"), hooks)));
        continue;
      }
      const q = el("blockquote", "md-quote");
      q.append(...renderBlocks(quoted.join("\n"), hooks));
      blocks.push(q);
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      flush();
      const ordered = !BULLET.test(line);
      const list = el(ordered ? "ol" : "ul", "md-list");
      const first = NUMBERED.exec(line);
      if (ordered && first && first[2] !== "1") list.setAttribute("start", first[2]);
      let item: HTMLLIElement | null = null;
      for (; i < lines.length; i++) {
        const b = BULLET.exec(lines[i]);
        const n = NUMBERED.exec(lines[i]);
        const m = ordered ? n : b;
        if (m) {
          const depth = Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2));
          item = el("li");
          if (depth) item.style.marginLeft = `${depth * 14}px`;
          let text = m[ordered ? 3 : 2];
          const task = TASK.exec(text);
          if (task) {
            text = task[2];
            item.dataset.task = task[1].toLowerCase();
            item.dataset.text = text.trim();
          }
          item.append(...inline(text, hooks));
          list.append(item);
        } else if ((b || n) && item) {
          // The other kind of list nested inside: an indented item of this one.
          const other = (b ?? n)!;
          const nested = el("li");
          nested.style.marginLeft = "14px";
          nested.append(...inline(other[b ? 2 : 3], hooks));
          list.append(nested);
        } else if (item && /^\s{2,}\S/.test(lines[i])) {
          // A continuation line of the item.
          item.append(el("br"), ...inline(lines[i].trim(), hooks));
        } else {
          break;
        }
      }
      i--;
      // A procedure: steps to tick (md-interactive.ts).
      blocks.push(list.querySelector(":scope > li[data-task]") ? checklist(list, hooks.ask) : list);
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
