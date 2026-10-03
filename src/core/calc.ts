// The calculator in the chat field: "120*1,22", "15% di 840", "840 + 22%",
// "(3+4)^2", "1.234,50 / 3". Computed here, no eval and nothing sent anywhere.
//
// Numbers are read the Italian way: a comma is the decimal separator and dots
// group thousands ("1.234,5"); without a comma a dot is a decimal point
// ("3.5"), unless it groups exactly three digits ("1.234" = 1234).
//
// Percentages work like a pocket calculator: "a + b%" = a + a·b/100,
// "a - b%" = a − a·b/100, "b% di a" = a·b/100, a lone "b%" = b/100.

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "pct" }
  | { t: "of" }
  | { t: "(" }
  | { t: ")" };

function parseNumber(raw: string): number | null {
  let s = raw;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function tokenize(input: string): Tok[] | null {
  const s = input
    .toLowerCase()
    .replace(/[×x·]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/−/g, "-")
    .replace(/\*\*/g, "^");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "=") {
      i++;
      continue;
    }
    const num = /^\d[\d.,]*/.exec(s.slice(i)) ?? /^[.,]\d+/.exec(s.slice(i));
    if (num) {
      const v = parseNumber(num[0].startsWith(",") || num[0].startsWith(".") ? `0${num[0]}` : num[0]);
      if (v == null) return null;
      out.push({ t: "num", v });
      i += num[0].length;
      continue;
    }
    const word = /^(di|del|della|dello|dei|of)\b/.exec(s.slice(i));
    if (word) {
      out.push({ t: "of" });
      i += word[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) out.push({ t: "op", v: c as "+" });
    else if (c === "%") out.push({ t: "pct" });
    else if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else return null;
    i++;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  done(): boolean {
    return this.i >= this.toks.length;
  }

  // expr := term (("+"|"-") term ["%"])*
  expr(): number {
    let left = this.term();
    for (;;) {
      const p = this.peek();
      if (p?.t !== "op" || (p.v !== "+" && p.v !== "-")) return left;
      this.i++;
      const right = this.term();
      // "840 + 22%": the percentage is of the left side.
      const pctOfLeft = this.lastWasPercent;
      const amount = pctOfLeft ? left * right : right;
      left = p.v === "+" ? left + amount : left - amount;
    }
  }

  private lastWasPercent = false;

  // term := factor (("*"|"/") factor)*
  private term(): number {
    let left = this.factor();
    let pct = this.lastWasPercent;
    for (;;) {
      const p = this.peek();
      if (p?.t !== "op" || (p.v !== "*" && p.v !== "/")) break;
      this.i++;
      const right = this.factor();
      left = p.v === "*" ? left * right : left / right;
      pct = false;
    }
    this.lastWasPercent = pct;
    return left;
  }

  // factor := unary ["%" ["di" factor]] ;  unary := "-" unary | power
  private factor(): number {
    let v = this.unary();
    this.lastWasPercent = false;
    if (this.peek()?.t === "pct") {
      this.i++;
      v = v / 100;
      if (this.peek()?.t === "of") {
        this.i++;
        v = v * this.factor();
      } else {
        this.lastWasPercent = true;
      }
    }
    return v;
  }

  private unary(): number {
    const p = this.peek();
    if (p?.t === "op" && (p.v === "-" || p.v === "+")) {
      this.i++;
      const v = this.unary();
      return p.v === "-" ? -v : v;
    }
    return this.power();
  }

  // power := atom ["^" unary]
  private power(): number {
    const base = this.atom();
    const p = this.peek();
    if (p?.t === "op" && p.v === "^") {
      this.i++;
      return base ** this.unary();
    }
    return base;
  }

  private atom(): number {
    const p = this.peek();
    if (p?.t === "num") {
      this.i++;
      return p.v;
    }
    if (p?.t === "(") {
      this.i++;
      const v = this.expr();
      if (this.peek()?.t !== ")") throw new Error("parentesi");
      this.i++;
      return v;
    }
    throw new Error("atteso un numero");
  }
}

/**
 * The value of `input` when it is a calculation, else null. A bare number is
 * not a calculation: there has to be an operator or a percentage.
 */
export function calculate(input: string): number | null {
  const toks = tokenize(input.trim());
  if (!toks || toks.length < 2) return null;
  if (!toks.some((t) => t.t === "op" || t.t === "pct")) return null;
  try {
    const p = new Parser(toks);
    const v = p.expr();
    if (!p.done() || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** 1234.5 → "1.234,5" (up to 10 decimals, no trailing zeros). */
export function formatResult(v: number): string {
  const rounded = Math.round(v * 1e10) / 1e10;
  return rounded.toLocaleString("it-IT", { maximumFractionDigits: 10, useGrouping: true });
}

/** What goes on the clipboard: no thousands separator, so it pastes as a number. */
export function plainResult(v: number): string {
  const rounded = Math.round(v * 1e10) / 1e10;
  return rounded.toLocaleString("it-IT", { maximumFractionDigits: 10, useGrouping: false });
}
