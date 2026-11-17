// The one field in the open island's top bar: the integrations (and agents'
// sessions), the quick actions, the programs of the Start menu (start_apps.rs),
// the Notion pages when Notion is set up (asked as the user stops typing, notion.rs),
// the day of today or tomorrow (asked to the chat, `day_prompt` in telegram.rs),
// and, as the user stops typing, the memory's pages (brain.rs), the past
// conversations (chat_log.rs) and Zammad's tickets (zammad.rs, when it is on);
// last the chat, asked what was typed. A question the memory answers for sure
// gets its answer above the results, as the user stops typing (quick_answer.rs,
// Impostazioni → Chat → «Risposte rapide»): not a result, so Enter and the
// selection stay as they are. The results cover the views while
// there is something typed; Enter opens the selected one, Ctrl+Enter asks the
// chat, Esc clears.

import { h, svg, clear, markIcon, dot } from "./dom";
import { ICONS } from "./icons";
import { renderActionIcon } from "./action-icons";
import { tabActions } from "./actions";
import { State, isSessionTask, type QuickAction } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { Sound } from "../core/sound";
import { Constellation } from "./constellation";
import { Model } from "../memory/data";
import { Bridge, type ChatSummary, type DvcItem, type MemoryHit, type NotionPage, type QuickAnswer, type RdmEntry, type ThreecxContact, type TicketHit } from "../core/bridge";
import { cloudOn, kindLabel, rdmShowEntry } from "./rdm";
import { t, tn } from "../core/i18n";
import { inline, plainText } from "../core/markdown";

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
  /** A new chat that starts from a node of the memory: nothing is sent yet. */
  memoryChat(id: string, title: string): void;
  /** «Ricorda questo» with `text` (src/views/remember.ts). */
  remember(text: string): void;
  /** Search results opened, resized or closed (constellation toggled, rows updated). */
  onLayout?: () => void;
  /** External hit ran (web search, calculation copy, Notion, RDM, ticket, open map). */
  onDone?: () => void;
  /** Escape pressed while the search field is already empty. */
  onEscape?: () => void;
  /** Whether the host expects auto-focus on the search field when the window activates. */
  canAutoFocus?: () => boolean;
}

interface Hit {
  kind: "Calcolo" | "Integrazione" | "Agente" | "Azione" | "Programma" | "Giornata" | "Isola" | "Notion" | "RDM" | "Cloud" | "Contatto" | "Memoria" | "Conversazione" | "Ticket" | "Chat" | "Web";
  name: string;
  icon: () => Node;
  run: () => void;
  score: number;
  /** The node of the memory it shows in the constellation. */
  node?: string;
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

const KIND_LABEL: Record<Hit["kind"], string> = { Calcolo: t("Copia"), Integrazione: t("Integrazione"), Agente: t("Agente"), Azione: t("Azione"), Programma: t("Programma"), Giornata: t("Chat"), Isola: t("Isola"), Notion: "Notion", RDM: "RDM", Cloud: "RDM", Contatto: "3CX", Memoria: t("Memoria"), Conversazione: t("Conversazione"), Ticket: "Zammad", Chat: "Ctrl+Invio", Web: "Alt+Invio" };

/** How many of each kind at most, so programs do not drown the rest. */

const LIMIT: Record<Hit["kind"], number> = { Calcolo: 1, Integrazione: 4, Agente: 3, Azione: 5, Programma: 8, Giornata: 2, Isola: 1, Notion: 5, RDM: 5, Cloud: 6, Contatto: 4, Memoria: 5, Conversazione: 3, Ticket: 5, Chat: 1, Web: 1 };

/** The Start menu, read again after this long (a program installed meanwhile). */
const APPS_TTL_MS = 5 * 60_000;

export interface SearchHost {
  el: HTMLElement;
  /** Results shown: they cover the view, so the island must not close under them. */
  readonly open: boolean;
  /** Desired height of .search-results (px) when search results are shown, or 0. */
  resultsHeight(): number;
  sync(): void;
  /** Takes the keyboard: the island was opened by the user. */
  focus(): void;
  /** Places the caret in the input without re-invoking window activation. */
  focusInputOnly(): void;
  /** Clears DOM focus when the island closes so reopening always re-focuses cleanly. */
  blur(): void;
  /** Empties the field and hides the results (a tab was chosen). */
  close(): void;
}

export function buildSearch(actions: SearchActions): SearchHost {
  const input = h("input", { type: "text", class: "search-input", placeholder: t("Chiedi, cerca o avvia…"),
    spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
  const kbd = (label: string) => h("span", { class: "search-kbd" }, label);
  const countPill = h("span", { class: "search-count" });
  const clearBtn = h("button", {
    type: "button",
    class: "search-clear",
    title: t("Pulisci (Esc)"),
    "aria-label": t("Pulisci (Esc)"),
  }, svg(ICONS.xmark, 12)) as HTMLButtonElement;
  const escHint = h("span", { class: "search-esc" }, kbd("Esc"), " ", t("chiude"));
  const list = h("div", { class: "search-list" });
  const sky = new Constellation();
  const foot = h(
    "div",
    { class: "search-foot" },
    h(
      "span",
      { class: "search-foot-keys" },
      h("span", { class: "search-foot-item" }, kbd("↑↓"), " ", t("o"), " ", kbd("Tab"), " ", t("scorre")),
      h("span", { class: "search-foot-item" }, kbd(t("Invio")), " ", t("apri")),
      h("span", { class: "search-foot-item" }, kbd(t("Ctrl+Invio")), " ", t("chat")),
      h("span", { class: "search-foot-item" }, kbd(t("Alt+Invio")), " Google"),
    ),
    h("span", { class: "search-foot-item" }, kbd("Esc"), " ", t("pulisci")),
  );
  // The quick answer: above the results, never one of them.
  const answerBox = h("div", { class: "search-answer" });
  const results = h("div", { class: "search-results" }, sky.el, answerBox, list, foot);
  const bar = h("div", { class: "search-bar" }, svg(ICONS.search, 13), input, countPill, clearBtn, escHint);
  // Click anywhere inside the search bar in search-only mode (except action buttons) keeps focus in the input.
  bar.addEventListener("mousedown", (e) => {
    if (State.searchOnly && e.target !== input && !(e.target as Element | null)?.closest("button")) {
      e.preventDefault();
      input.focus({ preventScroll: true });
    }
  });
  // Leaving the field: its accent line goes out with a wave back (style-windows.css).
  let lineOut = 0;
  input.addEventListener("focus", () => { window.clearTimeout(lineOut); bar.classList.remove("line-out"); });
  input.addEventListener("blur", () => {
    bar.classList.add("line-out");
    window.clearTimeout(lineOut);
    lineOut = window.setTimeout(() => bar.classList.remove("line-out"), 2500);
  });
  const el = h("div", { id: "search" }, results, bar);

  let apps: { name: string; path: string }[] = [];
  let appsAt = 0;
  let hits: Hit[] = [];
  let sel = 0;
  // Notion's answer for the words typed (it comes later than the rest).
  let notion: { q: string; pages: NotionPage[] } = { q: "", pages: [] };
  let notionTimer = 0;
  // Remote Desktop Manager's connections (rdm.rs keeps the list in memory).
  // With Devolutions Cloud, also its credentials and password lists (dvc.rs search).
  let rdmFound: { q: string; list: RdmEntry[]; cloud: DvcItem[] } = { q: "", list: [], cloud: [] };
  const askRdm = (q: string) => {
    if (q.length < 2 || !State.settings.activeIntegrations.includes("integration_rdm") || rdmFound.q === q) return;
    rdmFound = { q, list: [], cloud: [] };
    const show = () => { if (rdmFound.q === q && input.value.trim() === q) refresh(true); };
    // With the cloud only its folders and entries, opened in the card on the island;
    // without it RDM's own list, opened in RDM.
    if (cloudOn()) void Bridge.dvcSearch(q, 8).then((cloud) => { if (rdmFound.q === q && cloud?.length) { rdmFound.cloud = cloud; show(); } });
    else void Bridge.rdmSearch(q, 5).then((list) => { if (rdmFound.q === q && list.length) { rdmFound.list = list; show(); } });
  };

  // The memory, the past conversations and Zammad: asked together as the user
  // stops typing; each answers when it can.
  let more: { q: string; pages: MemoryHit[]; chats: ChatSummary[]; tickets: TicketHit[]; contacts: ThreecxContact[] } = { q: "", pages: [], chats: [], tickets: [], contacts: [] };
  let moreTimer = 0;
  // The map, once per search: the constellation is drawn from it.
  let memory: Model | null = null;
  let memoryAsked = false;
  /** The star clicked, until the words or the selection change. */
  let picked = "";
  const loadMemory = () => {
    if (memoryAsked) return;
    memoryAsked = true;
    void Bridge.memoryGraph("*").then((g) => {
      if (g?.nodes && memoryAsked) {
        memory = new Model(g);
        showSky();
      }
    });
  };
  const showSky = () => {
    const was = sky.shown;
    const node = picked || (hits[sel]?.node ?? hits.find((x) => x.node)?.node);
    if (node && memory?.byId.has(node)) sky.show(memory, node);
    else if (sky.shown) sky.hide();
    if (sky.shown !== was) actions.onLayout?.();
  };
  sky.onPick = (id) => {
    picked = id;
    showSky();
    if (State.searchOnly) input.focus({ preventScroll: true });
  };
  sky.onOpen = (id) => {
    reset(true);
    input.blur();
    void Bridge.memoryWindowSelect(id);
    if (State.searchOnly) actions.onDone?.();
  };
  sky.onChat = (id) => {
    const title = memory?.byId.get(id)?.label ?? "";
    reset(true);
    input.blur();
    actions.memoryChat(id, title);
  };
  const askMore = (q: string) => {
    window.clearTimeout(moreTimer);
    if (q.length >= 3) loadMemory();
    if (q.length < 3 || more.q === q) return;
    moreTimer = window.setTimeout(() => {
      more = { q, pages: [], chats: [], tickets: [], contacts: [] };
      const show = () => { if (more.q === q && input.value.trim() === q) refresh(true); };
      void Bridge.memoryFind(q).then((pages) => { if (more.q === q && pages?.length) { more.pages = pages; show(); } });
      if (State.settings.chatHistory !== false) {
        void Bridge.chatHistorySearch(q).then((chats) => { if (more.q === q && chats?.length) { more.chats = chats; show(); } });
      }
      if (State.settings.activeIntegrations.includes("integration_zammad")) {
        void Bridge.zammadSearch(q).then((tickets) => { if (more.q === q && tickets?.length) { more.tickets = tickets; show(); } });
      }
      // The 3CX phonebook (company and personal contacts, colleagues).
      if (State.settings.activeIntegrations.includes("integration_3cx")) {
        void Bridge.threecxContacts(q).then((contacts) => { if (more.q === q && contacts?.length) { more.contacts = contacts.filter((c) => c.numbers.length); show(); } }).catch(() => {});
      }
    }, 400);
  };

  // The answer from the memory for the words typed: once per text, after a pause, dropped if the text changes.
  let quick: { q: string; ans: QuickAnswer | null } = { q: "", ans: null };
  let quickTimer = 0;
  const askQuick = (q: string) => {
    window.clearTimeout(quickTimer);
    if ((State.settings.quickAnswers ?? "potion") === "off" || q.length < 6 || quick.q === q) return;
    quickTimer = window.setTimeout(() => {
      quick = { q, ans: null };
      void Bridge.quickAnswer(q).then((ans) => {
        if (quick.q !== q) return;
        quick.ans = ans ?? null;
        if (input.value.trim() === q) { drawAnswer(); actions.onLayout?.(); }
      }).catch(() => {});
    }, 600);
  };
  const drawAnswer = () => {
    clear(answerBox);
    const typed = input.value.trim();
    const a = typed && quick.q === typed ? quick.ans : null;
    answerBox.classList.toggle("on", !!a);
    if (!a) return;
    const from = [...new Set(a.sources)].join(" · ");
    const written = a.by !== "Potion";
    answerBox.append(
      h("div", { class: "search-answer-head" },
        svg(ICONS.memory, 12, { stroke: 1.8 }),
        h("span", { text: written ? t("Risposta rapida · scritta da {by}", { by: a.by }) : t("Risposta rapida dalla memoria") })),
      // Line by line, with `code`, **bold** and links as in the chat (17 Nov 2026:
      // the procedure's commands showed their backticks). A procedure's title in bold.
      h("div", { class: "search-answer-text md" }, ...a.text.split("\n").map((l, i) => {
        const line = h("div", { class: i === 0 && a.node ? "search-answer-title" : "" });
        line.append(...inline(l, { openUrl: (url) => void Bridge.openUrl(url) }));
        return line;
      })),
      written
        ? h("details", { class: "search-answer-src" }, h("summary", { text: t("Fonti: {from}", { from }) }), ...a.lines.map((l) => h("div", { class: "search-answer-line", text: l })))
        : h("div", { class: "search-answer-src", text: t("Fonti: {from}", { from }) }),
      h("div", { class: "search-answer-acts" },
        h("button", { type: "button", class: "search-answer-btn", text: t("Copia"),
          onclick: () => { void navigator.clipboard.writeText(plainText(a.text)).then(() => Sound.play("finish")).catch(() => {}); } }),
        ...(a.node ? [h("button", { type: "button", class: "search-answer-btn", text: t("Apri la pagina"),
          onclick: () => { const id = a.node!; reset(true); input.blur(); void Bridge.memoryWindowSelect(id); } })] : []),
        h("button", { type: "button", class: "search-answer-btn", text: t("Chiedi alla chat"),
          onclick: () => { reset(true); input.blur(); actions.ask(typed); } })),
    );
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

  const doneIfSearchOnly = () => {
    if (State.searchOnly) actions.onDone?.();
  };

  // The words typed, searched with Google in the default browser.
  const webHit = (text: string): Hit => ({ kind: "Web", name: t("Cerca con Google: «{q}»", { q: text }), score: 0,
    icon: () => renderActionIcon("i:globe", 13),
    run: () => { void Bridge.openUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`); doneIfSearchOnly(); } });

  const collect = (q: string): Hit[] => {
    const out: Hit[] = [];
    const calc = calculate(input.value.trim());
    if (calc != null) {
      out.push({
        kind: "Calcolo",
        name: formatResult(calc),
        score: 100,
        icon: () => h("span", { class: "search-calc-eq", text: "=" }),
        run: () => {
          void navigator.clipboard.writeText(plainResult(calc)).then(() => Sound.play("finish")).catch(() => {});
          doneIfSearchOnly();
        },
      });
    }
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
    // «ricorda …» / «ricordati che …»: that, into the memory; the words alone open the empty card.
    {
      const typed = input.value.trim();
      const said = typed.match(/^(?:ricorda(?:ti)?(?:\s+che)?|remember(?:\s+that)?)\s+(.+)$/is);
      const s = said ? 4 : score(`${t("Ricorda questo")} ${t("memoria")}`, q);
      if (s) out.push({ kind: "Memoria", name: said ? t("Ricorda «{text}»", { text: said[1] }) : t("Ricorda questo"), score: s,
        icon: () => svg(ICONS.memory, 13, { stroke: 1.8 }), run: () => actions.remember(said ? said[1] : "") });
    }
    {
      const s = score(`${t("Cosa ho fatto")} ${t("annulla azioni permessi")}`, q);
      if (s) out.push({ kind: "Isola", name: t("Cosa ho fatto"), score: s, icon: () => svg(ICONS.history, 13, { stroke: 2 }), run: () => actions.showDone() });
    }
    if (notion.q === input.value.trim()) {
      for (const p of notion.pages) {
        out.push({ kind: "Notion", name: p.title || t("Senza titolo"), score: Math.max(1, score(p.title, q)),
          icon: () => (p.emoji ? h("span", { text: p.emoji }) : markIcon("integration_notion", 14) ?? svg(ICONS.doc, 13)),
          run: () => { void Bridge.openUrl(p.url); doneIfSearchOnly(); } });
      }
    }
    if (rdmFound.q === input.value.trim()) {
      for (const e of rdmFound.list) {
        out.push({ kind: "RDM", name: e.group ? `${e.name} · ${e.group.split(/[\\/]/).pop()}` : e.name, score: Math.max(1, score(e.name, q)),
          icon: () => h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
          run: () => { void Bridge.rdmOpen(e).catch(() => {}); doneIfSearchOnly(); } });
      }
      // The cloud: a folder opens in the RDM card, an entry with its pane (user, password with the eye).
      for (const e of rdmFound.cloud) {
        const mark = e.kind === "Group" ? "📁" : e.cred === "PasswordList" ? "📋" : e.kind.startsWith("Credential") ? "🔑" : "";
        out.push({ kind: "Cloud", name: e.folder ? `${e.name} · ${e.folder.split(/[\\/]/).pop()}` : e.name, score: Math.max(1, score(e.name, q)),
          icon: () => mark ? h("span", { text: mark }) : h("span", { class: "rdm-kind", text: kindLabel(e.kind) }),
          run: () => { actions.openTask("integration_rdm"); rdmShowEntry(e); } });
      }
    }
    if (more.q === input.value.trim()) {
      for (const p of more.pages) {
        out.push({ kind: "Memoria", name: [p.title, p.gist, p.origin].filter(Boolean).join(" · "), score: Math.max(1, score(p.title, q)), node: p.id,
          icon: () => svg(ICONS.memory, 13, { stroke: 1.8 }), run: () => actions.memoryChat(p.id, p.title) });
      }
      for (const c of more.chats) {
        out.push({ kind: "Conversazione", name: c.title || t("Senza titolo"), score: Math.max(1, score(c.title, q)),
          icon: () => svg(ICONS.history, 13, { stroke: 2 }), run: () => actions.reopenChat(c.id) });
      }
      for (const tk of more.tickets) {
        out.push({ kind: "Ticket", name: tk.title, score: Math.max(1, score(tk.title, q)),
          icon: () => markIcon("integration_zammad", 14) ?? svg(ICONS.doc, 13), run: () => { void Bridge.openUrl(tk.url); doneIfSearchOnly(); } });
      }
      // A contact: «Chiama …» with its first number (the 3CX card shows the call).
      for (const c of more.contacts) {
        const number = c.numbers[0];
        const who = [c.name, c.company].filter(Boolean).join(" · ");
        // Never above a page or an integration: Enter on the first result must not place a call by surprise.
        out.push({ kind: "Contatto", name: t("Chiama {who} · {n}", { who, n: number }), score: 1,
          icon: () => markIcon("integration_3cx", 14) ?? svg(ICONS.bubble, 13),
          run: () => { actions.openTask("integration_3cx"); void Bridge.threecxCall(number, null).catch(() => {}); } });
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
    clear(list);
    hits.forEach((hit, i) => {
      list.append(h("button", { class: i === sel ? "search-hit on" : "search-hit",
        onpointerenter: () => { sel = i; mark(); },
        onclick: () => choose(hit) },
      h("span", { class: "search-icon" }, hit.icon()),
      h("span", { class: "search-name", text: hit.name }),
      h("span", { class: "search-kind", text: KIND_LABEL[hit.kind] })));
    });
    countPill.textContent = hits.length ? tn("{n} risultato", "{n} risultati", hits.length, { n: hits.length }) : "";
    drawAnswer();
    showSky();
  };

  const mark = () => {
    [...list.children].forEach((c, i) => c.classList.toggle("on", i === sel));
    (list.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    picked = "";
    showSky();
  };

  /** `keep`: Notion answered, the selection stays where it is. `quick`: no closing animation. */
  const refresh = (keep = false, quick = false) => {
    const q = fold(input.value.trim());
    hits = q ? collect(q) : [];
    if (!keep) {
      sel = 0;
      picked = "";
      const raw = input.value.trim();
      if (calculate(raw) == null) {
        askNotion(raw);
        askRdm(raw);
        askMore(raw);
        askQuick(raw);
      }
    } else if (sel >= hits.length) sel = 0;
    el.classList.toggle("open", !!q);
    if (q) {
      el.classList.remove("closing");
      draw();
      actions.onLayout?.();
      return;
    }
    clear(list);
    countPill.textContent = "";
    drawAnswer();
    memory = null;
    memoryAsked = false;
    // The stars go back into the middle before the panel leaves.
    if (sky.shown && !quick) {
      el.classList.add("closing");
      sky.hide(false, () => {
        el.classList.remove("closing");
        actions.onLayout?.();
      });
    } else {
      el.classList.remove("closing");
      sky.hide(true);
    }
    actions.onLayout?.();
  };

  const reset = (quick = false) => {
    input.value = "";
    refresh(false, quick);
  };

  const choose = (hit: Hit) => {
    reset(true);
    input.blur();
    hit.run();
  };

  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    reset();
    input.focus({ preventScroll: true });
  });

  const focusInput = () => {
    const active = document.activeElement;
    if (active === input) return;
    if (active && active !== document.body && active !== document.documentElement && active.matches("input, textarea, [contenteditable]")) return;
    input.focus({ preventScroll: true });
    loadApps();
  };
  // The island's window takes no keys until asked (as for the ⚡ search field).
  input.addEventListener("pointerdown", () => {
    if (!document.hasFocus()) void Bridge.focusWindow(true);
  });
  input.addEventListener("focus", () => {
    loadApps();
    if (!document.hasFocus()) void Bridge.focusWindow(true);
  });
  window.addEventListener("focus", () => {
    const allow = actions.canAutoFocus ? actions.canAutoFocus() : (State.mode === "expanded" && !State.pendingApproval);
    if (!allow) return;
    focusInput();
  });
  input.addEventListener("input", () => refresh());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (input.value) reset();
      else if (State.searchOnly) actions.onEscape?.();
      else input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || (State.searchOnly && e.key === "Tab" && hits.length)) {
      e.preventDefault();
      if (!hits.length) return;
      const forward = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
      sel = (sel + (forward ? 1 : hits.length - 1)) % hits.length;
      mark();
    } else if (e.key === "Enter") {
      // The star clicked is what is on show: Invio starts from it.
      if (picked && !e.ctrlKey && !e.altKey) {
        sky.onChat(picked);
        return;
      }
      const hit = e.ctrlKey ? hits.find((x) => x.kind === "Chat") : e.altKey ? hits.find((x) => x.kind === "Web") : hits[sel];
      if (hit) choose(hit);
    }
  });

  return {
    el,
    get open() { return el.classList.contains("open"); },
    resultsHeight() {
      if (!el.classList.contains("open")) return 0;
      const listH = list.scrollHeight;
      const skyH = sky.shown ? 178 : 0;
      if (State.searchOnly) {
        const skyBlock = sky.shown ? skyH + 16 : 0;
        const raw = 2 + skyBlock + listH + 30;
        return sky.shown ? Math.max(384, raw) : raw;
      }
      const raw = 14 + skyH + listH;
      return sky.shown ? Math.max(324, raw) : raw;
    },
    sync() {
      // The island closed: start again empty next time.
      if (State.mode !== "expanded" && input.value) reset(true);
    },
    focusInputOnly() {
      focusInput();
    },
    focus() {
      focusInput();
      if (!document.hasFocus()) {
        void Bridge.focusWindow(true).then(() => {
          const allow = actions.canAutoFocus ? actions.canAutoFocus() : (State.mode === "expanded" && !State.pendingApproval);
          if (allow) focusInput();
        });
      }
    },
    blur() {
      if (document.activeElement === input) input.blur();
    },
    close() {
      if (input.value) reset(true);
      input.blur();
    },
  };
}
