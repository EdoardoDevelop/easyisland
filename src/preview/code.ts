// What the preview draws for a file without the browser: code with line
// numbers and colours (a small tokenizer per language family, no library),
// the changes as a line diff, and CSV as a table. HTML is built from escaped
// text only: nothing in a file can become markup.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Family = "c" | "py" | "sh" | "markup" | "css" | "data" | "sql" | "plain";

const FAMILY: Record<string, Family> = {
  ts: "c", tsx: "c", js: "c", jsx: "c", mjs: "c", cjs: "c", rs: "c", go: "c", java: "c", cs: "c", c: "c", h: "c",
  cpp: "c", hpp: "c", kt: "c", swift: "c", php: "c", dart: "c", scala: "c", vue: "c", svelte: "c",
  py: "py", rb: "py", toml: "py", yaml: "py", yml: "py", ini: "py", cfg: "py", env: "py", r: "py",
  sh: "sh", bash: "sh", ps1: "sh", psm1: "sh", bat: "sh", cmd: "sh",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", xhtml: "markup", md: "markup", markdown: "markup",
  css: "css", scss: "css", less: "css",
  json: "data", jsonc: "data", lock: "data",
  sql: "sql",
};

const KEYWORDS: Partial<Record<Family, string[]>> = {
  c: ["abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "crate", "default", "defer",
    "delete", "do", "else", "enum", "export", "extends", "false", "finally", "fn", "for", "from", "func", "function", "go", "if",
    "impl", "implements", "import", "in", "instanceof", "interface", "let", "loop", "match", "mod", "move", "mut", "namespace",
    "new", "null", "package", "private", "protected", "pub", "public", "readonly", "ref", "return", "self", "Self", "static",
    "struct", "super", "switch", "this", "throw", "trait", "true", "try", "type", "typeof", "undefined", "unsafe", "use", "var",
    "void", "where", "while", "yield", "using", "void", "int", "bool", "string", "char", "float", "double", "long"],
  py: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "end", "except",
    "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield", "true", "false", "module", "require", "self"],
  sh: ["if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case", "esac", "function", "return", "in", "echo",
    "exit", "set", "param", "foreach", "switch", "try", "catch", "finally", "throw", "call", "goto", "rem", "true", "false", "null"],
  sql: ["select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table",
    "drop", "alter", "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit", "as", "null",
    "primary", "key", "foreign", "references", "index", "distinct", "union", "case", "when", "then", "else", "end"],
};

/** One regex per family; the groups say what was matched. */
function lexer(f: Family): RegExp | null {
  const str = `"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?`;
  const num = `\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[0-9a-f]+\\b`;
  switch (f) {
    case "c":
      return new RegExp(`(\\/\\/.*|\\/\\*.*?(?:\\*\\/|$))|(${str}|\`(?:[^\`\\\\]|\\\\.)*\`?)|(${num})|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)`, "gi");
    case "py":
      return new RegExp(`(#.*)|(${str})|(${num})|([A-Za-z_][\\w]*)(?=\\s*\\()|([A-Za-z_][\\w-]*)`, "gi");
    case "sh":
      return new RegExp(`(#.*|^\\s*(?:rem|::)\\b.*)|(${str})|(${num})|(\\$[\\w:]+|%\\w+%)|([A-Za-z_][\\w-]*)`, "gi");
    case "sql":
      return new RegExp(`(--.*)|(${str})|(${num})|()([A-Za-z_][\\w]*)`, "gi");
    case "css":
      return new RegExp(`(\\/\\*.*?(?:\\*\\/|$))|(${str})|(#[0-9a-f]{3,8}\\b|${num}(?:px|em|rem|%|vh|vw|s|ms)?)|([\\w-]+)(?=\\s*:)|([.#]?[A-Za-z_-][\\w-]*)`, "gi");
    case "data":
      return new RegExp(`(\\/\\/.*)|("(?:[^"\\\\]|\\\\.)*")(?=\\s*:)|(${str})|(${num}|\\btrue\\b|\\bfalse\\b|\\bnull\\b)|()`, "gi");
    case "markup":
      return /(<!--.*?(?:-->|$))|(<\/?[\w:-]+|\/?>)|("[^"]*"|'[^']*')|(&\w+;)|([\w:-]+)(?==)|(^#{1,6} .*|`[^`]*`)/gi;
    default:
      return null;
  }
}

function highlightLine(line: string, f: Family, re: RegExp | null): string {
  if (!re) return escapeHtml(line);
  const words = new Set((KEYWORDS[f] ?? []).map((k) => (f === "sql" ? k : k)));
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    out += escapeHtml(line.slice(last, m.index));
    const text = escapeHtml(m[0]);
    let cls = "";
    if (f === "markup") {
      cls = m[1] ? "cm" : m[2] ? "kw" : m[3] ? "st" : m[4] ? "nu" : m[5] ? "fn" : m[6] ? "hd" : "";
    } else if (f === "data") {
      cls = m[1] ? "cm" : m[2] ? "fn" : m[3] ? "st" : m[4] ? "nu" : "";
    } else {
      const word = m[5] ?? "";
      const isKw = word && (words.has(word) || (f === "sql" && words.has(word.toLowerCase())) || (f === "sh" && words.has(word.toLowerCase())));
      cls = m[1] ? "cm" : m[2] ? "st" : m[3] ? "nu" : m[4] ? "fn" : isKw ? "kw" : /^[A-Z][A-Za-z0-9]*$/.test(word) && f === "c" ? "ty" : "";
    }
    out += cls ? `<span class="${cls}">${text}</span>` : text;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(line.slice(last));
}

export function familyOf(ext: string): Family {
  return FAMILY[ext.toLowerCase()] ?? "plain";
}

/** Code as two columns: numbers and lines (HTML of escaped text). */
export function codeHtml(text: string, ext: string, maxLines = 20000): { numbers: string; lines: string; cut: boolean } {
  const f = familyOf(ext);
  const re = lexer(f);
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  const cut = all.length > maxLines;
  const shown = cut ? all.slice(0, maxLines) : all;
  const numbers: string[] = [];
  const lines: string[] = [];
  shown.forEach((line, i) => {
    numbers.push(String(i + 1));
    // Very long lines (minified files) are not coloured.
    lines.push(line.length > 2000 ? escapeHtml(line) : highlightLine(line, f, re) || " ");
  });
  return { numbers: numbers.join("\n"), lines: lines.join("\n"), cut };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export interface DiffLine {
  op: " " | "+" | "-";
  text: string;
  old: number;
  new: number;
}

/** A line diff of two texts (common ends trimmed, LCS in the middle). */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.replace(/\r\n?/g, "\n").split("\n");
  const y = b.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: " ", text: x[i], old: i + 1, new: i + 1 });
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  const middle: DiffLine[] = [];
  if (mx.length * my.length > 4_000_000) {
    mx.forEach((t, i) => middle.push({ op: "-", text: t, old: start + i + 1, new: 0 }));
    my.forEach((t, i) => middle.push({ op: "+", text: t, old: 0, new: start + i + 1 }));
  } else {
    // LCS table, filled from the end.
    const n = mx.length;
    const m = my.length;
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = mx[i] === my[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && mx[i] === my[j]) {
        middle.push({ op: " ", text: mx[i], old: start + i + 1, new: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        // What went comes before what came, as in every diff.
        middle.push({ op: "-", text: mx[i], old: start + i + 1, new: 0 });
        i++;
      } else {
        middle.push({ op: "+", text: my[j], old: 0, new: start + j + 1 });
        j++;
      }
    }
  }
  out.push(...middle);
  const shift = y.length - x.length;
  for (let i = endX; i < x.length; i++) out.push({ op: " ", text: x[i], old: i + 1, new: i + 1 + shift });
  return out;
}

/** Only the changes with `context` lines around them; null marks a gap. */
export function hunks(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.op === " ") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap && out.length) out.push(null);
      gap = false;
      out.push(l);
    } else {
      gap = true;
    }
  });
  return out;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Rows of a CSV (comma, semicolon or tab, quotes allowed), `max` at most. */
export function csvRows(text: string, max = 1000): string[][] {
  const first = text.slice(0, text.indexOf("\n") >>> 0 || text.length);
  const sep = [";", "\t", ","].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
