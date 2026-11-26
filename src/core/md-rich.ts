// Notices and tables with more to see (26 Nov 2026, Edoardo: «qualcosa di
// visivo, grafico, che renda l'utilizzo piacevole»):
//  - a notice («> Attenzione: …», «> [!WARNING]») gets its icon and title, in
//    five kinds: Nota, Suggerimento, Importante, Attenzione, Pericolo;
//  - a table's numbers go right, a column of quantities gets a bar behind each
//    value as long as its share of the largest, the states (OK, Errore, Attivo,
//    Sì/No…) become coloured labels, a long table keeps its header in sight.
// DOM only, as markdown.ts: nothing from the reply becomes markup.

import { t } from "./i18n";
import "./md-rich.css";

export type CalloutKind = "info" | "tip" | "important" | "warn" | "danger";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A small stroked icon (24×24 paths, as views/icons.ts). */
function icon(d: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "14");
  s.setAttribute("height", "14");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}

const KINDS: Record<CalloutKind, { title: () => string; icon: string }> = {
  info: { title: () => t("Nota"), icon: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 11v5.5M12 7.6v.1" },
  tip: { title: () => t("Suggerimento"), icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" },
  important: { title: () => t("Importante"), icon: "M5 4h14v12H9l-4 4zM12 7.5v4M12 13.8v.1" },
  warn: { title: () => t("Attenzione"), icon: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.1" },
  danger: { title: () => t("Pericolo"), icon: "M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3zM12 7.5v5M12 15.8v.1" },
};

/** The marker of a notice: GitHub's «[!NOTE]», a word with its colon, an emoji. */
const MARK = /^\s*(?:\[!(note|tip|important|warning|caution)\]|(\*\*)?(nota|note|suggerimento|consiglio|tip|importante|important|attenzione|warning|pericolo|danger|caution)\s*:?(\*\*)?\s*:?|(⚠️?|💡|ℹ️?|❗|⛔|🛑))\s*/iu;

const BY_WORD: Record<string, CalloutKind> = {
  note: "info", nota: "info", "ℹ": "info", "ℹ️": "info",
  tip: "tip", suggerimento: "tip", consiglio: "tip", "💡": "tip",
  important: "important", importante: "important", "❗": "important",
  warning: "warn", attenzione: "warn", "⚠": "warn", "⚠️": "warn",
  caution: "danger", pericolo: "danger", danger: "danger", "⛔": "danger", "🛑": "danger",
};

/**
 * A quote that is a notice, by its first line: its kind, and the lines without
 * the marker. A word counts only followed by «:» (or as GitHub's marker), so a
 * quote that starts «Nota bene che…» stays a quote. Steps («⚙») are never notices.
 */
export function calloutOf(lines: string[]): { kind: CalloutKind; lines: string[] } | null {
  const first = lines[0] ?? "";
  const m = MARK.exec(first);
  if (!m) return null;
  const word = (m[1] ?? m[3] ?? m[5] ?? "").toLowerCase();
  // «Attenzione» with no colon after it is a sentence, not a title.
  if (m[3] && !/:/.test(m[0])) return null;
  const kind = BY_WORD[word];
  if (!kind) return null;
  const rest = first.slice(m[0].length);
  const out = [rest.charAt(0).toUpperCase() + rest.slice(1), ...lines.slice(1)];
  // «> [!NOTE]» alone on its line: the text is on the next ones.
  if (!rest.trim()) out.shift();
  return { kind, lines: out };
}

/** The notice's box: icon and title on top, then its blocks. */
export function calloutBox(kind: CalloutKind, body: HTMLElement[]): HTMLElement {
  const q = document.createElement("blockquote");
  q.className = `md-quote md-callout md-callout-${kind}`;
  const head = document.createElement("div");
  head.className = "md-callout-head";
  const title = document.createElement("span");
  title.textContent = KINDS[kind].title();
  head.append(icon(KINDS[kind].icon), title);
  q.append(head, ...body);
  return q;
}

// ── Tables ─────────────────────────────────────────────────────────────────────

/** «1.234,5», «12 %», «€ 45», «3,2 GB», «-7»: its value; null for anything else (IP, version, date, code). */
export function numberOf(text: string): number | null {
  const s = text.replace(/\*\*|`/g, "").replace(/[  ]/g, " ").trim();
  const m = /^([-+−]?)\s*(?:[€$£]\s*)?(\d{1,3}(?:[. ']\d{3})+|\d+)(?:[,.](\d+))?\s*(?:%|€|\$|£|[kKMGT]?B|ms|s|min|h|gg|giorni|ore|°C?|x|×|pz|kWh?|W|Mbps|Gbps)?$/u.exec(s);
  if (!m) return null;
  // «1.234» is a thousand in Italian; «1.5» a decimal: three digits after one dot read as thousands.
  const whole = m[2].replace(/[. ']/g, "");
  const n = Number(`${whole}${m[3] ? `.${m[3]}` : ""}`);
  if (!Number.isFinite(n)) return null;
  return m[1] && m[1] !== "+" ? -n : n;
}

/** Columns whose numbers are names, not amounts: no bar. */
const NOT_AMOUNT = /\b(anno|year|id|codice|code|cod|n[°º.]?|num(ero)?|porta|port|versione|version|ver|ip|vlan|cap|tel|telefono|interno|ext|ordine|order|ticket|matricola|serial|seriale|build)\b/i;

/** A cell that is a state: its colour. */
const STATES: [RegExp, "ok" | "bad" | "warn" | "off"][] = [
  [/^(✅|✔️?|✓|🟢)?\s*(ok|sì|si|yes|attivo|attiva|attivi|online|on|up|funziona|fatto|fatta|completato|completata|riuscito|riuscita|superato|aggiornato|aggiornata|risolto|presente|abilitato|abilitata|acceso|connesso|valido|valida|pass|passed|success|done|active|enabled|running|healthy)$/iu, "ok"],
  [/^(❌|✗|✖️?|🔴|⛔)?\s*(ko|no|errore|error|offline|off|down|fallito|fallita|failed|fail|guasto|scaduto|scaduta|assente|critico|critica|bloccato|bloccata|non funziona|mancante|disconnesso|invalido|stopped|missing|expired)$/iu, "bad"],
  [/^(⚠️?|🟡|🟠)?\s*(attenzione|warning|avviso|in attesa|pending|da fare|parziale|in corso|lento|da verificare|in scadenza|degradato|todo|partial)$/iu, "warn"],
  [/^(⚪|⚫)?\s*(n\/d|n\/a|disabilitato|disabilitata|spento|spenta|sconosciuto|disabled|unknown|nessuno)$/iu, "off"],
  [/^(✅|✔️?|✓|🟢)$/u, "ok"],
  [/^(❌|✗|✖️?|🔴)$/u, "bad"],
  [/^(⚠️?|🟡|🟠)$/u, "warn"],
];

function stateOf(text: string): "ok" | "bad" | "warn" | "off" | null {
  const s = text.replace(/\*\*/g, "").trim();
  if (!s || s.length > 24) return null;
  return STATES.find(([re]) => re.test(s))?.[1] ?? null;
}

/** The alignment the separator line asks for, by column («---:» right, «:--:» centre). */
export function alignsOf(sep: string): ("left" | "right" | "center" | "")[] {
  return sep.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => {
    const s = c.trim();
    return s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : s.startsWith(":") ? "left" : "";
  });
}

/**
 * A table drawn by markdown.ts made easier to read: `rows` are its cells as
 * written (header first), `sep` its separator line.
 */
export function dressTable(table: HTMLTableElement, wrap: HTMLElement, rows: string[][], sep: string) {
  const body = rows.slice(1);
  const heads = rows[0] ?? [];
  const aligns = alignsOf(sep);
  const trs = Array.from(table.rows);
  const cols = Math.max(...rows.map((r) => r.length));
  for (let c = 0; c < cols; c++) {
    const cellsOf = trs.map((tr) => tr.cells[c] as HTMLTableCellElement | undefined);
    if (aligns[c]) cellsOf.forEach((x) => x && (x.style.textAlign = aligns[c]));
    const values = body.map((r) => (r[c] ?? "").trim());
    const filled = values.filter((v) => v && v !== "-" && v !== "—");
    // States: never the first column, the row's name.
    if (c > 0) {
      body.forEach((r, i) => {
        const kind = stateOf(r[c] ?? "");
        const td = cellsOf[i + 1];
        if (!kind || !td) return;
        const pill = document.createElement("span");
        pill.className = `md-pill md-pill-${kind}`;
        pill.append(...Array.from(td.childNodes));
        // The label's dot says it already: off with a leading ✅ ❌ ⚠️ (kept when it is all there is).
        const first = pill.firstChild;
        if (first?.nodeType === Node.TEXT_NODE) {
          const rest = first.nodeValue!.replace(/^\s*(✅|✔️?|✓|🟢|❌|✗|✖️?|🔴|⛔|⚠️?|🟡|🟠|⚪|⚫)\s*/u, "");
          if (rest.trim()) first.nodeValue = rest;
        }
        td.append(pill);
      });
    }
    const nums = values.map(numberOf);
    const known = nums.filter((n): n is number => n != null);
    if (c === 0 || filled.length < 2 || known.length < Math.ceil(filled.length * 0.8)) continue;
    if (!aligns[c]) cellsOf.forEach((x) => x?.classList.add("md-num"));
    // Bars: quantities only (three or more, none negative, not years or codes).
    const years = known.every((n) => Number.isInteger(n) && n >= 1900 && n <= 2100);
    const max = Math.max(...known);
    if (known.length < 3 || years || max <= 0 || known.some((n) => n < 0) || NOT_AMOUNT.test(heads[c] ?? "")) continue;
    nums.forEach((n, i) => {
      const td = cellsOf[i + 1];
      if (n == null || !td) return;
      td.classList.add("md-bar");
      td.style.setProperty("--bar", `${Math.max(2, Math.round((n / max) * 100))}%`);
      if (n === max) td.classList.add("md-bar-top");
    });
  }
  // A long table: its own height, the header stays on top while it scrolls.
  if (body.length > 12) wrap.classList.add("md-table-tall");
}
