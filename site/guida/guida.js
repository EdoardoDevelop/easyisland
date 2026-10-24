// The guide's search (search.json, made by scripts/guida.mjs) and the
// contents on the right following the scroll.
(() => {
  const q = document.getElementById("q");
  const box = document.getElementById("results");
  let index = null;
  let sel = -1;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  async function load() {
    if (!index) index = await (await fetch("search.json")).json();
    return index;
  }
  function snippet(text, words) {
    const n = norm(text);
    const at = Math.max(0, n.indexOf(words[0]) - 60);
    let s = esc(text.slice(at, at + 180));
    for (const w of words) s = s.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
    return (at ? "…" : "") + s + "…";
  }
  async function search() {
    const words = norm(q.value).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) {
      box.classList.remove("on");
      return;
    }
    const pages = await load();
    const hits = [];
    for (const p of pages) {
      const all = norm(`${p.t} ${p.x}`);
      if (!words.every((w) => all.includes(w))) continue;
      let score = words.filter((w) => norm(p.t).includes(w)).length * 10;
      const head = p.h.find(([, h]) => words.some((w) => norm(h).includes(w)));
      if (head) score += 5;
      for (const w of words) score += Math.min(5, all.split(w).length - 1);
      hits.push({ p, head, score });
    }
    hits.sort((a, b) => b.score - a.score);
    sel = -1;
    box.innerHTML = hits.length
      ? hits.slice(0, 12).map(({ p, head }) => `<a href="${p.s}.html${head ? `#${head[0]}` : ""}">${esc(p.t)}${head ? ` › ${esc(head[1])}` : ""}<small>${snippet(p.x, words)}</small></a>`).join("")
      : `<div class="none">${document.documentElement.lang === "en" ? "Nothing found." : "Niente trovato."}</div>`;
    box.classList.add("on");
  }
  q.addEventListener("input", search);
  q.addEventListener("focus", () => q.value && search());
  q.addEventListener("keydown", (e) => {
    const links = [...box.querySelectorAll("a")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(links.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      links.forEach((a, i) => a.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter" && links.length) {
      location.href = links[Math.max(0, sel)].href;
    } else if (e.key === "Escape") {
      box.classList.remove("on");
      q.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) box.classList.remove("on");
    if (e.target.closest(".side a")) document.body.classList.remove("open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== q) {
      e.preventDefault();
      q.focus();
    }
  });
  // The contents: the heading on screen is lit.
  const links = [...document.querySelectorAll(".toc a")];
  if (links.length) {
    const heads = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
    const spy = () => {
      let on = 0;
      heads.forEach((h, i) => {
        if (h.getBoundingClientRect().top < 120) on = i;
      });
      links.forEach((a, i) => a.classList.toggle("on", i === on));
    };
    addEventListener("scroll", spy, { passive: true });
    spy();
  }
})();
