// Builds the user guide of the homepage (site/guida/) from docs/guida/*.md:
// one HTML page per file, with the side menu, the page's contents, previous /
// next and a search over every page (search.json). No dependencies: a small
// Markdown reader for what the guide uses (headings, paragraphs, lists two
// levels deep, tables, code, quotes, images, links, bold, italics, `code`,
// raw <kbd>).
//
//   node scripts/guida.mjs
//
// File names are "NN-slug.md": NN orders the menu, slug is the page; the first
// "# " line is the title, a "> sezione: Nome" line groups it in the menu.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "guida");
const OUT = join(ROOT, "site", "guida");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Inline Markdown: code first (its text untouched), then the rest. */
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Raw <kbd>…</kbd> and <br> survive; anything else is text.
  s = s.replace(/<(\/?)(kbd|br)>/g, "\u0001$1$2\u0002");
  s = esc(s).replace(/\u0001(\/?)(kbd|br)\u0002/g, "<$1$2>");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = href.endsWith(".md") || href.includes(".md#") ? href.replace(/^\d+-/, "").replace(".md", ".html") : href;
    const ext = /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${target}"${ext}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

/** Markdown → HTML, the headings (## and ###) for the contents, plain text for the search. */
function render(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const html = [];
  const toc = [];
  const plain = [];
  let i = 0;
  const para = [];
  const flush = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(" "))}</p>`);
      plain.push(para.join(" "));
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre${lang ? ` data-lang="${lang}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{2,4}) (.+)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const id = slugify(h[2]);
      html.push(`<h${level} id="${id}"><a class="anchor" href="#${id}">#</a>${inline(h[2])}</h${level}>`);
      if (level <= 3) toc.push({ level, id, text: h[2].replace(/`/g, "") });
      plain.push(h[2]);
      i++;
      continue;
    }
    if (/^> /.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^> ?/.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ""));
      const kind = /^\*\*(Nota|Attenzione|Suggerimento|Importante)/.exec(body[0] ?? "")?.[1]?.toLowerCase() ?? "nota";
      html.push(`<div class="callout ${kind}">${body.join("\n").split(/\n\s*\n/).map((p) => `<p>${inline(p.replace(/\n/g, " "))}</p>`).join("")}</div>`);
      plain.push(body.join(" "));
      continue;
    }
    if (/^\|/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      plain.push(rows.join(" ").replace(/\|/g, " "));
      continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(line)) {
      flush();
      // A list, with items indented by two or more spaces as a second level.
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i];
        const m = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
        if (m && m[1].length < 2) items.push({ text: m[3], sub: [], subOrdered: false });
        else if (m) {
          items[items.length - 1].sub.push(m[3]);
          items[items.length - 1].subOrdered = /\d/.test(m[2]);
        } else {
          const last = items[items.length - 1];
          if (last.sub.length) last.sub[last.sub.length - 1] += " " + l.trim();
          else last.text += " " + l.trim();
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((it) => {
        const sub = it.sub.length ? `<${it.subOrdered ? "ol" : "ul"}>${it.sub.map((s) => `<li>${inline(s)}</li>`).join("")}</${it.subOrdered ? "ol" : "ul"}>` : "";
        return `<li>${inline(it.text)}${sub}</li>`;
      }).join("")}</${tag}>`);
      plain.push(items.map((it) => [it.text, ...it.sub].join(" ")).join(" "));
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html: html.join("\n"), toc, plain: plain.join(" ").replace(/<[^>]+>/g, "").replace(/[*`#>[\]()]/g, " ").replace(/\s+/g, " ") };
}

const files = readdirSync(SRC).filter((f) => /^\d+-[a-z0-9-]+\.md$/.test(f)).sort();
const pages = files.map((f) => {
  let md = readFileSync(join(SRC, f), "utf8").replace(/\r/g, "");
  const slug = f.replace(/^\d+-/, "").replace(/\.md$/, "");
  const title = /^# (.+)$/m.exec(md)?.[1] ?? slug;
  const section = /^> sezione: (.+)$/m.exec(md)?.[1] ?? "";
  const lead = /^> in breve: (.+)$/m.exec(md)?.[1] ?? "";
  md = md.replace(/^# .+\n/m, "").replace(/^> (sezione|in breve): .+\n/gm, "");
  return { slug: slug === "introduzione" ? "index" : slug, title, section, lead, ...render(md) };
});

function menu(current) {
  let out = "";
  let section = null;
  for (const p of pages) {
    if (p.section !== section) {
      if (section !== null) out += "</ul>";
      section = p.section;
      out += `${section ? `<div class="group">${esc(section)}</div>` : ""}<ul>`;
    }
    out += `<li><a href="${p.slug}.html"${p.slug === current ? ' class="on" aria-current="page"' : ""}>${esc(p.title)}</a></li>`;
  }
  return out + "</ul>";
}

mkdirSync(OUT, { recursive: true });
pages.forEach((p, n) => {
  const prev = pages[n - 1];
  const next = pages[n + 1];
  const toc = p.toc.length > 1
    ? `<nav class="toc" aria-label="In questa pagina"><div class="group">In questa pagina</div><ul>${p.toc.map((t) => `<li class="l${t.level}"><a href="#${t.id}">${inline(t.text)}</a></li>`).join("")}</ul></nav>`
    : "";
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} — Guida di EasyIsland</title>
<meta name="description" content="${esc(p.lead || `Guida di EasyIsland: ${p.title}`)}">
<link rel="icon" href="../media/icon.png">
<link rel="stylesheet" href="../site.css">
<link rel="stylesheet" href="guida.css">
</head>
<body class="guide">
<header class="top">
<button class="menu-btn" aria-label="Menu" onclick="document.body.classList.toggle('open')">☰</button>
<a href="../index.html" class="brand"><img src="../media/icon.png" alt=""><span>EasyIsland</span></a>
<span class="badge">Guida · ${VERSION}</span>
<div class="search"><input id="q" type="search" placeholder="Cerca nella guida…" autocomplete="off"><div id="results"></div></div>
<nav class="links"><a href="../index.html">Home</a><a href="index.html" class="on">Guida</a><a href="https://github.com/EdoardoDevelop/easyisland/releases">Download</a><a href="https://github.com/EdoardoDevelop/easyisland">GitHub</a></nav>
</header>
<div class="layout">
<aside class="side">${menu(p.slug)}</aside>
<main>
${p.section ? `<div class="crumb">${esc(p.section)}</div>` : ""}
<h1>${esc(p.title)}</h1>
${p.lead ? `<p class="lead">${inline(p.lead)}</p>` : ""}
${p.html}
<div class="pager">${prev ? `<a class="prev" href="${prev.slug}.html"><small>Precedente</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${next.slug}.html"><small>Successiva</small>${esc(next.title)}</a>` : "<span></span>"}</div>
<footer>EasyIsland ${VERSION} · open source (MIT) · <a href="https://github.com/EdoardoDevelop/easyisland/blob/main/docs/guida/${files[n]}">Modifica questa pagina su GitHub</a></footer>
</main>
${toc}
</div>
<script src="guida.js"></script>
</body>
</html>
`;
  writeFileSync(join(OUT, `${p.slug}.html`), html);
});
writeFileSync(join(OUT, "search.json"), JSON.stringify(pages.map((p) => ({ s: p.slug, t: p.title, h: p.toc.map((t) => [t.id, t.text]), x: p.plain }))));
console.log(`guida: ${pages.length} pagine in site/guida`);
