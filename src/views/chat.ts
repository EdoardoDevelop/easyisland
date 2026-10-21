// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatSummary } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, State, engineLabel, type ChatEngine, type ChatMessage, type QuickAction } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import type { ViewHost } from "./views";
import { remoteData, toggleRemoteLink } from "./remote";
import { locale, t, tn } from "../core/i18n";

let nextId = 1;

/** Set by the chat view: sends a message as if typed (used by quick actions). */
let externalSend: ((query: string) => void) | null = null;

/** The browser preview has no backend: a scene fills the history list here (dev/scenes.ts). */
let historyDemo: ChatSummary[] = [];
export function setHistoryDemo(list: ChatSummary[]) {
  historyDemo = list;
}

/** Starts a question from outside the chat (a quick action, a shortcut). */
export function sendToChat(query: string) {
  externalSend?.(query);
}

/** The text being written survives a restart of EasyIsland (only this one, on this PC). */
const DRAFT_KEY = "easyisland.chatDraft";
function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage off: the draft just does not survive */
  }
}

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    const b = h("div", { class: "bubble", text: message.content });
    if (message.file) b.prepend(h("div", { class: "bubble-file", text: `📎 ${message.file}` }));
    return h("div", { class: "chat-row user" }, b);
  }
  // Claude answers in markdown: rendered as DOM, never as HTML (core/markdown.ts).
  if (message.reviewer) {
    return h("div", { class: "chat-row" },
      h("div", { class: "reply md second" },
        h("div", { class: "second-head", text: `⇄ ${t("Seconda opinione · {e}", { e: message.reviewer })}` }),
        ...renderMarkdown(message.content, MD_HOOKS)));
  }
  return h("div", { class: "chat-row" },
    h("div", { class: "reply md" }, ...renderMarkdown(message.content, MD_HOOKS)));
}

const MD_HOOKS = { openUrl: (url: string) => void Bridge.openUrl(url) };

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/**
 * The coloured chip showing what the question is about (a dropped file, a
 * window: then a small picture of it, and ✕ takes it away).
 */
function contextChip(label: string, thumb?: string, remove?: () => void, removeTitle = t("Togli la finestra")): HTMLElement {
  const lead = thumb ? h("img", { class: "chip-thumb", src: thumb, alt: "" }) : h("i", { class: "chip-dot" });
  const chip = h("div", { class: "chip" }, lead, h("span", { text: label }));
  if (remove) chip.append(h("button", { class: "chip-del", title: removeTitle, text: "✕", onclick: remove }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

/** "Google Chrome — Titolo della pagina", shortened: the chip has one line. */
export function windowLabel(w: { appName: string; title: string }): string {
  const title = w.title.length > 60 ? `${w.title.slice(0, 59)}…` : w.title;
  if (!w.appName) return title || t("Finestra");
  return title && title !== w.appName ? `${w.appName} — ${title}` : w.appName;
}

/** A command typed after "/" in the field (the menu over it lists them). */
interface Slash {
  name: string;
  hint: string;
  /** Takes the words after it («/ricorda il cliente Rossi paga a 60 giorni»). */
  arg?: boolean;
  run(arg: string): void;
}

/** "Backup giornaliero" → "backup-giornaliero": a quick action as a command. */
function slug(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildPrompt(onHeightChange: () => void, actions: { runAction(a: QuickAction): void }): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  // The engine and model, above the chat: a click picks another one.
  const engineBtn = h("button", { class: "engine-pick", title: t("Cambia motore della chat") }) as HTMLButtonElement;
  const engineMenu = h("div", { class: "engine-menu" });
  engineMenu.style.display = "none";
  // The conversations of before (chat_log.rs): a click reopens one.
  const historyBtn = h("button", { class: "history-btn", title: t("Cronologia delle chat") }, svg(ICONS.history, 13, { stroke: 2 })) as HTMLButtonElement;
  const historyMenu = h("div", { class: "history-menu" });
  historyMenu.style.display = "none";
  // «Esporta»: the conversation as a Markdown file in the Vassoio.
  const exportBtn = h("button", { class: "history-btn", title: t("Esporta la conversazione in Markdown (nel Vassoio)"), text: "⤓" }) as HTMLButtonElement;
  // "Automatica" (Modalità terminale): this conversation goes on without
  // Consenti / Nega — Claude Code's auto mode, everything for opencode.
  const autoBtn = h("button", { class: "auto-btn" }, svg(ICONS.bolt, 12), h("span", { text: t("Automatica") })) as HTMLButtonElement;
  // Accesso remoto (remote.ts): with a connection open, 🔌 links this chat to that PC.
  const remoteBtn = h("button", { class: "auto-btn remote-btn" }, h("span", { text: "🔌" }), h("span", { class: "remote-name" })) as HTMLButtonElement;
  const head = h("div", { class: "chat-head" }, chipRow, engineBtn, remoteBtn, autoBtn, historyBtn, exportBtn, engineMenu);
  const log = h("div", { class: "chat-log" });
  // Scrolled up to read: new text does not pull the view down; ↓ goes back.
  let stick = true;
  const jumpBtn = h("button", { class: "chat-jump", title: t("Vai in fondo"), text: "↓" }) as HTMLButtonElement;
  jumpBtn.style.display = "none";
  // A reply arriving (OpenAI-compatible engines stream it, openai.rs).
  let streamEl: HTMLElement | null = null;
  let streamed = "";
  // Grows with the text up to a few lines, then scrolls (fit()).
  // Enter sends, Shift+Enter starts a new line.
  const input = h("textarea", {
    class: "chat-input",
    rows: "1",
    placeholder: t("Chiedimi qualsiasi cosa…"),
    spellcheck: "false",
  }) as HTMLTextAreaElement;
  input.value = loadDraft();
  function fit() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  const send = h("button", { class: "send-btn", title: t("Invia") }, svg(ICONS.arrowUp, 14));
  const fresh = h("button", { class: "new-chat-btn", title: t("Nuova chat (Ctrl+N)") }, svg(ICONS.plus, 12), h("span", { text: t("Nuova chat") }));
  const bar = h("div", { class: "chat-bar" }, fresh, input, send);
  // "/" in the field: the commands, over the field.
  const slashMenu = h("div", { class: "slash-menu" });
  slashMenu.style.display = "none";
  let slashItems: Slash[] = [];
  let slashSel = 0;
  // A short line over the field: «Modifica…», «Salvato in memoria», an error.
  const hintRow = h("div", { class: "chat-hint" });
  hintRow.style.display = "none";
  let hintTimer = 0;
  // The calculator: a calculation typed in the field shows its result here.
  const calcValue = h("b", { class: "calc-value" });
  const calcHint = h("span", { class: "calc-hint", text: t("Invio copia · Ctrl+Invio chiede alla chat") });
  const calcRow = h("div", { class: "calc-row" }, h("span", { class: "calc-eq", text: "=" }), calcValue, calcHint);
  calcRow.style.display = "none";
  let calcResult: number | null = null;
  function updateCalc() {
    calcResult = input.value.startsWith("/") ? null : calculate(input.value);
    calcRow.style.display = calcResult == null ? "none" : "";
    if (calcResult != null) {
      calcValue.textContent = formatResult(calcResult);
      calcHint.textContent = t("Invio copia · Ctrl+Invio chiede alla chat");
      calcRow.classList.remove("copied");
    }
  }
  async function copyCalc() {
    if (calcResult == null) return;
    const text = plainResult(calcResult);
    try {
      await navigator.clipboard.writeText(text);
      calcHint.textContent = t("Copiato negli appunti ✓");
      calcRow.classList.add("copied");
      Sound.play("finish");
    } catch {
      calcHint.textContent = t("Copia non riuscita");
    }
  }

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, head, historyMenu, log, jumpBtn, calcRow, hintRow, slashMenu, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  // "Ferma" pressed: the reply so far stays, without the error note.
  let stopping = false;
  let renderedCount = -1;
  let drafted = input.value !== "";
  // «Modifica» on a question: its place in the conversation, until it is sent again.
  let editing: number | null = null;

  /** A line over the field for a few seconds (or until replaced; `keep`: until cleared). */
  function flash(text: string, keep = false) {
    window.clearTimeout(hintTimer);
    hintRow.textContent = text;
    hintRow.style.display = text ? "" : "none";
    if (text && !keep) hintTimer = window.setTimeout(() => { hintRow.style.display = "none"; onHeightChange(); }, 4500);
    onHeightChange();
  }

  /** What the conversation was so far, as chat_log.rs keeps it. */
  function lines(list: ChatMessage[]) {
    return list.map((m) => ({ role: m.role, content: m.content }));
  }

  function setInput(text: string) {
    input.value = text;
    fit();
    saveDraft(text);
    updateCalc();
    updateSlash();
  }

  async function submit(override?: string) {
    const raw = override ?? input.value;
    const query = raw.trim();
    if (!query || sending) return;
    if (override == null && runSlash(query)) return;
    if (override == null) setInput("");
    sending = true;
    stopping = false;
    stick = true;
    if (historyMenu.style.display !== "none") showHistory(false);
    // «Modifica»: the conversation goes back to just before that question.
    if (editing != null) {
      const keep = State.chatHistory.slice(0, editing);
      editing = null;
      flash("");
      State.chatHistory = keep;
      renderedCount = -1;
      await Bridge.chatRewind(lines(keep));
    }
    Sound.play("send");

    const file = State.droppedFile;
    const text = State.chatText;
    const win = State.chatWindow;
    const attach = State.chatAttach;
    State.chatAttach = null;
    const first = State.chatHistory.length === 0;
    State.chatHistory.push({ id: nextId++, role: "user", content: query, file: attach?.name });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const base: ChatContext | null = !first
      ? null
      : text
        ? { kind: "text", label: text.label, text: text.text }
        : win
          ? { kind: "window", appName: win.appName, title: win.title, image: win.path }
          : file
            ? { kind: "file", name: file.name, path: file.path }
            : null;
    // A file added on the way goes as the context; with another one already
    // there, its path goes in the question for the engines that read files.
    let context = base;
    let asked = query;
    if (attach && !base) context = { kind: "file", name: attach.name, path: attach.path };
    else if (attach) asked = `${t("File allegato: {name}\nPercorso: {path}", { name: attach.name, path: attach.path })}\n\n${query}`;

    streamed = "";
    try {
      // "Chiedi a questa sessione": a read-only copy of the session answers;
      // the next questions go on in that copy.
      const session = State.chatSession;
      const reply = session
        ? await Bridge.sessionAsk(session.sessionId, session.fork, session.cwd, query).then((r) => {
          if (State.chatSession === session) session.fork = r.fork;
          return r;
        })
        : await Bridge.chatSend(asked, context, State.chatEngine, State.chatAuto && State.settings.chatTerminal === true);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text, engine: session ? undefined : State.chatEngine });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      if (stopping) {
        const soFar = streamed.trim();
        State.chatHistory.push({ id: nextId++, role: "assistant", content: `${soFar ? soFar + "\n\n" : ""}⏹ ${t("Fermato.")}` });
        Sound.play("blip");
        return;
      }
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      stopping = false;
      streamed = "";
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  /** «Rigenera»: the last question asked again, its answer forgotten. */
  async function regenerate() {
    if (sending) return;
    const list = State.chatHistory;
    const u = list.map((m) => m.role === "user").lastIndexOf(true);
    if (u < 0) return;
    const question = list[u].content;
    const keep = list.slice(0, u);
    State.chatHistory = keep;
    renderedCount = -1;
    await Bridge.chatRewind(lines(keep));
    await submit(question);
  }

  /** «Modifica»: the question back in the field; sending it starts over from there. */
  function edit(index: number) {
    if (sending) return;
    editing = index;
    setInput(State.chatHistory[index]?.content ?? "");
    flash(`✎ ${t("Stai modificando la domanda: invia per ripartire da lì · Esc annulla")}`, true);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function cancelEdit() {
    editing = null;
    setInput("");
    flash("");
  }

  async function copyText(text: string, btn: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = t("Copiato ✓");
    } catch {
      btn.textContent = t("Copia non riuscita");
    }
    window.setTimeout(() => { btn.textContent = t("Copia"); }, 1400);
  }

  /** Copia under every message, Rigenera under the last answer, Modifica under a question. */
  function withActions(row: HTMLElement, m: ChatMessage, index: number, last: boolean): HTMLElement {
    const bar = h("div", { class: `msg-actions${last ? " last" : ""}` });
    const copy = h("button", { class: "msg-act", text: t("Copia") }) as HTMLButtonElement;
    copy.addEventListener("click", () => void copyText(m.content, copy));
    bar.append(copy);
    const own = !State.chatSession && !sending;
    if (own && m.role === "user") {
      bar.append(h("button", { class: "msg-act", text: t("Modifica"), onclick: () => edit(index) }));
    }
    if (own && last && m.role === "assistant" && !m.reviewer) {
      bar.append(h("button", { class: "msg-act", text: `↻ ${t("Rigenera")}`, onclick: () => void regenerate() }));
    }
    row.classList.add("with-actions");
    row.append(bar);
    return row;
  }

  /**
   * The answer a second opinion is about: the last one not written by a
   * reviewer, with its question and engine (none for a session's copy or a
   * stopped answer).
   */
  function reviewable(): { question: string; answer: string; engine: string } | null {
    const list = State.chatHistory;
    const i = list.map((m) => m.role === "assistant" && !m.reviewer).lastIndexOf(true);
    const a = list[i];
    if (!a?.engine || a.content.endsWith(`⏹ ${t("Fermato.")}`)) return null;
    const q = list.slice(0, i).reverse().find((m) => m.role === "user");
    return q ? { question: q.content, answer: a.content, engine: a.engine } : null;
  }

  /** «⇄ Seconda opinione»: another engine reviews the last answer (second.rs). */
  async function secondOpinion(engine: ChatEngine) {
    const target = reviewable();
    if (!target || sending) return;
    const name = CHAT_ENGINES.find((e) => e.id === engine)?.name ?? engine;
    sending = true;
    stopping = false;
    stick = true;
    Sound.play("send");
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();
    streamed = "";
    try {
      const text = await Bridge.chatSecond(engine, target.engine, target.question, target.answer);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: text, reviewer: name });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      if (stopping) {
        const soFar = streamed.trim();
        State.chatHistory.push({ id: nextId++, role: "assistant", content: `${soFar ? soFar + "\n\n" : ""}⏹ ${t("Fermato.")}`, reviewer: name });
        Sound.play("blip");
        return;
      }
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      stopping = false;
      streamed = "";
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  /** The button under the last answer, and its menu of the other engines. */
  function secondRow(): HTMLElement {
    const menu = h("div", { class: "second-menu" });
    menu.style.display = "none";
    const btn = h("button", { class: "second-btn", title: t("Un altro motore controlla quest'ultima risposta"), text: `⇄ ${t("Seconda opinione")}` }) as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      if (menu.style.display !== "none") {
        menu.style.display = "none";
        onHeightChange();
        return;
      }
      const first = reviewable()?.engine;
      const list = (await readyEngines()).filter((e) => e.id !== first);
      clear(menu);
      for (const e of list) {
        menu.append(h("button", {
          class: "engine-item", title: e.hint,
          text: engineLabel({ ...State.settings, chatEngine: e.id }),
          onclick: () => void secondOpinion(e.id),
        }));
      }
      if (!list.length) menu.append(h("div", { class: "engine-note", text: t("Nessun altro motore pronto: Impostazioni → Chat") }));
      menu.style.display = "";
      log.scrollTop = log.scrollHeight;
      onHeightChange();
    });
    return h("div", { class: "chat-row second-row" }, btn, menu);
  }

  /** Forgets the conversation and whatever it was about (file, copied text). */
  function startOver() {
    if (sending) return;
    if (historyMenu.style.display !== "none") showHistory(false);
    State.chatHistory = [];
    State.droppedFile = null;
    State.chatText = null;
    State.chatWindow = null;
    State.chatAttach = null;
    State.promptContext = null;
    State.chatSession = null;
    // An engine picked in the menu was for that conversation only; so was "Automatica".
    State.chatEngineOverride = null;
    State.chatAuto = false;
    editing = null;
    flash("");
    void Bridge.chatReset();
    Sound.play("blip");
    State.notify();
    onHeightChange();
    setInput("");
    input.focus();
  }

  /** «/oggi», «/domani»: the day gathered by the engine with EasyIsland's tools. */
  async function day(tomorrow: boolean) {
    const prompt = await Bridge.chatDayPrompt(tomorrow);
    await submit(prompt || (tomorrow ? t("Com'è la mia giornata di domani?") : t("Com'è la mia giornata di oggi?")));
  }

  /** «/ricorda …»: a note in the chat's memory (memory.rs), no model asked. */
  async function remember(text: string) {
    if (!text.trim()) {
      flash(t("Scrivi cosa ricordare dopo /ricorda"));
      return;
    }
    try {
      flash(`🧠 ${await Bridge.memoryNote(text)}`);
      Sound.play("finish");
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  /** «Esporta»: the conversation as Markdown in the Vassoio. */
  async function exportChat() {
    if (!State.chatHistory.length) {
      flash(t("Niente da esportare: la conversazione è vuota."));
      return;
    }
    const firstQ = State.chatHistory.find((m) => m.role === "user")?.content ?? t("Chat");
    const title = firstQ.split(/\s+/).join(" ").slice(0, 60);
    try {
      const f = await Bridge.chatExport(title, lines(State.chatHistory));
      flash(`⤓ ${t("Esportata nel Vassoio: {name}", { name: f.name })}`);
      Sound.play("finish");
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  /** Ctrl+V with files copied in Explorer or a picture: they join the question. */
  async function pasteFile() {
    try {
      const f = await Bridge.chatPaste();
      if (!f) return;
      State.chatAttach = { name: f.name, path: f.path };
      Sound.play("approve");
      State.notify();
      onHeightChange();
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  function commands(): Slash[] {
    const list: Slash[] = [
      { name: "nuova", hint: t("Nuova chat"), run: () => startOver() },
      { name: "cronologia", hint: t("Le conversazioni di prima"), run: () => void toggleHistory() },
      { name: "cerca", hint: t("Cerca nelle conversazioni di prima"), arg: true, run: (a) => void toggleHistory(a) },
      { name: "ricorda", hint: t("Salva una nota nella memoria della chat"), arg: true, run: (a) => void remember(a) },
      { name: "memoria", hint: t("Apri la memoria della chat (MEMORIA.md)"), run: () => void Bridge.memoryOpen(false).catch((e) => flash(String(e))) },
      { name: "esporta", hint: t("La conversazione in Markdown, nel Vassoio"), run: () => void exportChat() },
      { name: "motore", hint: t("Cambia motore per questa chat"), run: () => void toggleEngineMenu() },
      { name: "oggi", hint: t("Il punto della mia giornata di oggi"), run: () => void day(false) },
      { name: "domani", hint: t("Il punto della mia giornata di domani"), run: () => void day(true) },
    ];
    const taken = new Set(list.map((c) => c.name));
    for (const a of State.settings.actions ?? []) {
      const name = slug(a.name);
      if (!name || taken.has(name)) continue;
      taken.add(name);
      list.push({ name, hint: `${a.icon} ${t("Azione rapida: {n}", { n: a.name })}`, run: () => actions.runAction(a) });
    }
    return list;
  }

  /** The command typed in the field, if it is one: run it (true) or leave it to the engine. */
  function runSlash(text: string): boolean {
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!m) return false;
    const cmd = commands().find((c) => c.name === m[1].toLowerCase());
    if (!cmd) return false;
    setInput("");
    cmd.run((m[2] ?? "").trim());
    return true;
  }

  /** The menu over the field while a command is being typed. */
  function updateSlash() {
    const m = /^\/(\S*)$/.exec(input.value);
    slashItems = m && !State.chatSession ? commands().filter((c) => c.name.startsWith(m[1].toLowerCase())).slice(0, 8) : [];
    slashSel = Math.min(slashSel, Math.max(0, slashItems.length - 1));
    clear(slashMenu);
    slashItems.forEach((c, i) => {
      const row = h("button", { class: `slash-item${i === slashSel ? " on" : ""}` },
        h("b", { text: `/${c.name}` }), h("span", { text: c.hint }));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSlash(i);
      });
      slashMenu.append(row);
    });
    const show = slashItems.length > 0;
    if ((slashMenu.style.display !== "none") !== show) {
      slashMenu.style.display = show ? "" : "none";
      onHeightChange();
    }
  }

  function pickSlash(i: number) {
    const c = slashItems[i];
    if (!c) return;
    if (c.arg) {
      setInput(`/${c.name} `);
      input.focus();
      return;
    }
    setInput("");
    c.run("");
  }

  /** Claude Code with its login, asked once per run (it starts a process). */
  let cliReady: Promise<boolean> | null = null;

  /** Engines worth offering: the default and the one in use, then only the configured ones. */
  async function readyEngines(): Promise<typeof CHAT_ENGINES> {
    const s = State.settings;
    const out: typeof CHAT_ENGINES = [];
    for (const e of CHAT_ENGINES) {
      if (e.id === s.chatEngine || e.id === State.chatEngine) { out.push(e); continue; }
      if (e.id === "subscription") {
        cliReady ??= Bridge.claudeCliStatus().then((st) => !!st?.found && !!st.loggedIn);
        if (await cliReady) out.push(e);
        continue;
      }
      const hasModel = e.id === "api" || !!s.engineModels?.[e.id];
      const hasKey = !e.key || ((await Bridge.secretPresent(e.key)) ?? false);
      if (hasModel && hasKey) out.push(e);
    }
    return out;
  }

  async function toggleEngineMenu() {
    if (engineMenu.style.display !== "none") {
      engineMenu.style.display = "none";
      return;
    }
    const list = await readyEngines();
    clear(engineMenu);
    for (const e of list) {
      const label = engineLabel({ ...State.settings, chatEngine: e.id }) + (e.id === State.settings.chatEngine ? t(" (predefinito)") : "");
      engineMenu.append(h("button", {
        class: `engine-item${e.id === State.chatEngine ? " on" : ""}`, title: e.hint, text: label,
        onclick: () => pickEngine(e.id),
      }));
    }
    engineMenu.append(h("div", { class: "engine-note", text: t("Vale per questa chat. Predefinito, chiavi e modelli: Impostazioni → Chat") }));
    engineMenu.style.display = "";
  }

  /** Only for the conversation in progress: the default stays in Impostazioni → Chat. */
  function pickEngine(id: ChatEngine) {
    engineMenu.style.display = "none";
    if (id === State.chatEngine || sending) return;
    // Another engine is another conversation (the backend starts over too).
    if (State.chatHistory.length) startOver();
    State.chatEngineOverride = id === State.settings.chatEngine ? null : id;
    State.notify();
  }

  /** "14:30" today, "8 ott" this year, "8 ott 2025" before. */
  function when(ms: number): string {
    const d = new Date(ms);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
  }

  /** The list takes the conversation's place in the card while it is open. */
  function showHistory(open: boolean) {
    historyMenu.style.display = open ? "" : "none";
    log.style.display = open ? "none" : "";
    jumpBtn.style.display = "none";
    historyBtn.classList.toggle("on", open);
    State.notify();
    onHeightChange();
  }

  // The search field on top of the history list, and the rows under it.
  const historySearch = h("input", { class: "history-search", type: "text", placeholder: t("Cerca nelle conversazioni…"), spellcheck: "false" }) as HTMLInputElement;
  const historyRows = h("div", { class: "history-rows" });
  let searchTimer = 0;
  let searchSeq = 0;

  async function loadHistory(query: string): Promise<ChatSummary[]> {
    const q = query.trim();
    const found = q ? await Bridge.chatHistorySearch(q) : await Bridge.chatHistoryList();
    if (found) return found;
    // The preview: the demo list, filtered by title.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return historyDemo
      .filter((c) => words.every((w) => c.title.toLowerCase().includes(w)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }

  function renderHistory(list: ChatSummary[], query: string) {
    clear(historyRows);
    if (!list.length) {
      historyRows.append(h("div", { class: "engine-note", text: query.trim()
        ? t("Nessuna conversazione con queste parole.")
        : State.settings.chatHistory === false
          ? t("La cronologia è spenta: Impostazioni → Chat.")
          : t("Ancora nessuna conversazione. Restano qui, su questo PC.") }));
    }
    for (const c of list) {
      const engine = CHAT_ENGINES.find((e) => e.id === c.engine)?.name ?? c.engine;
      const del = h("button", { class: "history-del", title: t("Elimina"), text: "✕" });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void Bridge.chatHistoryDelete(c.id);
        historyDemo = historyDemo.filter((x) => x.id !== c.id);
        row.remove();
        onHeightChange();
      });
      const pin = h("button", { class: `history-pin${c.pinned ? " on" : ""}`, title: c.pinned ? t("Togli dai fissati") : t("Fissa in cima") }, svg(ICONS.pin, 11));
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        c.pinned = !c.pinned;
        void Bridge.chatHistoryPin(c.id, c.pinned);
        const demo = historyDemo.find((x) => x.id === c.id);
        if (demo) demo.pinned = c.pinned;
        void refreshHistory();
      });
      const row = h("div", { class: "history-item", title: c.title, onclick: () => void reopen(c.id) },
        h("div", { class: "history-text" },
          h("span", { class: "history-title", text: `${c.pinned ? "📌 " : ""}${c.title}` }),
          h("span", { class: "history-meta", text: `${when(c.updated)} · ${engine} · ${tn("{n} domanda", "{n} domande", c.turns)}` })),
        pin, del);
      historyRows.append(row);
    }
    onHeightChange();
  }

  async function refreshHistory() {
    const seq = ++searchSeq;
    const q = historySearch.value;
    const list = await loadHistory(q);
    if (seq === searchSeq) renderHistory(list, q);
  }

  historySearch.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void refreshHistory(), 150);
  });
  historySearch.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if ((e as KeyboardEvent).key === "Escape") {
      showHistory(false);
      input.focus();
    }
  });
  historyMenu.append(historySearch, historyRows);

  async function toggleHistory(query?: string) {
    engineMenu.style.display = "none";
    if (historyMenu.style.display !== "none" && query == null) {
      showHistory(false);
      return;
    }
    historySearch.value = query ?? "";
    await refreshHistory();
    showHistory(true);
    if (query != null) historySearch.focus();
  }

  /** The conversation comes back in place of the current one, on its engine. */
  async function reopen(id: string) {
    if (sending) return;
    try {
      const c = await Bridge.chatHistoryOpen(id);
      State.chatHistory = c.lines.map((l) => ({ id: nextId++, role: l.role, content: l.content }));
      State.droppedFile = null;
      State.chatText = null;
      State.chatWindow = null;
      State.chatAttach = null;
      State.promptContext = null;
      State.chatSession = null;
      State.chatEngineOverride = c.engine === State.settings.chatEngine ? null : (c.engine as ChatEngine);
      State.chatAuto = false;
      editing = null;
      flash("");
      renderedCount = -1;
      stick = true;
      Sound.play("blip");
      showHistory(false);
      State.notify();
      input.focus();
    } catch (err) {
      showHistory(false);
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      State.notify();
    }
  }

  engineBtn.addEventListener("click", () => {
    if (historyMenu.style.display !== "none") showHistory(false);
    void toggleEngineMenu();
  });
  historyBtn.addEventListener("click", () => void toggleHistory());
  exportBtn.addEventListener("click", () => void exportChat());
  remoteBtn.addEventListener("click", async () => {
    const problem = await toggleRemoteLink();
    if (problem) {
      const before = input.placeholder;
      input.placeholder = problem;
      remoteBtn.title = problem;
      window.setTimeout(() => { if (input.placeholder === problem) input.placeholder = before; }, 6000);
    }
    input.focus();
  });
  autoBtn.addEventListener("click", () => {
    State.chatAuto = !State.chatAuto;
    Sound.play("blip");
    State.notify();
    input.focus();
  });
  // Drawn in the island (a native <select> menu would open behind it); a click elsewhere closes it.
  document.addEventListener("pointerdown", (e) => {
    if (engineMenu.style.display !== "none" && !head.contains(e.target as Node)) engineMenu.style.display = "none";
  });
  void onEvent<{ text: string }>("chat-stream", (p) => {
    if (!sending) return;
    streamed = p.text;
    State.notify();
  });

  log.addEventListener("scroll", () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    jumpBtn.style.display = stick ? "none" : "";
  });
  jumpBtn.addEventListener("click", () => {
    stick = true;
    log.scrollTop = log.scrollHeight;
    jumpBtn.style.display = "none";
    input.focus();
  });
  function toBottom() {
    if (stick) log.scrollTop = log.scrollHeight;
    else jumpBtn.style.display = "";
  }

  externalSend = (q) => void submit(q);
  fresh.addEventListener("click", startOver);
  send.addEventListener("click", () => {
    // While a reply is written the button is "Ferma" (not for "Chiedi a questa sessione").
    if (sending) {
      if (!State.chatSession && !stopping) {
        stopping = true;
        void Bridge.chatStop();
      }
      return;
    }
    void submit();
  });
  input.addEventListener("input", () => {
    updateCalc();
    fit();
    saveDraft(input.value);
    slashSel = 0;
    updateSlash();
    onHeightChange();
  });
  input.addEventListener("paste", (e) => {
    const items = Array.from((e as ClipboardEvent).clipboardData?.items ?? []);
    // Text pastes as text; files or a picture join the question.
    if (!items.some((i) => i.kind === "file")) return;
    e.preventDefault();
    void pasteFile();
  });
  input.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    e.stopPropagation(); // Escape closes the island, not the chat
    if (slashItems.length) {
      if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        e.preventDefault();
        slashSel = (slashSel + (k.key === "ArrowDown" ? 1 : slashItems.length - 1)) % slashItems.length;
        updateSlash();
        return;
      }
      if (k.key === "Tab" || (k.key === "Enter" && !k.shiftKey)) {
        e.preventDefault();
        pickSlash(slashSel);
        return;
      }
      if (k.key === "Escape") {
        setInput("");
        return;
      }
    }
    if (k.key === "Escape" && editing != null) {
      cancelEdit();
      return;
    }
    // ↑ in the empty field: the last question back, to change and send again.
    if (k.key === "ArrowUp" && input.value === "" && !sending) {
      const last = [...State.chatHistory].reverse().find((m) => m.role === "user");
      if (last) {
        e.preventDefault();
        setInput(last.content);
      }
      return;
    }
    if (k.key === "Enter" && !k.shiftKey && !k.isComposing) {
      e.preventDefault();
      // A calculation: Enter copies the result, Ctrl+Enter still asks Claude.
      if (calcResult != null && !k.ctrlKey) void copyCalc();
      else void submit();
    }
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const text = State.chatText;
      const win = State.chatWindow;
      const asked = State.chatSession;
      const pick = State.windowPick;
      const attach = State.chatAttach;
      const wantChip = pick
        ? (pick.over ? t("Lascia per allegare: {name}", { name: pick.over }) : t("Lascia il personaggio su una finestra"))
        : asked
        ? t("Sessione {name} · copia in sola lettura", { name: asked.name })
        : text
        ? `${text.label} · ${t("{n} caratteri", { n: text.text.length.toLocaleString(locale()) })}`
        : win
        ? windowLabel(win)
        : file?.name ?? "";
      const chipKey = `${pick ? "pick" : ""}${wantChip}${win && !pick ? win.path : ""}|${attach?.path ?? ""}`;
      if (chipRow.dataset.label !== chipKey) {
        chipRow.dataset.label = chipKey;
        clear(chipRow);
        // The window can be taken away until the first question goes.
        const removable = !pick && !asked && !text && win && State.chatHistory.length === 0;
        const removeWin = () => {
          State.chatWindow = null;
          Sound.play("blip");
          State.notify();
          input.focus();
        };
        if (wantChip) {
          const chip = contextChip(wantChip, !pick && !asked && !text && win ? win.thumb : undefined, removable ? removeWin : undefined);
          if (pick) chip.classList.add("pick");
          chipRow.append(chip);
        }
        if (attach && !pick) {
          chipRow.append(contextChip(`📎 ${attach.name}`, undefined, () => {
            State.chatAttach = null;
            Sound.play("blip");
            State.notify();
            input.focus();
          }, t("Togli il file")));
        }
      }

      engineBtn.textContent = `${engineLabel({ ...State.settings, chatEngine: State.chatEngine })} ▾`;
      // Asking a session: Claude Code answers, whatever the chat's engine.
      engineBtn.style.display = asked ? "none" : "";
      exportBtn.style.display = State.chatHistory.length ? "" : "none";
      // 🔌: only while a remote connection is open, never on a session copy.
      const remote = remoteData();
      remoteBtn.style.display = remote.connected && !asked ? "" : "none";
      remoteBtn.classList.toggle("on", !!remote.linked);
      remoteBtn.querySelector<HTMLElement>(".remote-name")!.textContent = remote.name || remote.host || "";
      remoteBtn.title = remote.linked
        ? t("La chat lavora su {n}: ogni comando lì chiede Consenti / Nega. Clic per scollegarla", { n: remote.name || remote.host || "" })
        : t("Collega la chat a {n}, il PC aperto in Accesso remoto", { n: remote.name || remote.host || "" });
      el.querySelector(".chat-card")?.classList.toggle("remote", !!remote.linked && !asked);
      // "Automatica": only with Modalità terminale, never on a session copy.
      const terminal = State.settings.chatTerminal === true && !asked;
      const auto = terminal && State.chatAuto;
      autoBtn.style.display = terminal ? "" : "none";
      autoBtn.classList.toggle("on", auto);
      el.querySelector(".chat-card")?.classList.toggle("auto", auto);
      autoBtn.title = State.chatEngine === "subscription"
        ? (auto ? t("Automatica: Claude Code decide da solo e blocca le azioni rischiose. Clic per tornare a Consenti / Nega")
          : t("Automatica: in questa conversazione Claude Code non chiede conferma per le azioni normali e blocca quelle rischiose"))
        : (auto ? t("Automatica: comandi e modifiche normali vanno da soli; cancellare, pubblicare, installare o cambiare il sistema chiede ancora. Clic per tornare a Consenti / Nega")
          : t("Automatica: in questa conversazione comandi e modifiche normali vanno senza chiedere; cancellare, pubblicare, installare o cambiare il sistema chiede ancora"));
      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0) + (streamed ? 0.25 : 0) + (sending ? 0.125 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        streamEl = null;
        const list = State.chatHistory;
        list.forEach((m, i) => log.append(withActions(bubble(m), m, i, i === list.length - 1)));
        if (!thinking && !sending && !asked && reviewable()) log.append(secondRow());
        if (thinking && streamed) {
          streamEl = h("div", { class: "chat-row" });
          log.append(streamEl);
        } else if (thinking) log.append(typingDots());
        toBottom();
      }
      // The growing reply: only its bubble is redrawn.
      if (streamEl && streamEl.dataset.len !== String(streamed.length)) {
        streamEl.dataset.len = String(streamed.length);
        streamEl.replaceChildren(bubble({ id: 0, role: "assistant", content: streamed }).firstChild!);
        toBottom();
      }

      if (State.chatDraft != null) {
        setInput(State.chatDraft);
        State.chatDraft = null;
        drafted = true;
      }
      if (State.chatInsert != null) {
        const before = input.value.trimEnd();
        setInput(`${before}${before ? " " : ""}${State.chatInsert} `);
        State.chatInsert = null;
        drafted = true;
      }
      input.placeholder = asked
        ? t("Chiedi alla sessione {name}…", { name: asked.name })
        : State.chatHistory.length === 0 ? t("Chiedimi qualsiasi cosa… / per i comandi") : t("Continua…");

      input.disabled = sending;
      const stopMode = sending && !asked;
      if (send.dataset.mode !== (stopMode ? "stop" : "send")) {
        send.dataset.mode = stopMode ? "stop" : "send";
        send.replaceChildren(svg(stopMode ? ICONS.stop : ICONS.arrowUp, stopMode ? 12 : 14));
        send.title = stopMode ? t("Ferma") : t("Invia");
        send.classList.toggle("stop", stopMode);
      }
      // Only when there is something to forget.
      fresh.style.display = State.chatHistory.length > 0 || file || text || win || asked || attach ? "" : "none";
      (fresh as HTMLButtonElement).disabled = sending;
    },
    // The open history list makes the island as tall as it needs (up to its maximum).
    fitHeight() {
      if (historyMenu.style.display === "none") return 0;
      return 26 + head.offsetHeight + 12 + Math.min(historyMenu.scrollHeight, 380) + bar.offsetHeight + 8;
    },
    focus() {
      input.focus();
      fit();
      // A drafted question keeps its text: the cursor goes after it.
      if (drafted) input.setSelectionRange(input.value.length, input.value.length);
      else input.select();
      drafted = false;
    },
  };
}
