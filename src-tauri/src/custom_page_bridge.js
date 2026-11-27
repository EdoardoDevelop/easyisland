// The bridge of an integration's page (custom.rs `page_response`): the page's
// scripts call `easyisland.…`, every call is a message to the island
// (src/views/custom-page.ts), which does it and answers. The frame has no
// network and no Tauri: this is its only way out.
(() => {
  "use strict";
  const waiting = new Map();
  const listeners = new Map();
  let seq = 0;
  const call = (op, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ ei: 1, id, op, args: args ?? null }, "*");
  });
  const emit = (name, value) => (listeners.get(name) ?? []).forEach((fn) => { try { fn(value); } catch (e) { console.error(e); } });

  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.ei !== 1) return;
    if (m.event) {
      if (m.event === "theme") theme(m.value);
      emit(m.event, m.value);
      return;
    }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.value);
    else w.reject(new Error(m.error || "EasyIsland"));
  });

  // The island's colours as --ei-… on :root, and a look that matches it until the page sets its own.
  function theme(t) {
    if (!t) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.vars ?? {})) root.style.setProperty(`--ei-${k}`, String(v));
    root.style.colorScheme = t.scheme === "light" ? "light" : "dark";
    root.dataset.eiScheme = t.scheme;
    dispatchEvent(new Event("ei-theme"));
  }
  // The look comes with the page (custom_page_ui.css, before this script).

  // Chart.js (/lib/chart.js) in the island's colours and font without the page
  // asking: set as the library arrives, before the page's first chart; a series
  // without colours takes the next of the palette; drawn again with the theme.
  const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const palette = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--ei-c${i}`, "#3b7dbd"));
  // Canvas and Chart.js's hover colours read #rrggbbaa, not every CSS colour.
  const withAlpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, "0") : c);
  function chartLook(C) {
    if (!C || !C.defaults || C.__eiLook) return;
    C.__eiLook = true;
    const set = () => {
      C.defaults.color = cssVar("--ei-dim", "#9398a1");
      C.defaults.borderColor = cssVar("--ei-line", "rgba(127,127,127,0.2)");
      C.defaults.font.family = cssVar("--ei-font", "'Segoe UI', sans-serif");
      C.defaults.font.size = 12;
      C.defaults.maintainAspectRatio = false;
      if (C.defaults.plugins?.legend?.labels) { C.defaults.plugins.legend.labels.boxWidth = 10; C.defaults.plugins.legend.labels.color = cssVar("--ei-text", "#e4e5e8"); }
      if (C.defaults.plugins?.colors) C.defaults.plugins.colors.enabled = false;
      // Labels along the bottom need no lines of their own: only the values' grid.
      const cat = C.defaults.scales?.category;
      if (cat) cat.grid = { ...(cat.grid || {}), display: false };
      if (C.defaults.plugins?.tooltip) { C.defaults.plugins.tooltip.cornerRadius = 6; C.defaults.plugins.tooltip.padding = 8; }
    };
    set();
    C.register({
      id: "eiPalette",
      beforeUpdate(chart) {
        const p = palette();
        const round = ["pie", "doughnut", "polarArea"].includes(chart.config.type);
        chart.data.datasets.forEach((d, i) => {
          if (d.__eiOwn === undefined) d.__eiOwn = d.backgroundColor !== undefined || d.borderColor !== undefined;
          if (d.__eiOwn) return;
          const kind = d.type || chart.config.type;
          if (round) {
            d.backgroundColor = (d.data || []).map((_, j) => p[j % p.length]);
            d.borderColor = cssVar("--ei-card", "#16181c");
            d.borderWidth = 2;
          } else {
            const c = p[i % p.length];
            d.borderColor = c;
            d.backgroundColor = kind === "line" || kind === "radar" ? (d.fill ? withAlpha(c, 0.25) : c) : c;
            if (kind === "bar" && d.borderRadius === undefined) d.borderRadius = 4;
          }
        });
      },
    });
    addEventListener("ei-theme", () => {
      set();
      Object.values(C.instances || {}).forEach((c) => { try { c.update(); } catch { /* gone */ } });
    });
  }
  let chartLib;
  Object.defineProperty(window, "Chart", {
    configurable: true,
    get: () => chartLib,
    set: (v) => { chartLib = v; try { chartLook(v); } catch (e) { console.error(e); } },
  });

  // The frame as tall as the page (the island caps it and scrolls).
  let last = 0;
  const tell = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (h !== last) {
      last = h;
      parent.postMessage({ ei: 1, op: "height", args: h }, "*");
    }
  };
  // A field of the page in use: the island takes the keyboard and stays open (its own fields do the same).
  const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  addEventListener("focusin", (e) => { if (typing(e.target)) parent.postMessage({ ei: 1, op: "focus", args: true }, "*"); });
  addEventListener("focusout", (e) => { if (typing(e.target)) parent.postMessage({ ei: 1, op: "focus", args: false }, "*"); });
  addEventListener("load", () => {
    tell();
    new ResizeObserver(tell).observe(document.documentElement);
  });

  const api = {
    /** The integration: id, name, fields, action labels, source ids. */
    info: () => call("info"),
    /** The saved records: [{ id, created, updated, values }], newest last. */
    records: () => call("records"),
    /** Saves a record (a new one without `id`); answers the record saved. */
    save: (values, id) => call("save", { values, id: id ?? "" }),
    /** Deletes a saved record, after the user's yes in the island. */
    remove: (id) => call("remove", { id }),
    /** A source of the description read now: { status, ok, data }. */
    source: (id) => call("source", { id }),
    /** A call to a declared host: { method, url, headers, body } → { status, ok, data, file }. {{secret:nome}} goes in as the key. */
    http: (req) => call("http", req),
    /** Runs an action of the description by its label, with these values for its {{campi}}. */
    action: (label, values) => call("action", { label, values: values ?? {} }),
    /** A notice in the island. */
    notice: (text) => call("notice", { text: String(text) }),
    /** Text to the clipboard. */
    copy: (text) => call("copy", { text: String(text) }),
    /** A question to EasyIsland's chat. */
    ask: (text) => call("ask", { text: String(text) }),
    /** A link opened in the browser. */
    open: (url) => call("open", { url: String(url) }),
    /** "theme" ({ scheme, vars }), "records" (saved records changed). */
    on: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
  };
  Object.defineProperty(window, "easyisland", { value: Object.freeze(api) });
  parent.postMessage({ ei: 1, op: "ready" }, "*");
})();
