// The text side of an integration's document (views/custom.ts): how a value goes
// into an HTML or Markdown template, the formats of {{campo|formato}} and the
// cleaning of an HTML page. Nothing here runs what the description says.

/** A template written in HTML: it keeps its own markup and style, it is not Markdown. */
export function isHtmlTemplate(template: string): boolean {
  return /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype|html|head|body|style|div|section|article|header|main|table|h[1-6])\b/i.test(template);
}

/** A value inside HTML: plain text, whatever it holds; its line breaks stay. */
export function htmlValue(s: string): string {
  return s
    .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)
    .replace(/\r?\n/g, "<br>");
}

/** A value inside a Markdown table row: a line break or a bar would break the row. */
export function cellValue(s: string): string {
  return s.trim().replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

/** Whether the text at `at` lies on a line of a Markdown table. */
export function onTableLine(text: string, at: number): boolean {
  const start = at > 0 ? text.lastIndexOf("\n", at - 1) + 1 : 0;
  return /^\s*\|/.test(text.slice(start, at + 1));
}

/** "2026-11-07" or "07/11/2026" → "7 novembre 2026"; null when it is not a date. */
export function longDate(v: unknown): string | null {
  const s = String(v ?? "");
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : it ? [it[3], it[2], it[1]] : [];
  if (!y) return null;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** 1234.5 → "1.234,5". */
export function italianNumber(n: number): string {
  return n.toLocaleString("it-IT", { useGrouping: "always", maximumFractionDigits: 6 } as unknown as Intl.NumberFormatOptions);
}

const REMOVED = "script,iframe,frame,frameset,object,embed,applet,base,link,noscript,template,meta[http-equiv],animate,set";
const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src", "action", "formaction", "data", "poster", "background"]);

/**
 * The page of an HTML template, filled: nothing that can run or load a page on
 * its own stays in it. Mandatory: this page does not pass through renderMarkdown.
 * Pictures of the template stay, data: ones included; so does its <style>.
 */
export function cleanPage(html: string, title: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(REMOVED).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (!URL_ATTRIBUTES.has(name)) continue;
      // Browsers skip spaces and control characters in a URL's scheme.
      const url = attr.value.replace(/[\u0000- ]+/g, "").toLowerCase();
      const picture = name === "src" && el.tagName === "IMG" && url.startsWith("data:image/");
      if (/^(javascript|vbscript):/.test(url) || (url.startsWith("data:") && !picture)) el.removeAttribute(attr.name);
    }
  });
  if (!doc.title) doc.title = title;
  if (!doc.querySelector("meta[charset]")) {
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    doc.head.prepend(meta);
  }
  if (!doc.documentElement.lang) doc.documentElement.lang = "it";
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
