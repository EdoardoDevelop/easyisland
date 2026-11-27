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
  }
  const base = document.createElement("style");
  base.textContent = ":where(html){font-family:var(--ei-font,'Segoe UI',sans-serif);font-size:13px;color:var(--ei-text,#e4e5e8);background:transparent}"
    + ":where(body){margin:0;padding:10px 12px}:where(a){color:var(--ei-accent,#4ea1ff)}"
    + ":where(button,input,select,textarea){font:inherit;color:inherit}";
  document.documentElement.prepend(base);

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
