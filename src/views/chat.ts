// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatSummary } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, MAX_OPEN_CHATS, State, engineLabel, newChatSession, type ChatAssistant, type ChatEngine, type ChatMessage, type ChatSessionState, type QuickAction, type Skill } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import type { ViewHost } from "./views";
import { remoteData, toggleRemoteLink } from "./remote";
import { isPopped } from "../island/popout";
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

/** Called once with the next reply's text («Parla» reads it aloud), or with null if it fails. */
let replyHook: ((text: string | null) => void) | null = null;
export function onNextReply(fn: ((text: string | null) => void) | null) {
  replyHook = fn;
}
function takeReplyHook() {
  const fn = replyHook;
  replyHook = null;
  return fn;
}

/** Set by the chat view: brings back a past conversation (the field at the top). */
let externalReopen: ((id: string) => void) | null = null;
export function reopenChat(id: string) {
  externalReopen?.(id);
}

/** Set by the chat view: a new conversation, the one on screen stays open in the sidebar. */
let externalFresh: (() => void) | null = null;
/**
 * The chat starts over for something new (a dropped file, a window, a quick
 * action): an empty conversation is reused, one with messages stays open and
 * a new one takes the screen.
 */
export function freshChat() {
  if (externalFresh) return externalFresh();
  State.chatHistory = [];
  void Bridge.chatReset(State.chatSid);
}

/** The engine a conversation uses: the one picked for it, else the default. */
function engineOf(c: ChatSessionState): ChatEngine {
  return c.engineOverride ?? State.settings.chatEngine;
}

/** Where the sidebar is (open or closed), on this PC. */
const SIDE_KEY = "easyisland.chatSidebar";
const SIDE_W_KEY = "easyisland.chatSideWidth";
/** The sidebar's width, dragged by its edge (between these). */
const SIDE_MIN_W = 180;
const SIDE_MAX_W = 480;
export const SIDE_DEFAULT_W = 236;
let sideWidth = loadSideWidth();

/** How wide the chat's sidebar is: the island grows by this (island.ts chatSideRoom). */
export function chatSideWidth(): number {
  return sideWidth;
}

function loadSideWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDE_W_KEY));
    return v >= SIDE_MIN_W && v <= SIDE_MAX_W ? v : SIDE_DEFAULT_W;
  } catch {
    return SIDE_DEFAULT_W;
  }
}
function loadSide(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveSide(open: boolean) {
  try {
    localStorage.setItem(SIDE_KEY, open ? "1" : "0");
  } catch {
    /* storage off: the sidebar opens again next time */
  }
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

// Links and file paths of a reply open in the preview (src/preview/), or in
// the browser with Ctrl+clic or with Impostazioni → Chat → Anteprima off.
const MD_HOOKS = {
  openUrl: (url: string, e?: MouseEvent) => {
    if (State.settings.chatPreview === false || e?.ctrlKey) void Bridge.openUrl(url);
    else void Bridge.previewOpen(url).catch(() => void Bridge.openUrl(url));
  },
  openPath: (path: string) => void Bridge.previewOpen(path).catch(() => undefined),
};

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

/** An attachment in the field: its icon and name (the path on hover), ✕ takes it away. */
function attachChip(icon: string, label: string, title: string, removeTitle: string, remove: () => void): HTMLElement {
  return h("span", { class: "attach-chip", title },
    h("span", { class: "attach-icon", text: icon }),
    h("span", { class: "attach-name", text: label }),
    h("button", { class: "attach-del", title: removeTitle, text: "✕", onclick: remove }));
}

/** "Google Chrome — Titolo della pagina", shortened: the chip has one line. */
export function windowLabel(w: { appName: string; title: string }): string {
  const title = w.title.length > 60 ? `${w.title.slice(0, 59)}…` : w.title;
  if (!w.appName) return title || t("Finestra");
  return title && title !== w.appName ? `${w.appName} — ${title}` : w.appName;
}

/** The user's skills (skills.rs), for the «/commands»; read again at most every 5 s. */
let skillCache: Skill[] = [];
let skillsRead = 0;

/** A command typed after "/" in the field (the menu over it lists them). */
interface Slash {
  name: string;
  hint: string;
  /** Takes the words after it («/ricorda il cliente Rossi paga a 60 giorni»). */
  arg?: boolean;
  run(arg: string): void;
}

/** "{{cliente}}" in a saved prompt: a field to fill, Tab goes to the next one. */
const PLACEHOLDER = /\{\{[^{}\n]{1,40}\}\}/;

/** Selects the next {{…}} after the cursor (or the first). False when there is none. */
function selectPlaceholder(input: HTMLTextAreaElement, from = input.selectionEnd): boolean {
  const re = new RegExp(PLACEHOLDER.source, "g");
  const all = [...input.value.matchAll(re)];
  if (!all.length) return false;
  const next = all.find((m) => (m.index ?? 0) >= from) ?? all[0];
  const start = next.index ?? 0;
  input.focus();
  input.setSelectionRange(start, start + next[0].length);
  return true;
}

/** "Backup giornaliero" → "backup-giornaliero": a quick action as a command. */
function slug(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildPrompt(
  onHeightChange: () => void,
  actions: {
    runAction(a: QuickAction): void;
    decide(d: "allow" | "deny" | "always"): void;
    popOut(key: string): void;
    dockBack(key: string): void;
  },
): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  // The engine and model, above the chat: a click picks another one.
  const engineBtn = h("button", { class: "engine-pick", title: t("Cambia motore della chat") }) as HTMLButtonElement;
  const engineMenu = h("div", { class: "engine-menu" });
  engineMenu.style.display = "none";
  // The sidebar's button (as in the desktop chat apps): the conversations on the left, shown or hidden.
  const sideBtn = h("button", { class: "history-btn side-btn", title: t("Mostra o nascondi le conversazioni (Ctrl+B)") }, svg(ICONS.sidebar, 14, { stroke: 1.8 })) as HTMLButtonElement;
  // The conversation's title, as the history knows it (its first question until then).
  const titleEl = h("span", { class: "chat-title" });
  // «Esporta»: the conversation as a Markdown file in the Vassoio.
  const exportBtn = h("button", { class: "history-btn", title: t("Esporta la conversazione in Markdown (nel Vassoio)"), text: "⤓" }) as HTMLButtonElement;
  // "Automatica" (Modalità terminale): this conversation goes on without
  // Consenti / Nega — Claude Code's auto mode, everything for opencode.
  const autoBtn = h("button", { class: "auto-btn" }, svg(ICONS.bolt, 12), h("span", { text: t("Automatica") })) as HTMLButtonElement;
  // Accesso remoto (remote.ts): with a connection open, 🔌 links this chat to that PC.
  const remoteBtn = h("button", { class: "auto-btn remote-btn" }, h("span", { text: "🔌" }), h("span", { class: "remote-name" })) as HTMLButtonElement;
  // «Anteprima» (src/preview/): files and pages of the chat's work, in their window.
  const previewBtn = h("button", { class: "history-btn", title: t("Anteprima: file e pagine web accanto alla chat") }, svg(ICONS.preview, 13, { stroke: 1.8 })) as HTMLButtonElement;
  // Opens the Anteprima, and closes it when it is open in the island.
  previewBtn.addEventListener("click", () => void (State.previewOpen ? Bridge.previewHide() : Bridge.previewShow()));
  // «Continua in Claude Desktop» (desktop.rs): the Claude Code session goes on in the app.
  const desktopBtn = h("button", { class: "history-btn desktop-btn", text: "↗" }) as HTMLButtonElement;
  // «Apri in una finestra» / «Rimetti nell'isola» (popout.ts): the chat as a window of its own and back.
  const popBtn = h("button", { class: "history-btn pop-btn" }) as HTMLButtonElement;
  let popShown: boolean | null = null;
  popBtn.addEventListener("click", () => (isPopped("chat") ? actions.dockBack("chat") : actions.popOut("chat")));
  const head = h("div", { class: "chat-head" }, sideBtn, titleEl, chipRow, engineBtn, remoteBtn, autoBtn, previewBtn, desktopBtn, exportBtn, popBtn, engineMenu);
  const log = h("div", { class: "chat-log" });
  // A permission this chat asks for (hooks.ts handleChatPermission): right in the
  // conversation, under its last step, instead of a card taking the island away
  // from the chat (asked by Edoardo on 27 Oct 2026).
  const askWhat = h("code", { class: "chat-ask-what" });
  const askRisk = h("div", { class: "risk-hint" });
  const askAlways = h("div", { class: "chat-ask-always" });
  const askRow = h("div", { class: "chat-ask-row" });
  const askEl = h("div", { class: "chat-ask" },
    h("div", { class: "chat-ask-title", text: t("La chat chiede il permesso") }), askWhat, askRisk, askAlways, askRow);
  let askKey = "";
  function fillAsk(req: NonNullable<typeof State.pendingApproval>) {
    askWhat.textContent = req.command || req.tool || "…";
    const risks = req.risks ?? [];
    askRisk.textContent = risks.map((r) => `⚠ ${r}`).join("\n");
    askRisk.style.display = risks.length ? "" : "none";
    askAlways.textContent = req.always ? t("Sempre: {rule}", { rule: req.always }) : "";
    askAlways.style.display = req.always ? "" : "none";
    const b = (label: string, kind: string, d: "allow" | "deny" | "always") =>
      h("button", { class: `btn ${kind}`, onclick: () => actions.decide(d) }, h("span", { text: label }));
    askRow.replaceChildren(b(t("Nega"), "secondary", "deny"));
    if (req.always) {
      const always = b(t("Sempre"), "secondary", "always");
      always.title = t("Consenti e non chiedere più per quanto scritto sopra");
      askRow.append(always);
    }
    askRow.append(b(t("Consenti"), "primary", "allow"));
  }
  // Scrolled up to read: new text does not pull the view down; ↓ goes back.
  let stick = true;
  const jumpBtn = h("button", { class: "chat-jump", title: t("Vai in fondo"), text: "↓" }) as HTMLButtonElement;
  jumpBtn.style.display = "none";
  // A reply arriving (OpenAI-compatible engines stream it, openai.rs).
  let streamEl: HTMLElement | null = null;
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
  // 🎤: dictation — the service of Telegram's «Vocali» if one is chosen, else Windows' own (Win+H).
  const mic = h("button", { class: "mic-btn", title: t("Detta (clic per iniziare e per finire)"), text: "🎤" }) as HTMLButtonElement;
  // What goes with the next question (📎, Ctrl+V, a drop, @): in the field, over the text.
  const attachRow = h("div", { class: "chat-attach" });
  const field = h("div", { class: "chat-field" }, attachRow, input);
  // 📎: files or folders, from Windows' dialog.
  const clip = h("button", { class: "mic-btn", title: t("Allega file o cartelle"), text: "📎" }) as HTMLButtonElement;
  const bar = h("div", { class: "chat-bar" }, fresh, field, clip, mic, send);
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

  // The sidebar: «Nuova chat», the search, and the conversations (the open
  // ones and the history), grouped by day. A click switches; the others go on.
  const sideNew = h("button", { class: "side-new", title: t("Nuova chat (Ctrl+N)") }, svg(ICONS.plus, 12), h("span", { text: t("Nuova chat") }));
  const historySearch = h("input", { class: "history-search", type: "text", placeholder: t("Cerca nelle conversazioni…"), spellcheck: "false" }) as HTMLInputElement;
  const historyRows = h("div", { class: "history-rows" });
  // Its right edge, dragged: wider or narrower, remembered on this PC.
  const sideGrip = h("div", { class: "chat-side-grip", title: t("Trascina per allargare o stringere le conversazioni") });
  const side = h("div", { class: "chat-side" }, sideNew, historySearch, historyRows, sideGrip);
  // Another open conversation asks a permission: a line over the field takes there.
  const otherAsk = h("button", { class: "chat-other-ask" }) as HTMLButtonElement;
  otherAsk.style.display = "none";
  otherAsk.addEventListener("click", () => {
    const sid = State.pendingApproval?.chatSid;
    if (sid) switchTo(sid);
  });
  const layout = h("div", { class: "chat-layout" }, side, h("div", { class: "chat-body" }, head, log, jumpBtn, calcRow, hintRow, otherAsk, slashMenu, bar));
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, layout),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");
  layout.style.setProperty("--side-w", `${sideWidth}px`);
  let gripFrom: { x: number; w: number } | null = null;
  let gripFrame = 0;
  sideGrip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gripFrom = { x: e.clientX, w: sideWidth };
    sideGrip.setPointerCapture(e.pointerId);
    sideGrip.classList.add("dragging");
  });
  sideGrip.addEventListener("pointermove", (e) => {
    if (!gripFrom) return;
    const w = Math.round(Math.min(SIDE_MAX_W, Math.max(SIDE_MIN_W, gripFrom.w + e.clientX - gripFrom.x)));
    if (w === sideWidth) return;
    sideWidth = w;
    layout.style.setProperty("--side-w", `${w}px`);
    // The island grows with it, once a frame.
    if (!gripFrame) {
      gripFrame = requestAnimationFrame(() => {
        gripFrame = 0;
        State.notify();
        onHeightChange();
      });
    }
  });
  const gripEnd = (e: PointerEvent) => {
    if (!gripFrom) return;
    gripFrom = null;
    if (sideGrip.hasPointerCapture(e.pointerId)) sideGrip.releasePointerCapture(e.pointerId);
    sideGrip.classList.remove("dragging");
    try {
      localStorage.setItem(SIDE_W_KEY, String(sideWidth));
    } catch {
      /* storage off: back to the usual width next time */
    }
  };
  sideGrip.addEventListener("pointerup", gripEnd);
  sideGrip.addEventListener("pointercancel", gripEnd);
  // Double click: the usual width again.
  sideGrip.addEventListener("dblclick", () => {
    sideWidth = SIDE_DEFAULT_W;
    layout.style.setProperty("--side-w", `${sideWidth}px`);
    try {
      localStorage.removeItem(SIDE_W_KEY);
    } catch {
      /* storage off */
    }
    State.notify();
    onHeightChange();
  });

  // Open or closed as left; in a narrow island it floats over the conversation, closed until asked.
  let sideOpen = loadSide();
  let narrow = false;
  let overlay = false;

  let renderedCount = -1;
  let drafted = input.value !== "";
  // «Modifica» on a question: its place in the conversation, until it is sent again.
  let editing: number | null = null;
  // «@appunti»: copied text added to the next question (any turn, any engine).
  let textAttach: { label: string; text: string } | null = null;
  // A second level of the menu ("@finestra" → the windows), until the field changes.
  let subMenu: Slash[] | null = null;

  /** A line over the field for a few seconds (or until replaced; `keep`: until cleared). */
  function flash(text: string, keep = false) {
    window.clearTimeout(hintTimer);
    hintRow.textContent = text;
    hintRow.style.display = text ? "" : "none";
    if (text && !keep) hintTimer = window.setTimeout(() => { hintRow.style.display = "none"; onHeightChange(); }, 4500);
    onHeightChange();
  }

  let pulledAt = 0;
  let pulling = false;
  /**
   * What was said in Claude Desktop since the handoff joins the conversation,
   * under a line that says so; `done` when the island goes on with the session.
   */
  async function pullDesktop(c: ChatSessionState, done: boolean) {
    if (!c.desktop || pulling) return;
    pulling = true;
    pulledAt = Date.now();
    try {
      const turns = (await Bridge.chatDesktopPull(c.sid, done)) ?? [];
      if (turns.length) {
        c.history.push({ id: nextId++, role: "assistant", content: t("↗ Conversazione proseguita in Claude Desktop") });
        for (const l of turns) c.history.push({ id: nextId++, role: l.role, content: l.content });
      }
    } catch { /* the island goes on without what Desktop said */ }
    pulling = false;
    if (done) c.desktop = false;
    State.notify();
  }

  async function toDesktop() {
    const c = State.chat;
    if (c.sending) return;
    desktopBtn.disabled = true;
    // Again: what was said there so far stays, the handoff starts from the end.
    await pullDesktop(c, false);
    try {
      await Bridge.chatToDesktop(c.sid);
      c.desktop = true;
      flash(t("Aperta in Claude Desktop. Quando torni qui ritrovi anche ciò che hai scritto lì: meglio non usarle tutte e due insieme."));
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
    desktopBtn.disabled = false;
    State.notify();
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
    // The conversation on screen now: the answer goes to it even if another one is shown by then.
    const c = State.chat;
    if (!query || c.sending) return;
    if (override == null && runSlash(query)) return;
    if (override == null) setInput("");
    // Back from Claude Desktop: what was said there first, then the island takes the session again.
    if (c.desktop) await pullDesktop(c, true);
    c.sending = true;
    c.stopping = false;
    c.at = Date.now();
    stick = true;
    if (overlay) showSide(false);
    // «Modifica»: the conversation goes back to just before that question.
    if (editing != null) {
      const keep = c.history.slice(0, editing);
      editing = null;
      flash("");
      c.history = keep;
      renderedCount = -1;
      await Bridge.chatRewind(c.sid, lines(keep));
    }
    Sound.play("send");

    const file = State.droppedFile;
    const text = c.text;
    const win = c.window;
    const attach = c.attach;
    c.attach = [];
    const first = c.history.length === 0;
    c.history.push({ id: nextId++, role: "user", content: query, file: attach.length ? attach.map((a) => a.folder ? `${a.name}/` : a.name).join(", ") : undefined });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();
    renderSide();

    const base: ChatContext | null = !first
      ? null
      : text
        ? { kind: "text", label: text.label, text: text.text }
        : win
          ? { kind: "window", appName: win.appName, title: win.title, image: win.path }
          : file
            ? { kind: "file", name: file.name, path: file.path }
            : null;
    // The attachments go as the context (each engine reads every file, and a
    // folder's outline); with a text or a window already there, their paths
    // go in the question for the engines that read files.
    let context: ChatContext | null = base;
    let asked = query;
    const files = attach.map((a) => ({ name: a.name, path: a.path, folder: !!a.folder }));
    if (files.length && (!base || base.kind === "file")) {
      context = { kind: "files", files: base?.kind === "file" ? [{ name: base.name, path: base.path, folder: false }, ...files] : files };
    } else if (files.length) {
      const list = files.map((f) => f.folder
        ? t("Cartella allegata: {path}", { path: f.path })
        : t("File allegato: {name}\nPercorso: {path}", { name: f.name, path: f.path }));
      asked = `${list.join("\n")}\n\n${query}`;
    }
    if (textAttach) {
      asked = `${textAttach.label}:\n${textAttach.text}\n\n${asked}`;
      textAttach = null;
    }

    c.streamed = "";
    const engine = engineOf(c);
    try {
      // "Chiedi a questa sessione": a read-only copy of the session answers;
      // the next questions go on in that copy.
      const session = c.session;
      const reply = session
        ? await Bridge.sessionAsk(session.sessionId, session.fork, session.cwd, query).then((r) => {
          if (c.session === session) session.fork = r.fork;
          return { text: r.text, log: null };
        })
        : await Bridge.chatSend(c.sid, asked, context, engine, c.auto && State.settings.chatTerminal === true);
      if (reply.log) c.logId = reply.log;
      c.history.push({ id: nextId++, role: "assistant", content: reply.text, engine: session ? undefined : engine });
      Sound.play("finish");
      takeReplyHook()?.(reply.text);
    } catch (err) {
      takeReplyHook()?.(null);
      if (c.stopping) {
        const soFar = c.streamed.trim();
        c.history.push({ id: nextId++, role: "assistant", content: `${soFar ? soFar + "\n\n" : ""}⏹ ${t("Fermato.")}` });
        Sound.play("blip");
        return;
      }
      const message = String(err).replace(/^Error:\s*/, "");
      // The one on screen says it as before; one in the background keeps it in its conversation.
      if (c === State.chat) {
        State.noteMessage = message;
        State.view = "note";
      } else {
        c.history.push({ id: nextId++, role: "assistant", content: `⚠ ${message}` });
      }
      Sound.play("error");
    } finally {
      c.sending = false;
      c.stopping = false;
      c.streamed = "";
      c.at = Date.now();
      if (c !== State.chat) c.unread = true;
      if (!State.chats.some((x) => x.sending)) State.stateOverride = null;
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      if (c === State.chat) input.focus();
      void refreshHistory();
    }
  }

  /** «Rigenera»: the last question asked again, its answer forgotten. */
  async function regenerate() {
    const c = State.chat;
    if (c.sending) return;
    const list = c.history;
    const u = list.map((m) => m.role === "user").lastIndexOf(true);
    if (u < 0) return;
    const question = list[u].content;
    const keep = list.slice(0, u);
    c.history = keep;
    renderedCount = -1;
    await Bridge.chatRewind(c.sid, lines(keep));
    await submit(question);
  }

  /** «⑂ Dirama da qui» (as LibreChat and TypingMind fork a chat): a new conversation up to this answer. */
  async function fork(index: number) {
    const c = State.chat;
    if (c.sending) return;
    const keep = c.history.slice(0, index + 1);
    c.history = keep;
    c.logId = null;
    renderedCount = -1;
    await Bridge.chatFork(c.sid, lines(keep));
    flash(`⑂ ${t("Nuova conversazione da qui: quella di prima resta nella cronologia")}`);
    Sound.play("blip");
    State.notify();
    input.focus();
  }

  /** "/" → an assistant: a new conversation with its engine and instructions. */
  async function useAssistant(a: ChatAssistant) {
    startOver();
    const c = State.chat;
    await Bridge.chatReset(c.sid);
    c.assistant = a;
    if (a.engine && CHAT_ENGINES.some((e) => e.id === a.engine)) {
      c.engineOverride = a.engine === State.settings.chatEngine ? null : (a.engine as ChatEngine);
    }
    await Bridge.chatPersona(c.sid, a.instructions);
    chipRow.dataset.label = "";
    flash(`${a.icon || "🤖"} ${t("Assistente {n}: scrivi la domanda", { n: a.name })}`);
    State.notify();
    input.focus();
  }

  function dropAssistant() {
    State.chat.assistant = null;
    void Bridge.chatPersona(State.chatSid, null);
    chipRow.dataset.label = "";
    State.notify();
  }

  // ── 🎤 dictation ──
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  async function dictate() {
    if (recorder) {
      recorder.stop();
      return;
    }
    const service = (State.settings.integrationConfig as { telegramVoice?: string }).telegramVoice;
    if (!service) {
      // No service: Windows' dictation writes in the field itself.
      input.focus();
      try {
        await Bridge.chatDictateWindows();
      } catch (err) {
        flash(String(err).replace(/^Error:\s*/, ""));
      }
      return;
    }
    try {
      // Said before the microphone turns on, so "davanti al cliente" does not hide the island.
      await Bridge.chatDictation(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      const rec = new MediaRecorder(stream);
      recorder = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        // Windows marks the microphone free a moment after the tracks stop.
        window.setTimeout(() => void Bridge.chatDictation(false), 3000);
        recorder = null;
        mic.classList.remove("on");
        mic.textContent = "🎤";
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) return;
        flash(t("Trascrivo…"), true);
        try {
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          const words = (await Bridge.chatTranscribe(bytes, (rec.mimeType || "audio/webm").split(";")[0])).trim();
          flash("");
          if (words) {
            const before = input.value.trimEnd();
            setInput(`${before}${before ? " " : ""}${words}`);
            input.focus();
          } else flash(t("Non ho sentito parole."));
        } catch (err) {
          flash(String(err).replace(/^Error:\s*/, ""));
        }
      };
      rec.start();
      mic.classList.add("on");
      mic.textContent = "■";
      flash(`🎤 ${t("Parla… clic su ■ per finire")}`, true);
    } catch (err) {
      recorder = null;
      void Bridge.chatDictation(false);
      flash(t("Microfono non disponibile: {e}", { e: String(err).replace(/^\w*Error:\s*/, "") }));
    }
  }

  /** «@» in the field (Raycast's @ menu): what to add to the question. */
  function mentions(word: string): Slash[] {
    const top: Slash[] = [
      { name: "appunti", hint: t("Il testo o l'immagine copiati"), run: () => void mentionClipboard() },
      { name: "finestra", hint: t("La foto di una finestra aperta"), run: () => void mentionWindows() },
      { name: "vassoio", hint: t("Un file del Vassoio"), run: () => void mentionTray() },
      { name: "file", hint: t("Uno o più file dal PC"), run: () => void pick(false) },
      { name: "cartella", hint: t("Un'intera cartella"), run: () => void pick(true) },
    ];
    return top.filter((c) => c.name.startsWith(word.toLowerCase()));
  }

  /** The "@word" being typed at the end of the field is replaced by nothing. */
  function dropMention() {
    setInput(input.value.replace(/(^|\s)@\S*$/, "$1"));
  }

  async function mentionClipboard() {
    dropMention();
    const pic = await Bridge.clipboardPicture().catch(() => null);
    if (pic) {
      State.addAttachments([{ name: pic.name, path: pic.path }]);
      Sound.play("approve");
      State.notify();
      return;
    }
    const text = (await Bridge.clipboardText().catch(() => null))?.trim();
    if (!text) {
      flash(t("Negli appunti non c'è niente da allegare."));
      return;
    }
    textAttach = { label: t("Testo copiato"), text };
    chipRow.dataset.label = "";
    Sound.play("approve");
    State.notify();
  }

  async function mentionWindows() {
    const list = (await Bridge.recordWindows()).slice(0, 8);
    if (!list.length) {
      dropMention();
      flash(t("Nessuna finestra da fotografare."));
      return;
    }
    subMenu = list.map((w) => ({
      name: (w.appName || t("Finestra")).toLowerCase(),
      hint: w.title,
      run: () => {
        dropMention();
        void Bridge.windowShot(w.id)
          .then((f) => {
            State.addAttachments([{ name: f.name, path: f.path }]);
            Sound.play("approve");
            State.notify();
          })
          .catch((err) => flash(String(err).replace(/^Error:\s*/, "")));
      },
    }));
    renderMenu();
  }

  async function mentionTray() {
    const files = ((await Bridge.inboxList()) ?? []).sort((a, b) => b.at - a.at).slice(0, 8);
    if (!files.length) {
      dropMention();
      flash(t("Il Vassoio è vuoto."));
      return;
    }
    subMenu = files.map((f) => ({
      name: f.name,
      hint: "",
      run: () => {
        dropMention();
        State.addAttachments([{ name: f.name, path: f.path }]);
        Sound.play("approve");
        State.notify();
      },
    }));
    renderMenu();
  }

  /** «Modifica»: the question back in the field; sending it starts over from there. */
  function edit(index: number) {
    if (State.chat.sending) return;
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
    const own = !State.chatSession && !State.chat.sending;
    if (own && m.role === "user") {
      bar.append(h("button", { class: "msg-act", text: t("Modifica"), onclick: () => edit(index) }));
    }
    if (own && last && m.role === "assistant" && !m.reviewer) {
      bar.append(h("button", { class: "msg-act", text: `↻ ${t("Rigenera")}`, onclick: () => void regenerate() }));
    }
    if (own && m.role === "assistant" && !last) {
      bar.append(h("button", { class: "msg-act", title: t("Una conversazione nuova che parte da qui; questa resta nella cronologia"), text: `⑂ ${t("Dirama da qui")}`, onclick: () => void fork(index) }));
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
    const c = State.chat;
    if (!target || c.sending) return;
    const name = CHAT_ENGINES.find((e) => e.id === engine)?.name ?? engine;
    c.sending = true;
    c.stopping = false;
    stick = true;
    Sound.play("send");
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();
    c.streamed = "";
    try {
      const text = await Bridge.chatSecond(c.sid, engine, target.engine, target.question, target.answer);
      c.history.push({ id: nextId++, role: "assistant", content: text, reviewer: name });
      Sound.play("finish");
    } catch (err) {
      if (c.stopping) {
        const soFar = c.streamed.trim();
        c.history.push({ id: nextId++, role: "assistant", content: `${soFar ? soFar + "\n\n" : ""}⏹ ${t("Fermato.")}`, reviewer: name });
        Sound.play("blip");
        return;
      }
      const message = String(err).replace(/^Error:\s*/, "");
      if (c === State.chat) {
        State.noteMessage = message;
        State.view = "note";
      } else {
        c.history.push({ id: nextId++, role: "assistant", content: `⚠ ${message}`, reviewer: name });
      }
      Sound.play("error");
    } finally {
      c.sending = false;
      c.stopping = false;
      c.streamed = "";
      if (c !== State.chat) c.unread = true;
      if (!State.chats.some((x) => x.sending)) State.stateOverride = null;
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      if (c === State.chat) input.focus();
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

  /**
   * «Nuova chat»: a conversation with messages stays open in the sidebar (its
   * engine goes on) and a new one takes the screen; an empty one starts over.
   */
  function startOver() {
    if (overlay) showSide(false);
    if (State.chat.history.length || State.chat.sending) {
      openNew();
    } else {
      const c = State.chat;
      c.text = null;
      c.window = null;
      c.attach = [];
      c.session = null;
      // An engine picked in the menu was for that conversation only; so was "Automatica".
      c.engineOverride = null;
      c.auto = false;
      c.desktop = false;
      c.assistant = null;
      c.logId = null;
      void Bridge.chatReset(c.sid);
    }
    State.droppedFile = null;
    State.promptContext = null;
    editing = null;
    textAttach = null;
    flash("");
    Sound.play("blip");
    State.notify();
    onHeightChange();
    setInput("");
    input.focus();
  }

  /** What stays of the conversation leaving the screen: the field's text. An empty one goes. */
  function leave() {
    const c = State.chat;
    c.draft = input.value;
    if (!c.history.length && !c.sending && !c.text && !c.window && !c.attach.length && !c.session && !c.assistant && State.chats.length > 1) {
      State.chats = State.chats.filter((x) => x !== c);
      void Bridge.chatClose(c.sid);
    }
  }

  /** The conversation `c` on screen: its messages, its field, its buttons. */
  function show(c: ChatSessionState) {
    State.chatSid = c.sid;
    c.unread = false;
    c.at = Date.now();
    editing = null;
    textAttach = null;
    subMenu = null;
    setInput(c.draft);
    flash("");
    renderedCount = -1;
    stick = true;
    chipRow.dataset.label = "";
    attachRow.dataset.key = "";
    State.notify();
    onHeightChange();
    renderSide();
  }

  function switchTo(sid: string) {
    if (overlay) showSide(false);
    if (sid === State.chatSid) return;
    const c = State.chats.find((x) => x.sid === sid);
    if (!c) return;
    leave();
    show(c);
    Sound.play("blip");
    input.focus();
  }

  /** A new empty conversation on screen; past MAX_OPEN_CHATS the least used idle one closes. */
  function openNew(): ChatSessionState {
    leave();
    const c = newChatSession();
    State.chats.push(c);
    show(c);
    const idle = State.chats
      .filter((x) => x !== c && !x.sending && State.pendingApproval?.chatSid !== x.sid)
      .sort((a, b) => a.at - b.at);
    while (State.chats.length > MAX_OPEN_CHATS && idle.length) {
      const old = idle.shift()!;
      State.chats = State.chats.filter((x) => x !== old);
      void Bridge.chatClose(old.sid);
    }
    return c;
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

  /** A skill's «/command»: its instructions, then the words after it, to the engine. */
  async function useSkill(sk: Skill, arg: string) {
    try {
      await submit(await Bridge.skillPrompt(sk.id, arg));
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  /** «/compito …»: a task (tasks.rs) that starts now; it shows up in Agenti. */
  async function newTask(goal: string) {
    if (!goal.trim()) {
      flash(t("Scrivi l'obiettivo dopo /compito"));
      return;
    }
    try {
      const task = await Bridge.taskNew("", goal, "", "");
      flash(`✓ ${t("Compito «{title}» in coda: lo segui in Agenti", { title: task.title })}`);
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

  /** Ctrl+V with files and folders copied in Explorer, or a picture: they all join the question. */
  async function pasteFile() {
    try {
      const list = await Bridge.chatPaste();
      if (!list.length) return;
      State.addAttachments(list);
      Sound.play("approve");
      State.notify();
      onHeightChange();
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  /** 📎 or @file / @cartella: Windows' dialog, several at once. */
  async function pick(folders: boolean) {
    dropMention();
    try {
      const list = await Bridge.chatPick(folders);
      if (!list.length) return;
      State.addAttachments(list);
      Sound.play("approve");
      State.notify();
      onHeightChange();
      input.focus();
    } catch (err) {
      flash(String(err).replace(/^Error:\s*/, ""));
    }
  }

  function commands(): Slash[] {
    // Read again in the background (at most every 5 s): a skill saved meanwhile shows up the next time.
    if (Date.now() - skillsRead > 5000) {
      skillsRead = Date.now();
      void Bridge.skillsList().then((l) => {
        if (l) skillCache = l;
      });
    }
    const list: Slash[] = [
      { name: "nuova", hint: t("Nuova chat"), run: () => startOver() },
      { name: "cronologia", hint: t("Le conversazioni di prima"), run: () => void toggleHistory() },
      { name: "cerca", hint: t("Cerca nelle conversazioni di prima"), arg: true, run: (a) => void toggleHistory(a) },
      { name: "ricorda", hint: t("Salva una nota nella memoria della chat"), arg: true, run: (a) => void remember(a) },
      { name: "compito", hint: t("Un obiettivo che EasyIsland porta avanti da solo"), arg: true, run: (a) => void newTask(a) },
      { name: "memoria", hint: t("Apri la memoria della chat (MEMORIA.md)"), run: () => void Bridge.memoryOpen(false).catch((e) => flash(String(e))) },
      { name: "esporta", hint: t("La conversazione in Markdown, nel Vassoio"), run: () => void exportChat() },
      { name: "motore", hint: t("Cambia motore per questa chat"), run: () => void toggleEngineMenu() },
      { name: "oggi", hint: t("Il punto della mia giornata di oggi"), run: () => void day(false) },
      { name: "domani", hint: t("Il punto della mia giornata di domani"), run: () => void day(true) },
    ];
    const taken = new Set(list.map((c) => c.name));
    // The user's skills (skills.rs): «/resoconto-cliente Rossi» sends its instructions with the words.
    for (const sk of skillCache) {
      if (taken.has(sk.id)) continue;
      taken.add(sk.id);
      list.push({ name: sk.id, arg: true, hint: `📘 ${t("Abilità: {n}", { n: sk.name })}`, run: (a) => void useSkill(sk, a) });
    }
    for (const a of State.settings.chatAssistants ?? []) {
      const name = slug(a.name);
      if (!name || taken.has(name)) continue;
      taken.add(name);
      list.push({ name, hint: `${a.icon || "🤖"} ${t("Assistente: {n}", { n: a.name })}`, run: () => void useAssistant(a) });
    }
    for (const a of State.settings.actions ?? []) {
      const name = slug(a.name);
      if (!name || taken.has(name)) continue;
      taken.add(name);
      // A saved prompt with {{fields}} (a prompt library with variables): in
      // the field to fill, Tab from one field to the next.
      if (a.kind === "prompt" && PLACEHOLDER.test(a.prompt)) {
        list.push({ name, hint: `${a.icon} ${t("Modello da completare: {n}", { n: a.name })}`, run: () => {
          setInput(a.prompt);
          selectPlaceholder(input, 0);
          flash(t("Completa i campi {{…}}: Tab passa al successivo"));
        } });
        continue;
      }
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

  /** The menu over the field while a command ("/") or an "@" is being typed. */
  function updateSlash() {
    subMenu = null;
    const m = /^\/(\S*)$/.exec(input.value);
    const at = /(?:^|\s)@(\S*)$/.exec(input.value);
    slashItems = State.chatSession ? []
      : m ? commands().filter((c) => c.name.startsWith(m[1].toLowerCase())).slice(0, 10)
        : at ? mentions(at[1])
          : [];
    menuPrefix = m ? "/" : "@";
    renderMenu();
  }

  let menuPrefix = "/";
  function renderMenu() {
    if (subMenu) {
      slashItems = subMenu;
      menuPrefix = "";
    }
    slashSel = Math.min(slashSel, Math.max(0, slashItems.length - 1));
    clear(slashMenu);
    slashItems.forEach((c, i) => {
      const row = h("button", { class: `slash-item${i === slashSel ? " on" : ""}` },
        h("b", { text: `${menuPrefix}${c.name}` }), h("span", { text: c.hint }));
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
    if (menuPrefix !== "/") {
      // "@…" and the second level run on their own; the field keeps the rest.
      subMenu = null;
      slashItems = [];
      renderMenu();
      c.run("");
      return;
    }
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
    if (id === State.chatEngine || State.chat.sending) return;
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

  /** The sidebar shown or hidden (in a narrow island: over the conversation, not remembered). */
  function showSide(open: boolean) {
    if (narrow) overlay = open;
    else {
      sideOpen = open;
      saveSide(open);
    }
    applySide();
    if (open) void refreshHistory();
  }

  function applySide(quiet = false) {
    const open = narrow ? overlay : sideOpen;
    layout.classList.toggle("side-open", open);
    layout.classList.toggle("narrow", narrow);
    sideBtn.classList.toggle("on", open);
    // Asked even while it floats: the island grows as soon as the screen leaves room.
    State.chatSideOpen = sideOpen;
    if (quiet) return;
    State.notify();
    onHeightChange();
  }

  // The island grows by the sidebar (island.ts chatSideRoom); where it cannot
  // (the screen's edge, the bar's narrow island) the conversation would keep
  // less than 340 px beside it: then it floats over the conversation instead.
  // Judged once the island has finished growing (its animation), not on the way.
  let narrowTimer = 0;
  new ResizeObserver(() => {
    window.clearTimeout(narrowTimer);
    narrowTimer = window.setTimeout(() => {
      const w = layout.clientWidth;
      if (!w) return;
      const now = sideOpen && w < sideWidth + 340;
      if (now === narrow) return;
      narrow = now;
      overlay = false;
      applySide();
    }, 500);
  }).observe(layout);
  // Not yet in the island: only the classes.
  applySide(true);

  let searchTimer = 0;
  let searchSeq = 0;
  /** The history as last read: the sidebar is drawn again from it when a conversation changes state. */
  let lastList: ChatSummary[] = [];
  let lastQuery = "";
  let historyRead = false;

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

  /** Fissate, Oggi, Ieri, Ultimi 7 giorni, Ultimi 30 giorni, then by month. */
  function groupOf(c: ChatSummary): string {
    if (c.pinned) return t("Fissate");
    const day = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((day(Date.now()) - day(c.updated)) / 86_400_000);
    if (days <= 0) return t("Oggi");
    if (days === 1) return t("Ieri");
    if (days < 7) return t("Ultimi 7 giorni");
    if (days < 30) return t("Ultimi 30 giorni");
    return new Date(c.updated).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  }

  /** A conversation's state in the sidebar: working, answered while away, asking a permission. */
  function badge(c: ChatSessionState | undefined): HTMLElement | null {
    if (!c) return null;
    if (State.pendingApproval?.source === "chat" && State.pendingApproval.chatSid === c.sid) {
      return h("span", { class: "side-badge ask", title: t("Chiede un permesso"), text: "!" });
    }
    if (c.sending) return h("span", { class: "side-badge busy", title: t("Sta rispondendo") });
    if (c.unread) return h("span", { class: "side-badge unread", title: t("Risposta nuova") });
    return null;
  }

  /** The sidebar drawn again from the last list (a conversation started, answered, switched). */
  function renderSide() {
    renderHistory(lastList, lastQuery);
  }

  function renderHistory(list: ChatSummary[], query: string) {
    lastList = list;
    lastQuery = query;
    clear(historyRows);
    // Open conversations the history does not have yet (no answer saved): on top.
    const fresh = query.trim() ? [] : State.chats.filter((c) => (!c.logId || !list.some((x) => x.id === c.logId))
      && (c.history.length || c.sending || c.sid === State.chatSid));
    if (fresh.length) historyRows.append(h("div", { class: "side-group", text: t("Aperte") }));
    for (const c of fresh) {
      const first = c.history.find((m) => m.role === "user")?.content ?? "";
      const name = CHAT_ENGINES.find((e) => e.id === engineOf(c))?.name ?? engineOf(c);
      historyRows.append(h("div", { class: `history-item${c.sid === State.chatSid ? " on" : ""}`, title: first || t("Nuova chat"), onclick: () => switchTo(c.sid) },
        h("div", { class: "history-text" },
          h("span", { class: "history-title", text: first || t("Nuova chat") }),
          h("span", { class: "history-meta", text: name })),
        ...[badge(c)].filter((b): b is HTMLElement => !!b)));
    }
    if (!list.length && !fresh.length) {
      historyRows.append(h("div", { class: "engine-note", text: query.trim()
        ? t("Nessuna conversazione con queste parole.")
        : State.settings.chatHistory === false
          ? t("La cronologia è spenta: Impostazioni → Chat.")
          : t("Ancora nessuna conversazione. Restano qui, su questo PC.") }));
    }
    let group = "";
    for (const c of list) {
      const engine = CHAT_ENGINES.find((e) => e.id === c.engine)?.name ?? c.engine;
      const g = groupOf(c);
      if (g !== group) {
        group = g;
        historyRows.append(h("div", { class: "side-group", text: g }));
      }
      const open = State.chats.find((x) => x.logId === c.id);
      const del = h("button", { class: "history-del", title: t("Elimina"), text: "✕" });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void Bridge.chatHistoryDelete(c.id);
        historyDemo = historyDemo.filter((x) => x.id !== c.id);
        // Open: it closes too (another one, or a new one, takes the screen).
        if (open && !open.sending) {
          if (open.sid === State.chatSid) {
            const next = State.chats.find((x) => x !== open);
            State.chats = State.chats.filter((x) => x !== open);
            void Bridge.chatClose(open.sid);
            if (next) show(next);
            else show((() => { const n = newChatSession(); State.chats.push(n); return n; })());
          } else {
            State.chats = State.chats.filter((x) => x !== open);
            void Bridge.chatClose(open.sid);
          }
        }
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
      const titleEl = h("span", { class: "history-title", text: c.title });
      // ✎ or a double click on the title: a field in its place. Enter or
      // leaving it saves, Esc keeps the old one, empty = the first question.
      const rename = () => {
        if (row.querySelector(".history-rename")) return;
        const field = h("input", { class: "history-rename", type: "text", value: c.title, spellcheck: "false", maxlength: "80" }) as HTMLInputElement;
        let done = false;
        const finish = (keep: boolean) => {
          if (done) return;
          done = true;
          const next = field.value.trim();
          if (keep && next !== c.title) {
            void Bridge.chatHistoryRename(c.id, next);
            const demo = historyDemo.find((x) => x.id === c.id);
            if (demo && next) demo.title = next;
            void refreshHistory();
          } else {
            field.replaceWith(titleEl);
          }
        };
        field.addEventListener("click", (e) => e.stopPropagation());
        field.addEventListener("dblclick", (e) => e.stopPropagation());
        field.addEventListener("keydown", (e) => {
          e.stopPropagation();
          const key = (e as KeyboardEvent).key;
          if (key === "Enter") finish(true);
          else if (key === "Escape") finish(false);
        });
        field.addEventListener("blur", () => finish(true));
        titleEl.replaceWith(field);
        field.focus();
        field.select();
      };
      const edit = h("button", { class: "history-edit", title: t("Rinomina") }, svg(ICONS.pencil, 11));
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        rename();
      });
      titleEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        rename();
      });
      const row = h("div", { class: `history-item${open && open.sid === State.chatSid ? " on" : ""}`, title: c.title, onclick: () => void reopen(c.id) },
        h("div", { class: "history-text" },
          titleEl,
          h("span", { class: "history-meta", text: `${when(c.updated)} · ${engine} · ${tn("{n} domanda", "{n} domande", c.turns)}` })),
        ...[badge(open)].filter((b): b is HTMLElement => !!b),
        edit, pin, del);
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
      historySearch.value = "";
      void refreshHistory();
      if (overlay) showSide(false);
      input.focus();
    }
  });
  sideNew.addEventListener("click", startOver);

  /** «/cronologia», «/cerca …»: the sidebar open, with the search when there is one. */
  async function toggleHistory(query?: string) {
    engineMenu.style.display = "none";
    historySearch.value = query ?? "";
    showSide(true);
    await refreshHistory();
    historySearch.focus();
  }

  /**
   * A conversation of the history: on screen if it is open, else opened (in
   * the one on screen when that is empty, else in a new one); the others go on.
   */
  async function reopen(id: string) {
    const open = State.chats.find((x) => x.logId === id);
    if (open) {
      switchTo(open.sid);
      return;
    }
    if (overlay) showSide(false);
    const reuse = !State.chat.history.length && !State.chat.sending;
    const c = reuse ? State.chat : openNew();
    try {
      const got = await Bridge.chatHistoryOpen(c.sid, id);
      c.history = got.lines.map((l) => ({ id: nextId++, role: l.role, content: l.content }));
      c.logId = id;
      c.text = null;
      c.window = null;
      c.attach = [];
      c.session = null;
      c.engineOverride = got.engine === State.settings.chatEngine ? null : (got.engine as ChatEngine);
      c.auto = false;
      c.desktop = false;
      c.at = Date.now();
      if (c.assistant) {
        c.assistant = null;
        void Bridge.chatPersona(c.sid, null);
      }
      if (c === State.chat) {
        State.droppedFile = null;
        State.promptContext = null;
        editing = null;
        textAttach = null;
        flash("");
        renderedCount = -1;
        stick = true;
        chipRow.dataset.label = "";
      }
      Sound.play("blip");
      State.notify();
      renderSide();
      input.focus();
    } catch (err) {
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      State.notify();
    }
  }

  engineBtn.addEventListener("click", () => void toggleEngineMenu());
  sideBtn.addEventListener("click", () => showSide(!(narrow ? overlay : sideOpen)));
  exportBtn.addEventListener("click", () => void exportChat());
  desktopBtn.addEventListener("click", () => void toDesktop());
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
  void onEvent<{ sid?: string; text: string }>("chat-stream", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c?.sending) return;
    c.streamed = p.text;
    if (c === State.chat) State.notify();
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

  mic.addEventListener("click", () => void dictate());
  // 📎: the same menu as «@», with File… and Cartella…
  clip.addEventListener("click", () => {
    subMenu = [
      { name: "file", hint: t("Uno o più file dal PC"), run: () => void pick(false) },
      { name: "cartella", hint: t("Un'intera cartella"), run: () => void pick(true) },
    ];
    slashSel = 0;
    menuPrefix = "@";
    renderMenu();
    input.focus();
  });
  externalSend = (q) => void submit(q);
  externalReopen = (id) => void reopen(id);
  externalFresh = () => {
    if (State.chat.history.length || State.chat.sending) openNew();
    else void Bridge.chatReset(State.chatSid);
  };
  fresh.addEventListener("click", startOver);
  send.addEventListener("click", () => {
    // While a reply is written the button is "Ferma" (not for "Chiedi a questa sessione").
    const c = State.chat;
    if (c.sending) {
      if (!c.session && !c.stopping) {
        c.stopping = true;
        void Bridge.chatStop(c.sid);
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
    if (k.ctrlKey && !k.altKey && k.key.toLowerCase() === "b") {
      e.preventDefault();
      showSide(!(narrow ? overlay : sideOpen));
      return;
    }
    if (k.ctrlKey && !k.altKey && k.key.toLowerCase() === "n") {
      e.preventDefault();
      startOver();
      return;
    }
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
        if (menuPrefix === "/") setInput("");
        else {
          subMenu = null;
          slashItems = [];
          renderMenu();
        }
        return;
      }
    }
    if (k.key === "Tab" && !k.shiftKey && PLACEHOLDER.test(input.value)) {
      e.preventDefault();
      selectPlaceholder(input);
      return;
    }
    if (k.key === "Escape" && editing != null) {
      cancelEdit();
      return;
    }
    // ↑ in the empty field: the last question back, to change and send again.
    if (k.key === "ArrowUp" && input.value === "" && !State.chat.sending) {
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
      const assistant = State.chat.assistant;
      const sending = State.chat.sending;
      const streamed = State.chat.streamed;
      const chipKey = `${pick ? "pick" : ""}${wantChip}${win && !pick ? win.path : ""}|${assistant?.id ?? ""}`;
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
        if (assistant && !pick) {
          // The assistant can be taken away until the first question goes.
          const removable = State.chatHistory.length === 0;
          chipRow.append(contextChip(`${assistant.icon || "🤖"} ${assistant.name}`, undefined, removable ? () => { dropAssistant(); input.focus(); } : undefined, t("Togli l'assistente")));
        }
      }
      const attachKey = `${attach.map((a) => a.path).join("|")}|${textAttach?.text.length ?? ""}`;
      if (attachRow.dataset.key !== attachKey) {
        attachRow.dataset.key = attachKey;
        clear(attachRow);
        if (textAttach) {
          attachRow.append(attachChip("📋", `${textAttach.label} · ${t("{n} caratteri", { n: textAttach.text.length.toLocaleString(locale()) })}`, textAttach.label, t("Togli il testo"), () => {
            textAttach = null;
            attachRow.dataset.key = "";
            State.notify();
            input.focus();
          }));
        }
        for (const a of attach) {
          attachRow.append(attachChip(a.folder ? "📁" : "📄", a.name, a.path, a.folder ? t("Togli la cartella") : t("Togli il file"), () => {
            State.chatAttach = State.chatAttach.filter((x) => x !== a);
            Sound.play("blip");
            State.notify();
            input.focus();
          }));
        }
        onHeightChange();
      }

      engineBtn.textContent = `${engineLabel({ ...State.settings, chatEngine: State.chatEngine })} ▾`;
      // Asking a session: Claude Code answers, whatever the chat's engine.
      engineBtn.style.display = asked ? "none" : "";
      exportBtn.style.display = State.chatHistory.length ? "" : "none";
      // ↗: only for a Claude Code conversation that has started, never on a session copy.
      desktopBtn.style.display = State.chatEngine === "subscription" && State.chatHistory.length && !asked ? "" : "none";
      desktopBtn.classList.toggle("on", State.chatDesktop);
      desktopBtn.title = State.chatDesktop
        ? t("La conversazione è proseguita in Claude Desktop: ciò che scrivi lì torna qui. Clic per riaprirla lì")
        : t("Continua in Claude Desktop, con tutta la conversazione");
      if (State.chatDesktop && !sending && Date.now() - pulledAt > 4000) void pullDesktop(State.chat, false);
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
      previewBtn.style.display = terminal && State.settings.chatPreview !== false ? "" : "none";
      const away = isPopped("chat");
      if (away !== popShown) {
        popShown = away;
        popBtn.replaceChildren(svg(away ? ICONS.popIn : ICONS.popOut, 12));
        popBtn.title = away ? t("Rimetti la chat nell'isola") : t("Apri la chat in una finestra");
      }
      previewBtn.classList.toggle("on", State.previewOpen);
      previewBtn.title = State.previewOpen ? t("Chiudi l'Anteprima") : t("Anteprima: file e pagine web accanto alla chat");
      autoBtn.classList.toggle("on", auto);
      el.querySelector(".chat-card")?.classList.toggle("auto", auto);
      autoBtn.title = State.chatEngine === "subscription"
        ? (auto ? t("Automatica: Claude Code decide da solo e blocca le azioni rischiose. Clic per tornare a Consenti / Nega")
          : t("Automatica: in questa conversazione Claude Code non chiede conferma per le azioni normali e blocca quelle rischiose"))
        : (auto ? t("Automatica: comandi e modifiche normali vanno da soli; cancellare, pubblicare, installare o cambiare il sistema chiede ancora. Clic per tornare a Consenti / Nega")
          : t("Automatica: in questa conversazione comandi e modifiche normali vanno senza chiedere; cancellare, pubblicare, installare o cambiare il sistema chiede ancora"));
      // The conversation's title: as the history has it, else its first question.
      const known = lastList.find((x) => x.id === State.chat.logId)?.title;
      titleEl.textContent = known ?? State.chatHistory.find((m) => m.role === "user")?.content ?? "";
      titleEl.title = titleEl.textContent;
      // The history, read the first time the chat shows with its sidebar open.
      if (!historyRead && layout.classList.contains("side-open") && State.view === "prompt") {
        historyRead = true;
        void refreshHistory();
      }
      // The sidebar follows the conversations' states (working, answered, asking).
      const sideKey = `${State.chatSid}|${State.pendingApproval?.chatSid ?? ""}|${State.chats.map((c) => `${c.sid}${c.sending ? "s" : ""}${c.unread ? "u" : ""}${c.logId ?? ""}${c.history.length ? "h" : ""}`).join(",")}`;
      if (sideKey !== side.dataset.key) {
        side.dataset.key = sideKey;
        renderSide();
      }
      const thinking = sending;
      const count = State.chatHistory.length + (thinking ? 0.5 : 0) + (streamed ? 0.25 : 0) + (sending ? 0.125 : 0) + State.chats.indexOf(State.chat) * 1000;
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
      // The waiting permission, always the last thing in the conversation.
      const req = State.pendingApproval?.source === "chat" && (!State.pendingApproval.chatSid || State.pendingApproval.chatSid === State.chatSid)
        ? State.pendingApproval : null;
      if (req) {
        const key = `${req.requestId}|${req.command}|${req.always ?? ""}`;
        if (askKey !== key) {
          askKey = key;
          fillAsk(req);
        }
        if (log.lastChild !== askEl) {
          log.append(askEl);
          toBottom();
        }
      } else if (askKey) {
        askKey = "";
        askEl.remove();
      }
      const elsewhere = State.pendingApproval?.source === "chat" && State.pendingApproval.chatSid && State.pendingApproval.chatSid !== State.chatSid
        ? State.chats.find((c) => c.sid === State.pendingApproval?.chatSid) : undefined;
      const otherText = elsewhere
        ? t("«{name}» chiede un permesso: apri", { name: elsewhere.history.find((m) => m.role === "user")?.content.slice(0, 50) || t("Nuova chat") })
        : "";
      if (otherAsk.textContent !== otherText) {
        otherAsk.textContent = otherText;
        otherAsk.style.display = otherText ? "" : "none";
        onHeightChange();
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
        : State.chatHistory.length === 0 ? t("Chiedimi qualsiasi cosa… / comandi · @ allegati") : t("Continua…");

      input.disabled = sending;
      const stopMode = sending && !asked;
      if (send.dataset.mode !== (stopMode ? "stop" : "send")) {
        send.dataset.mode = stopMode ? "stop" : "send";
        send.replaceChildren(svg(stopMode ? ICONS.stop : ICONS.arrowUp, stopMode ? 12 : 14));
        send.title = stopMode ? t("Ferma") : t("Invia");
        send.classList.toggle("stop", stopMode);
      }
      // Only when there is something to forget.
      // In the sidebar when it is open; here only when there is something to leave.
      fresh.style.display = !layout.classList.contains("side-open") && (State.chatHistory.length > 0 || file || text || win || asked || attach.length || assistant || textAttach) ? "" : "none";
      mic.disabled = sending;
      clip.disabled = sending || !!asked;
    },
    // The sidebar open in an empty chat: the island tall enough for a few conversations.
    fitHeight() {
      if (!layout.classList.contains("side-open") || State.chatHistory.length) return 0;
      return Math.min(26 + historyRows.scrollHeight + 90, 460);
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
