import { t } from "./i18n";
// Claude's replies in the chat, read as markdown (HANDOFF 6.6, point 4).
//
// A small renderer, no library: it builds DOM nodes and never touches
// innerHTML, so nothing in a reply can become markup or script. What it knows:
// headings, paragraphs, bullet and numbered lists, quotes, tables, rules,
// fenced code (with a "Copia" button), and inline **bold**, *italic*,
// ~~strike~~, `code` and [links](https://…). Links open in the browser only
// when they are http(s); anything else stays text.

/**
 * Claude's markdown read as plain text, for a card or a ticker row: no code
 * fences, heading marks, bold, italics, strike or backticks; a link keeps its text.
 */
export function plainText(md: string): string {
  return md
    .replace(/^```.*$/gm, "")
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
  openUrl(url: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── Inline ────────────────────────────────────────────────────────────────────

/** Earliest-match inline rules; `code` first so nothing inside it is parsed. */
const INLINE: { re: RegExp; make: (m: RegExpExecArray, hooks: MarkdownHooks) => Node }[] = [
  { re: /`([^`\n]+)`/, make: (m) => el("code", "md-code", m[1]) },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    make: (m, hooks) => {
      const url = m[2];
      if (!/^https?:\/\//i.test(url)) return document.createTextNode(m[1]);
      const a = el("a", "md-link");
      a.href = url;
      a.title = url;
      a.append(...inline(m[1], hooks));
      a.addEventListener("click", (e) => {
        e.preventDefault();
        hooks.openUrl(url);
      });
      return a;
    },
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

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function codeBlock(code: string, lang: string): HTMLElement {
  const box = el("div", "md-pre");
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
  head.append(el("span", "md-lang", lang), copy);
  const pre = el("pre");
  pre.append(el("code", undefined, code));
  box.append(head, pre);
  return box;
}

/** Renders a whole reply. */
export function renderMarkdown(text: string, hooks: MarkdownHooks): HTMLElement[] {
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
      blocks.push(codeBlock(body.join("\n"), fence[2]));
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
      const table = el("table", "md-table");
      const head = el("tr");
      for (const c of cells(line)) {
        const th = el("th");
        th.append(...inline(c, hooks));
        head.append(th);
      }
      table.append(head);
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
        const tr = el("tr");
        for (const c of cells(lines[i])) {
          const td = el("td");
          td.append(...inline(c, hooks));
          tr.append(td);
        }
        table.append(tr);
      }
      i--;
      const wrapEl = el("div", "md-table-wrap");
      wrapEl.append(table);
      blocks.push(wrapEl);
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1]);
      i--;
      const q = el("blockquote", "md-quote");
      q.append(...renderMarkdown(quoted.join("\n"), hooks));
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
          item.append(...inline(m[ordered ? 3 : 2], hooks));
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
      blocks.push(list);
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
