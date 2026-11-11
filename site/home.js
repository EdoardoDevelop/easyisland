// The home page: the island that reacts to the section in view, the hero tilt,
// the reveals, the showcase tabs. No dependencies. Texts live in the HTML.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // headline: one word at a time
  const h1 = $("#h1");
  h1.innerHTML = h1.textContent.split(" ").map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ");

  // marquee: duplicate once for a seamless loop
  const track = $("#track"); track.innerHTML += track.innerHTML;
  $$("span", track).slice(track.children.length / 2).forEach(s => s.setAttribute("aria-hidden", "true"));

  // ---- the island ----
  const island = $("#island"), layers = $("#layers"), answered = new Set();
  let current = "idle", wanted = "idle", hold = 0;
  const show = name => {
    current = name; island.dataset.state = name;
    $$(".isl-layer", layers).forEach(l => {
      const on = l.dataset.layer === name; l.classList.toggle("on", on); l.inert = !on;
      if (on) layers.style.width = l.offsetWidth + "px";
    });
  };
  const settle = () => { if (!hold) show(answered.has(wanted) ? "idle" : wanted); };
  document.fonts.ready.then(() => show("idle"));
  // fonts, viewport and language all change how wide a layer is
  const fit = new ResizeObserver(() => { const l = $(".isl-layer.on", layers); if (l) layers.style.width = l.offsetWidth + "px"; });
  $$(".isl-layer", layers).forEach(l => fit.observe(l));
  const watch = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) wanted = e.target.dataset.island; else if (wanted === e.target.dataset.island) wanted = "idle"; });
    settle();
  }, { rootMargin: "-40% 0px -45% 0px" });
  $$("[data-island]").forEach(s => watch.observe(s));
  $$("[data-answer]").forEach(b => b.addEventListener("click", () => {
    answered.add(current); $("#answer").textContent = b.dataset.answer; show("answer");
    clearTimeout(hold); hold = setTimeout(() => { hold = 0; settle(); }, 2200);
  }));

  // the character looks at the pointer
  const pupils = $("#pupils"), ch = $(".isl-char");
  if (!calm) addEventListener("pointermove", e => {
    const r = ch.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
    pupils.style.transform = `translate(${dx / d * 30 * k}px,${dy / d * 20 * k}px)`;
  }, { passive: true });

  // hero screenshot lands flat as you scroll
  const stage = $("#stage");
  if (!calm) {
    let tick = 0;
    const upd = () => { tick = 0; const r = stage.getBoundingClientRect();
      stage.style.setProperty("--p", Math.max(0, Math.min(1, 1 - (r.top - innerHeight * .12) / (innerHeight * .62))).toFixed(3)); };
    addEventListener("scroll", () => tick ||= requestAnimationFrame(upd), { passive: true }); upd();
  } else stage.style.setProperty("--p", 1);

  // reveals
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -12% 0px" });
  $$("[data-r]").forEach(el => io.observe(el));

  // showcase tabs
  const tabs = $$(".tab"), panes = $$(".pane"), screen = $("#screen"), cap = $("#caption");
  const caps = tabs.map(t => t.dataset.cap);
  let idx = 0, timer = 0, auto = !calm;
  const pick = (i, user) => {
    idx = i; if (user) auto = false;
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", j === i); t.classList.remove("run"); });
    panes.forEach((p, j) => p.classList.toggle("on", j === i));
    screen.style.setProperty("--glow", tabs[i].dataset.glow); cap.innerHTML = caps[i];
    clearTimeout(timer);
    if (auto) { void tabs[i].offsetWidth; tabs[i].classList.add("run"); timer = setTimeout(() => pick((idx + 1) % tabs.length), 6000); }
  };
  tabs.forEach((t, i) => t.addEventListener("click", () => pick(i, true)));
  cap.innerHTML = caps[0];
  new IntersectionObserver(([e], o) => { if (e.isIntersecting) { pick(0); o.disconnect(); } }, { threshold: .4 }).observe(screen);

  // bento spotlight
  $$(".cell").forEach(c => c.addEventListener("pointermove", e => {
    const r = c.getBoundingClientRect(); c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true }));
})();
