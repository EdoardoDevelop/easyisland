// The one field in the open island's top bar: the integrations (and agents'
// sessions), the quick actions, the programs of the Start menu (start_apps.rs),
// the Notion pages when Notion is set up (asked as the user stops typing, notion.rs),
// the day of today or tomorrow (asked to the chat, `day_prompt` in telegram.rs),
// and, as the user stops typing, the memory's pages (brain.rs), the past
// conversations (chat_log.rs) and Zammad's tickets (zammad.rs, when it is on);
// last the chat, asked what was typed. The results cover the views while
// there is something typed; Enter opens the selected one, Ctrl+Enter asks the
// chat, Esc clears.

import { h, svg, clear, markIcon, dot } from "./dom";
import { ICONS } from "./icons";
import { renderActionIcon } from "./action-icons";
import { tabActions } from "./actions";
import { State, isSessionTask, type QuickAction } from "../core/state";
import { Bridge, type ChatSummary, type MemoryHit, type NotionPage, type RdmEntry, type TicketHit } from "../core/bridge";
import { kindLabel } from "./rdm";
import { t } from "../core/i18n";

export interface SearchActions {
  openTask(id: string): void;
  runAction(a: QuickAction): void;
  openProgram(path: string): void;
  /** What was typed, asked to the chat. */
  ask(text: string): void;
  /** The summary of today's or tomorrow's day, asked to the chat. */
  askDay(tomorrow: boolean): void;
  /** «Cosa ho fatto» (src/views/done.ts). */
  showDone(): void;
  /** A past conversation, back in the chat. */
  reopenChat(id: string): void;
}

interface Hit {
  kind: "Integrazione" | "Agente" | "Azione" | "Programma" | "Giornata" | "Isola" | "Notion" | "RDM" | "Memoria" | "Conversazione" | "Ticket" | "Chat" | "Web";
  name: string;
  icon: () => Node;
  run: () => void;
  score: number;
}

/** Lower case, no accents: "Città" is found typing "citta". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** 3 = starts with it, 2 = a word starts with it, 1 = contains it, 0 = no. */
function score(name: string, q: string): number {
  const n = fold(name);
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s\-_.()·]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

const KIND_LABEL: Record<Hit["kind"], string> = { Integrazione: t("Integrazione"), Agente: t("Agente"), Azione: t("Azione"), Programma: t("Programma"), Giornata: t("Chat"), Isola: t("Isola"), Notion: "Notion", RDM: "RDM", Memoria: t("Memoria"), Conversazione: t("Conversazione"), Ticket: "Zammad", Chat: "Ctrl+Invio", Web: "Alt+Invio" };

/** How many of each kind at most, so programs do not drown the rest. */

const LIMIT: Record<Hit["kind"], number> = { Integrazione: 4, Agente: 3, Azione: 5, Programma: 8, Giornata: 2, Isola: 1, Notion: 5, RDM: 5, Memoria: 3, Conversazione: 3, Ticket: 5, Chat: 1, Web: 1 };

/** The Start menu, read again after this long (a program installed meanwhile). */
const APPS_TTL_MS = 5 * 60_000;

export interface SearchHost {
  el: HTMLElement;
  /** Results shown: they cover the view, so the island must not close under them. */
  readonly open: boolean;
  sync(): void;
  /** Takes the keyboard: the island was opened by the user. */
  focus(): void;
  /** Empties the field and hides the results (a tab was chosen). */
  close(): void;
}

export function buildSearch(actions: SearchActions): SearchHost {
  const input = h("input", { type: "text", class: "search-input", placeholder: t("Chiedi, cerca o avvia…"),
    spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
  const results = h("div", { class: "search-results" });
  const bar = h("div", { class: "search-bar" }, svg(ICONS.search, 13), input);
  const el = h("div", { id: "search" }, results, bar);

  let apps: { name: string; path: string }[] = [];
  let appsAt = 0;
  let hits: Hit[] = [];
  let sel = 0;
  // Notion's answer for the words typed (it comes later than the rest).
  let notion: { q: string; pages: NotionPage[] } = { q: "", pages: [] };
  let notionTimer = 0;
  // Remote Desktop Manager's connections (rdm.rs keeps the list in memory).
  let rdmFound: { q: string; list: RdmEntry[] } = { q: "", list: [] };
  const askRdm = (q: string) => {
    if (q.length < 2 || !State.settings.activeIntegrations.includes("integration_rdm") || rdmFound.q === q) return;
    void Bridge.rdmSearch(q, 5).then((list) => {
      rdmFound = { q, list };
      if (input.value.trim() === q && list.length) refresh(true);
    });
  };

  // The memory, the past conversations and Zammad: asked together as the user
  // stops typing; each answers when it can.
  let more: { q: string; pages: MemoryHit[]; chats: ChatSummary[]; tickets: TicketHit[] } = { q: "", pages: [], chats: [], tickets: [] };
  let moreTimer = 0;
  const askMore = (q: string) => {
    window.clearTimeout(moreTimer);
    if (q.length < 3 || more.q === q) return;
    moreTimer = window.setTimeout(() => {
      more = { q, pages: [], chats: [], tickets: [] };
      const show = () => { if (more.q === q && input.value.trim() === q) refresh(true); };
      void Bridge.memoryFind(q).then((pages) => { if (more.q === q && pages?.length) { more.pages = pages; show(); } });
      if (State.settings.chatHistory !== false) {
        void Bridge.chatHistorySearch(q).then((chats) => { if (more.q === q && chats?.length) { more.chats = chats; show(); } });
      }
      if (State.settings.activeIntegrations.includes("integration_zammad")) {
        void Bridge.zammadSearch(q).then((tickets) => { if (more.q === q && tickets?.length) { more.tickets = tickets; show(); } });
      }
    }, 400);
  };

  const askNotion = (q: string) => {
    window.clearTimeout(notionTimer);
    const info = State.integrations.integration_notion;
    if (q.length < 3 || !info?.configured || notion.q === q) return;
    notionTimer = window.setTimeout(() => {
      void Bridge.notionSearch(q, 5).then((pages) => {
        notion = { q, pages };
        if (input.value.trim() === q) refresh(true);
      }).catch(() => {});
    }, 400);
  };

  const loadApps = () => {
    if (performance.now() - appsAt < APPS_TTL_MS && appsAt > 0) return;
    appsAt = performance.now();
    void Bridge.startApps().then((list) => {
      apps = list;
      if (input.value.trim()) refresh();
    });
  };

  const askHit = (text: string): Hit => ({ kind: "Chat", name: t("Chiedi alla chat: «{q}»", { q: text }), score: 0,
    icon: () => svg(ICONS.bubble, 13), run: () => actions.ask(text) });

  // The words typed, searched with Google in the default browser.
  const webHit = (text: string): Hit => ({ kind: "Web", name: t("Cerca con Google: «{q}»", { q: text }), score: 0,
    icon: () => renderActionIcon("i:globe", 13),
    run: () => void Bridge.openUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`) });

  const collect = (q: string): Hit[] => {
    const out: Hit[] = [];
    for (const t of State.tasks) {
      const s = score(t.name, q);
      if (!s) continue;
      out.push({ kind: isSessionTask(t) ? "Agente" : "Integrazione", name: t.name, score: s,
        icon: () => markIcon(t.id, 14) ?? dot(t.color, 8), run: () => actions.openTask(t.id) });
    }
    for (const a of tabActions()) {
      const s = score(a.name, q);
      if (!s) continue;
      out.push({ kind: "Azione", name: a.name || t("Senza nome"), score: s,
        icon: () => renderActionIcon(a.icon, 14), run: () => actions.runAction(a) });
    }
    for (const p of apps) {
      const s = score(p.name, q);
      if (!s) continue;
      out.push({ kind: "Programma", name: p.name, score: s,
        icon: () => svg(ICONS.apps, 13), run: () => actions.openProgram(p.path) });
    }
    // Found by its name or by the other words for it ("agenda", "riepilogo").
    for (const tomorrow of [false, true]) {
      const name = tomorrow ? t("La mia giornata di domani") : t("La mia giornata di oggi");
      const s = score(`${name} ${t("agenda riepilogo")}`, q);
      if (s) out.push({ kind: "Giornata", name, score: s, icon: () => svg(ICONS.bubble, 13), run: () => actions.askDay(tomorrow) });
    }
    {
      const s = score(`${t("Cosa ho fatto")} ${t("annulla azioni permessi")}`, q);
      if (s) out.push({ kind: "Isola", name: t("Cosa ho fatto"), score: s, icon: () => svg(ICONS.history, 13, { stroke: 2 }), run: () => actions.showDone() });
    }
    if (notion.q === input.value.trim()) {
      for (const p of notion.pages) {
        out.push({ kind: "Notion", name: p.title || t("Senza titolo"), score: Math.max(1, score(p.title, q)),
          icon: () => (p.emoji ? h("span", { text: p.emoji }) : markIcon("integration_notion", 14) ?? svg(ICONS.doc, 13)),
          run: () => void Bridge.openUrl(p.url) });
      }
    }
    if (rdmFound.q === input.value.trim()) {
      for (const e of rdmFound.list) {
        out.push({ kind: "RDM", name: e.group ? `${e.name} · ${e.group.split(/[\\/]/).pop()}` : e.name, score: Math.max(1, score(e.name, q)),
          icon: () => h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
          run: () => void Bridge.rdmOpen(e).catch(() => {}) });
      }
    }
    if (more.q === input.value.trim()) {
      for (const p of more.pages) {
        out.push({ kind: "Memoria", name: p.gist ? `${p.title} · ${p.gist}` : p.title, score: Math.max(1, score(p.title, q)),
          icon: () => svg(ICONS.memory, 13, { stroke: 1.8 }), run: () => void Bridge.memoryWindowSelect(p.id) });
      }
      for (const c of more.chats) {
        out.push({ kind: "Conversazione", name: c.title || t("Senza titolo"), score: Math.max(1, score(c.title, q)),
          icon: () => svg(ICONS.history, 13, { stroke: 2 }), run: () => actions.reopenChat(c.id) });
      }
      for (const tk of more.tickets) {
        out.push({ kind: "Ticket", name: tk.title, score: Math.max(1, score(tk.title, q)),
          icon: () => markIcon("integration_zammad", 14) ?? svg(ICONS.doc, 13), run: () => void Bridge.openUrl(tk.url) });
      }
    }
    // Best match first; at equal match, the order of the kinds above.
    const kept: Hit[] = [];
    const used: Record<string, number> = {};
    for (const hit of out.sort((a, b) => b.score - a.score)) {
      used[hit.kind] = (used[hit.kind] ?? 0) + 1;
      if (used[hit.kind] <= LIMIT[hit.kind]) kept.push(hit);
    }
    // Last, always: the words typed, asked to the chat or searched on the web.
    kept.push(askHit(input.value.trim()), webHit(input.value.trim()));
    return kept;
  };

  const draw = () => {
    clear(results);
    hits.forEach((hit, i) => {
      results.append(h("button", { class: i === sel ? "search-hit on" : "search-hit",
        onpointerenter: () => { sel = i; mark(); },
        onclick: () => choose(hit) },
      h("span", { class: "search-icon" }, hit.icon()),
      h("span", { class: "search-name", text: hit.name }),
      h("span", { class: "search-kind", text: KIND_LABEL[hit.kind] })));
    });

  };

  const mark = () => {
    [...results.children].forEach((c, i) => c.classList.toggle("on", i === sel));
    (results.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };

  /** `keep`: Notion answered, the selection stays where it is. */
  const refresh = (keep = false) => {
    const q = fold(input.value.trim());
    hits = q ? collect(q) : [];
    if (!keep) {
      sel = 0;
      askNotion(input.value.trim());
      askRdm(input.value.trim());
      askMore(input.value.trim());
    } else if (sel >= hits.length) sel = 0;
    el.classList.toggle("open", !!q);
    if (q) draw();
    else clear(results);
  };

  const reset = () => {
    input.value = "";
    refresh();
  };

  const choose = (hit: Hit) => {
    reset();
    input.blur();
    hit.run();
  };

  // The island's window takes no keys until asked (as for the ⚡ search field).
  input.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  input.addEventListener("focus", () => { void Bridge.focusWindow(true); loadApps(); });
  input.addEventListener("input", () => refresh());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (input.value) reset();
      else input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      mark();
    } else if (e.key === "Enter") {
      const hit = e.ctrlKey ? hits.find((x) => x.kind === "Chat") : e.altKey ? hits.find((x) => x.kind === "Web") : hits[sel];
      if (hit) choose(hit);
    }
  });

  return {
    el,
    get open() { return el.classList.contains("open"); },
    sync() {
      // The island closed: start again empty next time.
      if (State.mode !== "expanded" && input.value) reset();
    },
    focus() {
      void Bridge.focusWindow(true);
      input.focus();
    },
    close() {
      if (input.value) reset();
      input.blur();
    },
  };
}
