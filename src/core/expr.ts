// The formulas of the user's own integrations (custom.rs, src/views/custom.ts):
// a small language read here, never eval. Numbers (Italian "1.234,5" or
// "0.22"), "texts", true/false, names of fields (and a.b paths in data),
// + - * / % ( ), comparisons (= == != <> < <= > >=), and/or/not (also && || !),
// and the functions below. Arguments are separated by ";" or by ", " (a comma
// between two digits is a decimal comma: 0,22). A name nobody knows reads as
// its own text, so pagamento=Bonifico works without quotes.

export type Val = number | string | boolean | null | Val[] | { [k: string]: Val };

type Tok = { k: "num"; v: number } | { k: "str"; v: string } | { k: "id"; v: string } | { k: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      // 1234 · 1.234,56 · 0,22 · 3.5 — a comma counts only between digits.
      const m = /^(\d{1,3}(?:\.\d{3})+(?![\d.])(?:,\d+)?|\d+\.\d+|\d+(?:,\d+)?|\.\d+)/.exec(src.slice(i))!;
      const text = m[0];
      const v = text.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(text) ? Number(text.replace(/\./g, "").replace(",", ".")) : Number(text);
      out.push({ k: "num", v });
      i += text.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "«") {
      const end = c === "«" ? "»" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== end) s += src[j++];
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    const id = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*(?:\.[A-Za-zÀ-ÿ0-9_]+)*/.exec(src.slice(i));
    if (id) {
      out.push({ k: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "<>", "&&", "||"].includes(two)) {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%()<>=!;,".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`carattere inatteso «${c}»`);
  }
  return out;
}

type Node =
  | { t: "lit"; v: Val }
  | { t: "name"; v: string }
  | { t: "un"; op: string; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; f: string; args: Node[] };

type Call = Extract<Node, { t: "call" }>;

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => peek()?.k === "op" && ops.includes(peek()!.v as string);
  const isWord = (...w: string[]) => peek()?.k === "id" && w.includes((peek()!.v as string).toLowerCase());
  const expect = (op: string) => {
    if (!isOp(op)) throw new Error(`manca «${op}»`);
    p++;
  };
  function or(): Node {
    let a = and();
    while (isOp("||") || isWord("or", "o")) {
      p++;
      a = { t: "bin", op: "||", a, b: and() };
    }
    return a;
  }
  function and(): Node {
    let a = cmp();
    while (isOp("&&") || isWord("and", "e")) {
      p++;
      a = { t: "bin", op: "&&", a, b: cmp() };
    }
    return a;
  }
  function cmp(): Node {
    const a = add();
    if (isOp("=", "==", "!=", "<>", "<", "<=", ">", ">=")) {
      const op = toks[p++].v as string;
      return { t: "bin", op, a, b: add() };
    }
    return a;
  }
  function add(): Node {
    let a = mul();
    while (isOp("+", "-")) {
      const op = toks[p++].v as string;
      a = { t: "bin", op, a, b: mul() };
    }
    return a;
  }
  function mul(): Node {
    let a = unary();
    while (isOp("*", "/", "%")) {
      const op = toks[p++].v as string;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp("-", "!") || isWord("not", "non")) {
      const op = (toks[p++].v as string) === "-" ? "-" : "!";
      return { t: "un", op, a: unary() };
    }
    return primary();
  }
  function primary(): Node {
    const tk = peek();
    if (!tk) throw new Error("formula incompleta");
    if (tk.k === "num" || tk.k === "str") {
      p++;
      return { t: "lit", v: tk.v };
    }
    if (tk.k === "op" && tk.v === "(") {
      p++;
      const e = or();
      expect(")");
      return e;
    }
    if (tk.k === "id") {
      p++;
      const word = tk.v.toLowerCase();
      if (word === "true" || word === "vero") return { t: "lit", v: true };
      if (word === "false" || word === "falso") return { t: "lit", v: false };
      if (isOp("(")) {
        p++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(or());
          while (isOp(";", ",")) {
            p++;
            args.push(or());
          }
        }
        expect(")");
        return { t: "call", f: word, args };
      }
      return { t: "name", v: tk.v };
    }
    throw new Error(`«${tk.v}» fuori posto`);
  }
  const node = or();
  if (p < toks.length) throw new Error(`«${toks[p].v}» fuori posto`);
  return node;
}

const cache = new Map<string, Node>();

function compiled(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = parse(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, n);
  }
  return n;
}

/** A value as a number ("1.234,5" texts too); null when it is not one. */
export function num(v: Val): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim()) {
    const s = v.trim().replace(/\s*€$/, "");
    const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function truthy(v: Val): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "" && v !== "false";
  if (typeof v === "number") return v !== 0;
  return v === true || (v != null && typeof v === "object");
}

function text(v: Val): string {
  if (v == null) return "";
  if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
  if (Array.isArray(v)) return v.map(text).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** "2026-10-23" → days since 1970 (local calendar); null when it is not a date. */
function day(v: Val): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

function isoDay(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A path in data: "cliente.nome", "items.0.prezzo". */
export function pick(obj: Val, path: string): Val {
  if (!path) return obj;
  let cur: Val = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = Array.isArray(cur) ? (cur[Number(part)] ?? null) : (cur[part] ?? null);
  }
  return cur;
}

/** Where names are looked up: the row of a table first, then the values. */
export interface Scope {
  get(name: string): Val | undefined;
  /** The tables (name → rows), for sum/avg/count/minrow/maxrow over their rows. */
  tables?: Record<string, Val[]>;
}

function names(n: Node, out: Set<string>) {
  if (n.t === "name") out.add(n.v.split(".")[0]);
  else if (n.t === "un") names(n.a, out);
  else if (n.t === "bin") {
    names(n.a, out);
    names(n.b, out);
  } else if (n.t === "call") n.args.forEach((a) => names(a, out));
}

function evaluate(n: Node, scope: Scope): Val {
  switch (n.t) {
    case "lit":
      return n.v;
    case "name": {
      const v = scope.get(n.v);
      // Unknown: its own text (pagamento=Bonifico).
      return v === undefined ? n.v : v;
    }
    case "un": {
      const a = evaluate(n.a, scope);
      return n.op === "-" ? -(num(a) ?? 0) : !truthy(a);
    }
    case "bin": {
      if (n.op === "&&") return truthy(evaluate(n.a, scope)) && truthy(evaluate(n.b, scope));
      if (n.op === "||") return truthy(evaluate(n.a, scope)) || truthy(evaluate(n.b, scope));
      const a = evaluate(n.a, scope);
      const b = evaluate(n.b, scope);
      const na = num(a);
      const nb = num(b);
      switch (n.op) {
        case "+":
          return na != null && nb != null ? na + nb : text(a) + text(b);
        case "-":
          return (na ?? 0) - (nb ?? 0);
        case "*":
          return (na ?? 0) * (nb ?? 0);
        case "/":
          return nb ? (na ?? 0) / nb : null;
        case "%":
          return nb ? (na ?? 0) % nb : null;
        case "=":
        case "==":
          return na != null && nb != null ? na === nb : text(a).toLowerCase() === text(b).toLowerCase();
        case "!=":
        case "<>":
          return na != null && nb != null ? na !== nb : text(a).toLowerCase() !== text(b).toLowerCase();
        default: {
          // Dates compare as dates, numbers as numbers, the rest as text.
          const da = day(a);
          const db = day(b);
          const [x, y] = da != null && db != null ? [da, db] : na != null && nb != null ? [na, nb] : [text(a), text(b)];
          return n.op === "<" ? x < y : n.op === "<=" ? x <= y : n.op === ">" ? x > y : x >= y;
        }
      }
    }
    case "call":
      return call(n, scope);
  }
}

/** For sum/avg/count/minrow/maxrow: the table the expression names, its rows. */
function rowsFor(arg: Node, scope: Scope): { rows: Val[]; table: string } | null {
  const tables = scope.tables ?? {};
  if (arg.t === "name" && tables[arg.v]) return { rows: tables[arg.v], table: arg.v };
  const used = new Set<string>();
  names(arg, used);
  for (const [table, rows] of Object.entries(tables)) {
    const first = rows.find((r) => r && typeof r === "object") as Record<string, Val> | undefined;
    // A table whose rows have one of the names (or the table named explicitly).
    if (used.has(table) || (first && [...used].some((u) => u in first))) return { rows, table };
  }
  return null;
}

function overRows(n: Call, scope: Scope): number[] {
  const arg = n.args[0];
  if (!arg) return [];
  const found = rowsFor(arg, scope);
  if (!found) return [];
  if (arg.t === "name" && arg.v === found.table) return found.rows.map(() => 1);
  return found.rows.map((row) => {
    const r = (row ?? {}) as Record<string, Val>;
    const inner: Scope = { get: (k) => (k in r ? r[k] : scope.get(k)), tables: scope.tables };
    return num(evaluate(arg, inner)) ?? 0;
  });
}

function call(n: Call, scope: Scope): Val {
  const a = (i: number) => (n.args[i] ? evaluate(n.args[i], scope) : null);
  const nums = () => n.args.map((_, i) => num(a(i))).filter((x): x is number => x != null);
  switch (n.f) {
    case "if":
    case "se":
      return truthy(a(0)) ? a(1) : a(2);
    case "round":
    case "arrotonda": {
      const d = Math.max(0, Math.min(6, num(a(1)) ?? 0));
      const f = 10 ** d;
      return Math.round((num(a(0)) ?? 0) * f) / f;
    }
    case "floor":
      return Math.floor(num(a(0)) ?? 0);
    case "ceil":
      return Math.ceil(num(a(0)) ?? 0);
    case "abs":
      return Math.abs(num(a(0)) ?? 0);
    case "min":
      return nums().length ? Math.min(...nums()) : null;
    case "max":
      return nums().length ? Math.max(...nums()) : null;
    case "sum":
    case "somma":
      return overRows(n, scope).reduce((x, y) => x + y, 0);
    case "avg":
    case "media": {
      const v = overRows(n, scope);
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
    }
    case "count":
    case "conta": {
      if (!n.args[0]) return 0;
      const found = rowsFor(n.args[0], scope);
      if (found && !(n.args[0].t === "name" && n.args[0].v === found.table)) return overRows(n, scope).filter((x) => x !== 0).length;
      return found ? found.rows.length : Array.isArray(a(0)) ? (a(0) as Val[]).length : 0;
    }
    case "today":
    case "oggi":
      return todayIso();
    case "days":
    case "giorni": {
      const x = day(a(0));
      const y = day(a(1) ?? todayIso());
      return x != null && y != null ? y - x : null;
    }
    case "adddays":
    case "piugiorni": {
      const x = day(a(0));
      return x == null ? null : isoDay(x + (num(a(1)) ?? 0));
    }
    case "year":
    case "anno":
      return day(a(0)) == null ? null : Number(String(a(0)).slice(0, 4));
    case "month":
    case "mese":
      return day(a(0)) == null ? null : Number(String(a(0)).slice(5, 7));
    case "upper":
    case "maiuscolo":
      return text(a(0)).toUpperCase();
    case "lower":
    case "minuscolo":
      return text(a(0)).toLowerCase();
    case "len":
    case "lunghezza":
      return Array.isArray(a(0)) ? (a(0) as Val[]).length : text(a(0)).length;
    case "concat":
    case "unisci":
      return n.args.map((_, i) => text(a(i))).join("");
    case "contains":
    case "contiene": {
      const x = a(0);
      return Array.isArray(x) ? x.some((v) => text(v).toLowerCase() === text(a(1)).toLowerCase()) : text(x).toLowerCase().includes(text(a(1)).toLowerCase());
    }
    case "empty":
    case "vuoto":
      return !truthy(a(0));
    case "number":
    case "numero":
      return num(a(0));
    case "text":
    case "testo":
      return text(a(0));
    default:
      throw new Error(`funzione sconosciuta «${n.f}»`);
  }
}

/** A formula over a scope; throws with a short reason when it cannot be read. */
export function run(src: string, scope: Scope): Val {
  return evaluate(compiled(src), scope);
}

/** The same, null on any error (the card shows "—"). */
export function tryRun(src: string, scope: Scope): Val {
  try {
    return run(src, scope);
  } catch {
    return null;
  }
}

/** The reason a formula cannot be read, or "" when it can. */
export function check(src: string): string {
  try {
    compiled(src);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

/** A scope over plain values and their tables (fields of kind rows). */
export function scopeOf(values: Record<string, unknown>, tables: string[] = []): Scope {
  const t: Record<string, Val[]> = {};
  for (const name of tables) if (Array.isArray(values[name])) t[name] = values[name] as Val[];
  return {
    get: (k) => {
      if (k in values) return values[k] as Val;
      const v = pick(values as Val, k);
      return v === null ? undefined : v;
    },
    tables: t,
  };
}
