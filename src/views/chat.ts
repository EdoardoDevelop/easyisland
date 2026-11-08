// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear, clipMark } from "./dom";
import { ICONS } from "./icons";
import { ICON_PLAY_MS, clipIcon, lensIcon, planeIcon, playIcon } from "./anim-icons";
import { Bridge, onEvent, type ChatContext, type ChatSummary, type PathInfo } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, MAX_OPEN_CHATS, State, engineLabel, newChatSession, type ChatAssistant, type ChatEngine, type ChatMessage, type ChatSessionState, type QuickAction, type Skill, type TeamRow, type BgTask } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import type { ViewHost } from "./views";
import { remoteData, toggleRemoteLink } from "./remote";
import { isPopped } from "../island/popout";
import { TypeLine, foldSteps, splitStatus } from "./typeline";
import { ChatEmpty, emptyArt } from "./chat-empty";
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
/** Projects closed in the sidebar (lower-case folders): a convenience of this PC. */
const PROJECTS_KEY = "chat.projects.closed";
function readClosedProjects(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveClosedProjects(closed: Set<string>) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([...closed]));
  } catch {
    /* storage off: they open again next time */
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

function bubble(message: ChatMessage, live = false): HTMLElement {
  if (message.role === "user") {
    const b = h("div", { class: "bubble", text: message.content });
    if (message.file) b.prepend(h("div", { class: "bubble-file" }, clipMark(), message.file));
    return h("div", { class: "chat-row user" }, b);
  }
  // Claude answers in markdown: rendered as DOM, never as HTML (core/markdown.ts).
  if (message.reviewer) {
    return h("div", { class: "chat-row" },
      h("div", { class: "reply md second" },
        h("div", { class: "second-head", text: `⇄ ${t("Seconda opinione · {e}", { e: message.reviewer })}` }),
        ...renderMarkdown(message.content, MD_HOOKS)));
  }
  const reply = h("div", { class: "reply md" }, ...foldSteps(renderMarkdown(message.content, MD_HOOKS), !live));
  // While it streams this runs many times a second: the finished reply checks them.
  if (!live) void checkPaths(reply);
  return h("div", { class: "chat-row" }, reply);
}

// Links and file paths of a reply open in the preview (src/preview/), or in
// the browser with Ctrl+clic or with Impostazioni → Chat → Anteprima off.
const MD_HOOKS = {
  openUrl: (url: string, e?: MouseEvent) => {
    if (State.settings.chatPreview === false || e?.ctrlKey) void Bridge.openUrl(url);
    else void Bridge.previewOpen(url).catch(() => void Bridge.openUrl(url));
  },
  openPath: (path: string, e?: MouseEvent) => openChatPath(path, e?.currentTarget instanceof HTMLElement ? e.currentTarget : null, e?.ctrlKey),
};

// ── Files and folders in a reply (src-tauri/src/chatpaths.rs) ────────────────
// Only those that exist stay links: Rust resolves them (absolute, "~\…", or
// relative to the chat's folder, with ":line"); a missing one is greyed.

/** What Rust said about a path, and when (a missing one is asked again later). */
const pathSeen = new Map<string, { info: PathInfo; at: number }>();

async function checkPaths(root: HTMLElement) {
  // Rendered first, checked right after (the bubble is in the page by then).
  await Promise.resolve();
  const els = Array.from(root.querySelectorAll<HTMLElement>(".md-path[data-path]"));
  if (!els.length) return;
  const now = Date.now();
  // A relative path means something else in another conversation's folder.
  const base = State.chat.folder;
  const key = (p: string) => `${base ?? ""}|${p}`;
  const want = [...new Set(els.map((e) => e.dataset.path ?? ""))].filter((p) => {
    const seen = pathSeen.get(key(p));
    return p && (!seen || (seen.info.kind === "missing" && now - seen.at > 10_000));
  });
  if (want.length) {
    const infos = await Bridge.pathsInfo(want, base).catch(() => null);
    for (const i of infos ?? []) pathSeen.set(key(i.path), { info: i, at: now });
  }
  for (const e of els) {
    const info = pathSeen.get(key(e.dataset.path ?? ""))?.info;
    if (!info) continue;
    e.dataset.kind = info.kind;
    e.dataset.resolved = info.resolved;
    e.classList.toggle("md-missing", info.kind === "missing");
    e.classList.toggle("md-dir", info.kind === "dir");
    e.title = info.kind === "missing" ? t("Non c'è più: {p}", { p: info.resolved })
      : info.kind === "dir" ? t("Cartella: {p} · clic per aprirla, tasto destro per altro", { p: info.resolved })
      : t("{p} · clic per vederlo, tasto destro per altro", { p: info.resolved });
  }
}

/** Files the Anteprima beside the chat draws (preview.rs). */
const PREVIEWABLE = /\.(md|txt|ts|tsx|js|jsx|mjs|json|html?|css|csv|pdf|png|jpe?g|gif|webp|svg|toml|ya?ml|xml|log|ps1|bat|cmd|sh|cs|java|go|c|h|cpp|hpp|sql|ini|cfg|vue|svelte|php|rb|rs|py|lock|env)$/i;

export function canPreview(path: string): boolean {
  return PREVIEWABLE.test(path.replace(/(:\d+){1,2}$/, ""));
}

const pathFail = (e: unknown) => console.warn(String(e));

/** A path's action from the right-click menu (island.ts contextItems). */
export function chatPathAction(path: string, action: "open" | "reveal" | "download" | "preview") {
  if (action === "preview") {
    void Bridge.previewOpen(path.replace(/(:\d+){1,2}$/, "")).catch(() => void Bridge.pathAction(path, "open").catch(pathFail));
    return;
  }
  void Bridge.pathAction(path, action).catch(pathFail);
}

/**
 * Clic on a path: a folder opens in Explorer; a file in the Anteprima when it
 * can draw it (and the Anteprima is on), else in its program. Ctrl+clic: its program.
 */
export function openChatPath(path: string, el: HTMLElement | null, direct = false) {
  if (el?.classList.contains("md-missing")) return;
  const target = el?.dataset.resolved || path;
  if (el?.dataset.kind === "dir" || direct || State.settings.chatPreview === false || !canPreview(target)) {
    chatPathAction(path, "open");
    return;
  }
  chatPathAction(target, "preview");
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
/** Claude Code's slash commands (its `init` line), for the «/» menu with Claude Code. */
let claudeCommands: string[] = [];
let claudeRead = 0;

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
  // The engine and model, under the field: a click picks another one.
  const engineBtn = h("button", { class: "engine-pick", title: t("Cambia motore della chat") }) as HTMLButtonElement;
  const folderBtn = h("button", { class: "engine-pick folder-pick" }) as HTMLButtonElement;
  /** Each project's git branch, as last read, and what that read was for. */
  const branches = new Map<string, string>();
  let branchRead = "";
  /** The project's open pull request and its checks (gh), as Claude Desktop shows them; read at most every 60 s. */
  type PullRequest = { number: number; title: string; url: string; state: string; passed: number; pending: number; failed: string[] };
  const prs = new Map<string, { pr: PullRequest | null; at: number }>();
  const prBtn = h("button", { class: "engine-pick pr-pick" }) as HTMLButtonElement;
  prBtn.style.display = "none";
  prBtn.addEventListener("click", () => {
    const folder = State.chat.folder;
    const pr = folder ? prs.get(folder)?.pr : null;
    if (!pr) return;
    if (engineMenu.style.display !== "none") {
      engineMenu.style.display = "none";
      return;
    }
    clear(engineMenu);
    engineMenu.append(h("div", { class: "engine-head", text: `#${pr.number} ${pr.title}` }));
    engineMenu.append(h("button", { class: "engine-item", text: t("Apri la pull request"), onclick: () => { engineMenu.style.display = "none"; void Bridge.openUrl(pr.url); } }));
    if (pr.failed.length) {
      engineMenu.append(h("button", {
        class: "engine-item", text: t("Correggi i controlli che non passano"),
        onclick: () => {
          engineMenu.style.display = "none";
          const ask = t("I controlli della pull request #{n} non passano: {names}. Leggi i log con `gh pr checks {n}` e `gh run view --log-failed`, trova la causa e correggi.", { n: pr.number, names: pr.failed.join(", ") });
          if (State.chat.sending) State.chat.queue.push(ask);
          else void submit(ask, State.chat);
          State.notify();
        },
      }));
    }
    engineMenu.append(h("div", { class: "engine-note", text: t("Controlli: {ok} riusciti, {ko} non riusciti, {wait} in corso. Letti con gh ogni minuto al massimo.", { ok: pr.passed, ko: pr.failed.length, wait: pr.pending }) }));
    engineMenu.style.display = "";
  });
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
  const teamBtn = h("button", { class: "auto-btn team-btn" }, svg(ICONS.team, 12), h("span", { text: t("Multi agent") })) as HTMLButtonElement;
  // Accesso remoto (remote.ts): with a connection open, 🔌 links this chat to that PC.
  const remoteBtn = h("button", { class: "auto-btn remote-btn" }, h("span", { text: "🔌" }), h("span", { class: "remote-name" })) as HTMLButtonElement;
  // «Anteprima» (src/preview/): files and pages of the chat's work, in their window.
  const previewBtn = h("button", { class: "history-btn head-end", title: t("Anteprima: file e pagine web accanto alla chat") }, svg(ICONS.preview, 13, { stroke: 1.8 })) as HTMLButtonElement;
  // Opens the Anteprima, and closes it when it is open in the island.
  previewBtn.addEventListener("click", () => void (State.previewOpen ? Bridge.previewHide() : Bridge.previewShow()));
  // «Continua in Claude Desktop» (desktop.rs): the Claude Code session goes on in the app.
  const desktopBtn = h("button", { class: "history-btn desktop-btn", text: "↗" }) as HTMLButtonElement;
  // «Apri in una finestra» / «Rimetti nell'isola» (popout.ts): the chat as a window of its own and back.
  const popBtn = h("button", { class: "history-btn pop-btn" }) as HTMLButtonElement;
  let popShown: boolean | null = null;
  popBtn.addEventListener("click", () => (isPopped("chat") ? actions.dockBack("chat") : actions.popOut("chat")));
  // «Terminale» (terminal.rs): the user's own PowerShell in the project, as Claude Desktop has one beside the chat.
  const termBtn = h("button", { class: "history-btn", text: ">_", title: t("Terminale: un PowerShell tuo nella cartella del progetto") }) as HTMLButtonElement;
  const termOut = h("pre", { class: "chat-term-out" });
  const termIn = h("input", { class: "chat-term-in", type: "text", spellcheck: "false", placeholder: t("Comando (Invio). Per editor e password usa Terminale di Windows.") }) as HTMLInputElement;
  const termRow = h("div", { class: "chat-term" },
    h("div", { class: "chat-term-head" }, h("span", { text: t("Terminale") }),
      h("button", { class: "chat-queued-btn", text: t("Riavvia"), title: t("Chiude questo PowerShell (anche un comando bloccato) e ne apre un altro"), onclick: () => void restartTerminal() }),
      h("button", { class: "chat-queued-btn", text: "✕", title: t("Chiudi il terminale"), onclick: () => closeTerminal() })),
    termOut, termIn);
  termRow.style.display = "none";
  /** One PowerShell per conversation, with what it printed. */
  const terms = new Map<string, { id: number; lines: string[] }>();
  const head = h("div", { class: "chat-head" }, sideBtn, titleEl, chipRow, termBtn, previewBtn, desktopBtn, exportBtn, popBtn);
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
  const send = h("button", { class: "send-btn", title: t("Invia") }, planeIcon(14));
  const fresh = h("button", { class: "new-chat-btn", title: t("Nuova chat (Ctrl+N)") }, svg(ICONS.plus, 12), h("span", { text: t("Nuova chat") }));
  // 🎤: dictation — the service of Telegram's «Vocali» if one is chosen, else Windows' own (Win+H).
  const micIcon = () => svg(ICONS.mic, 15, { stroke: 1.8 });
  const mic = h("button", { class: "mic-btn", title: t("Detta (clic per iniziare e per finire)") }, micIcon()) as HTMLButtonElement;
  // What goes with the next question (📎, Ctrl+V, a drop, @): in the field, over the text.
  const attachRow = h("div", { class: "chat-attach" });
  const field = h("div", { class: "chat-field" }, attachRow, input);
  // 📎: files or folders, from Windows' dialog.
  const clip = h("button", { class: "mic-btn clip-btn", title: t("Allega file o cartelle") }, clipIcon(15)) as HTMLButtonElement;
  // Two rows: the text on the whole width, under it what goes with the message.
  const contextPct = h("span", { class: "ctx-pct" });
  const contextMeter = h("span", { class: "ctx-meter" }, h("span", { class: "ctx-ring" }), contextPct);
  const tools = h("div", { class: "chat-tools" }, fresh, folderBtn, prBtn, engineBtn, remoteBtn, teamBtn, autoBtn, contextMeter, clip, mic, send);
  const bar = h("div", { class: "chat-bar" }, field, tools, engineMenu);
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

  // The sidebar: «Nuovo» and «Cerca» side by side, the search field, and the conversations (the open
  // ones and the history), grouped by day. A click switches; the others go on.
  const sideNew = h("button", { class: "side-new", title: t("Nuova chat (Ctrl+N)") }, svg(ICONS.plus, 12), h("span", { text: t("Nuovo") }));
  const sideFind = h("button", { class: "side-new", title: t("Cerca nelle conversazioni…") }, lensIcon(12), h("span", { text: t("Cerca") }));
  const historySearch = h("input", { class: "history-search", type: "text", placeholder: t("Cerca nelle conversazioni…"), spellcheck: "false" }) as HTMLInputElement;
  historySearch.style.display = "none";
  const historyRows = h("div", { class: "history-rows" });
  // Its right edge, dragged: wider or narrower, remembered on this PC.
  const sideGrip = h("div", { class: "chat-side-grip", title: t("Trascina per allargare o stringere le conversazioni") });
  const side = h("div", { class: "chat-side" }, h("div", { class: "side-top" }, sideNew, sideFind), historySearch, historyRows, sideGrip);
  // Another open conversation asks a permission: a line over the field takes there.
  const otherAsk = h("button", { class: "chat-other-ask" }) as HTMLButtonElement;
  otherAsk.style.display = "none";
  otherAsk.addEventListener("click", () => {
    const sid = State.pendingApproval?.chatSid;
    if (sid) switchTo(sid);
  });
  // Written while it answers: waiting under the conversation, each to send now, change or drop.
  const queueRow = h("div", { class: "chat-queue" });
  queueRow.style.display = "none";
  let queueKey = "";
  // Work the engine left in the background (claude_cli.rs follow): each one, and «Ferma tutto».
  const bgRow = h("div", { class: "chat-queue chat-bg" });
  bgRow.style.display = "none";
  let bgKey = "";
  // The picture of an empty conversation (chat-empty.ts), behind it.
  const empty = new ChatEmpty();
  const layout = h("div", { class: "chat-layout" }, side, h("div", { class: "chat-body" }, empty.el, head, log, jumpBtn, calcRow, hintRow, otherAsk, bgRow, queueRow, termRow, slashMenu, bar));
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card chat-card" }, layout),
  );
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

  async function submit(override?: string, target?: ChatSessionState) {
    const raw = override ?? input.value;
    const query = raw.trim();
    // The conversation on screen now (or the one whose queue goes on): the answer goes to it even if another one is shown by then.
    const c = target ?? State.chat;
    if (!query || c.sending) return;
    if (override == null && runSlash(query)) return;
    if (override == null) setInput("");
    // Back from Claude Desktop: what was said there first, then the island takes the session again.
    if (c.desktop) await pullDesktop(c, true);
    c.sending = true;
    c.stopping = false;
    c.at = Date.now();
    if (c === State.chat) stick = true;
    if (overlay && c === State.chat) showSide(false);
    // «Modifica»: the conversation goes back to just before that question.
    if (editing != null && c === State.chat) {
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
          return { text: r.text, log: null, context: null };
        })
        : await Bridge.chatSend(c.sid, asked, context, engine, c.auto && State.settings.chatTerminal === true, c.folder, c.team, c.effort ?? (State.settings.cliEffort || null),
          State.settings.chatTerminal === true && !c.auto ? c.mode : "", engine === "subscription" ? c.model : null, engine === "subscription" && c.fast);
      if (reply.log) c.logId = reply.log;
      // «Piano» ends when its plan is approved, as in Claude Desktop.
      if (!session && "mode" in reply && !c.auto) c.mode = (reply as { mode?: string }).mode ?? "";
      const note = (reply as { note?: string | null }).note;
      if (note && c === State.chat) flash(note);
      c.context = reply.context ?? null;
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
      c.working = false;
      c.teamRows = [];
      c.at = Date.now();
      if (c !== State.chat) c.unread = true;
      if (!State.chats.some((x) => x.sending || x.working)) State.stateOverride = null;
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      if (c === State.chat) input.focus();
      void refreshHistory();
      // What was written meanwhile goes now, the first in line.
      const next = c.queue.shift();
      if (next != null && State.chats.includes(c)) {
        State.notify();
        window.setTimeout(() => void submit(next, c), 0);
      }
    }
  }

  /** Written while it answers: the message waits for the end of the turn. */
  function enqueue() {
    const c = State.chat;
    const text = input.value.trim();
    if (!text) return;
    setInput("");
    // Claude Code takes it into the turn it is in, between two steps (as in Claude Desktop); else the queue.
    if (c.sending && !c.session && !c.team && engineOf(c) === "subscription") {
      void Promise.resolve(Bridge.chatSteer(c.sid, text)).then((ok) => {
        const question = [...c.history].reverse().find((m) => m.role === "user");
        if (ok && c.sending && question) {
          question.content += `\n\n↪ ${text}`;
          renderedCount = -1;
          flash(t("Aggiunto al lavoro in corso: Claude ne tiene conto subito."));
        } else c.queue.push(text);
        Sound.play("blip");
        State.notify();
        onHeightChange();
      });
      return;
    }
    c.queue.push(text);
    Sound.play("blip");
    State.notify();
    onHeightChange();
    input.focus();
  }

  /** «Invia subito»: the reply stops and this one goes first. */
  function sendNow(i: number) {
    const c = State.chat;
    const [text] = c.queue.splice(i, 1);
    if (text == null) return;
    if (!c.sending) {
      void submit(text, c);
      return;
    }
    c.queue.unshift(text);
    if (!c.session && !c.stopping) {
      c.stopping = true;
      void Bridge.chatStop(c.sid);
    }
    State.notify();
  }

  function renderBackground() {
    const c = State.chat;
    const key = `${c.sid}|${c.stopping ? 1 : 0}|${c.background.map((b) => b.id + b.description).join("\u0000")}`;
    if (key === bgKey) return;
    bgKey = key;
    const kindOf = (b: { kind: string }) => (b.kind.includes("agent") ? t("agente") : b.kind.includes("bash") || b.kind.includes("shell") ? t("comando") : t("lavoro"));
    const rows = c.background.map((b) => h("div", { class: "chat-queued" },
      h("span", { class: "chat-bg-dot" }),
      h("span", { class: "chat-queued-tag", text: kindOf(b) }),
      h("span", { class: "chat-queued-text", text: b.description || b.id, title: b.description || b.id }),
      h("button", { class: "chat-queued-btn", text: "✕", title: t("Chiedi di fermare solo questo lavoro"),
        onclick: () => {
          const ask = t("Ferma il lavoro in background «{name}» (id {id}) con TaskStop e dimmi a che punto era.", { name: b.description || b.id, id: b.id });
          if (c.sending) c.queue.push(ask);
          else void submit(ask, c);
          State.notify();
        } })));
    if (rows.length) {
      rows.unshift(h("div", { class: "chat-bg-head" },
        h("span", { text: t("In background: {n}. Il risultato arriva qui.", { n: c.background.length }) }),
        h("button", { class: "chat-queued-btn", text: t("Ferma tutto"), title: t("Ferma tutti i lavori in background di questa conversazione"),
          onclick: () => {
            c.background = [];
            c.working = false;
            if (!c.sending) c.streamed = "";
            void Bridge.chatStop(c.sid);
            State.notify();
          } })));
    }
    bgRow.replaceChildren(...rows);
    bgRow.style.display = rows.length ? "" : "none";
    onHeightChange();
  }

  function renderQueue() {
    const c = State.chat;
    const key = `${c.sid}|${c.sending ? 1 : 0}|${c.queue.join("\u0000")}`;
    if (key === queueKey) return;
    queueKey = key;
    queueRow.replaceChildren(...c.queue.map((text, i) => h("div", { class: "chat-queued" },
      h("span", { class: "chat-queued-tag", text: t("in attesa") }),
      h("span", { class: "chat-queued-text", text, title: text }),
      h("button", { class: "chat-queued-btn now", text: t("Invia subito"),
        title: c.sending ? t("Ferma la risposta e manda subito questo messaggio") : t("Manda subito questo messaggio"),
        onclick: () => sendNow(i) }),
      h("button", { class: "chat-queued-btn", text: t("Modifica"), title: t("Rimetti il messaggio nel campo"),
        onclick: () => {
          const [back] = c.queue.splice(i, 1);
          if (back == null) return;
          const now = input.value.trim();
          setInput(now ? `${back}\n${now}` : back);
          State.notify();
          input.focus();
        } }),
      h("button", { class: "chat-queued-btn", text: "✕", title: t("Togli dalla coda"),
        onclick: () => { c.queue.splice(i, 1); State.notify(); onHeightChange(); } }))));
    queueRow.style.display = c.queue.length ? "" : "none";
    onHeightChange();
  }

  /** The button: «Ferma» while it answers with an empty field, else «Invia» (in the queue while it answers). */
  function updateSendBtn() {
    const c = State.chat;
    const stopMode = (c.sending || c.working) && !c.session && !input.value.trim();
    const mode = stopMode ? "stop" : "send";
    if (send.dataset.mode !== mode) {
      send.dataset.mode = mode;
      send.classList.toggle("stop", stopMode);
      if (!stopMode) send.replaceChildren(planeIcon(14));
      else {
        // Sent: the plane flies off first, then «Ferma» takes its place.
        playIcon(send);
        window.setTimeout(() => {
          if (send.dataset.mode === "stop") send.replaceChildren(svg(ICONS.stop, 12));
        }, ICON_PLAY_MS);
      }
    }
    send.title = stopMode ? t("Ferma") : c.sending ? t("Metti in coda: parte a fine risposta (Ctrl+Invio: subito)") : t("Invia");
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
        mic.replaceChildren(micIcon());
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
      mic.replaceChildren(svg(ICONS.stop, 11));
      flash(t("Parla… clic su ■ per finire"), true);
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
  /** «⟲ File»: what changed from this question on, then a second click restores it. */
  let restoreAsk: { sid: string; at: number; until: number } | null = null;
  async function restoreFiles(index: number) {
    const c = State.chat;
    const list = (await Bridge.chatFilesSince(c.sid, index)) ?? [];
    if (!list.length) {
      flash(t("Nessun file cambiato da Claude Code da questa domanda in poi (i comandi non contano)."));
      return;
    }
    const ask = restoreAsk;
    if (!ask || ask.sid !== c.sid || ask.at !== index || Date.now() > ask.until) {
      restoreAsk = { sid: c.sid, at: index, until: Date.now() + 8000 };
      const names = list.map(([p, del]) => `${folderName(p)}${del ? ` (${t("da eliminare")})` : ""}`).join(", ");
      flash(t("Ripristino {n} file: {names}. Clic di nuovo su ⟲ File per confermare.", { n: list.length, names }));
      return;
    }
    restoreAsk = null;
    try {
      const n = await Bridge.chatFilesRestore(c.sid, index);
      flash(t("{n} file come prima di questa domanda.", { n }));
      Sound.play("finish");
    } catch (e) {
      flash(String(e).replace(/^Error:\s*/, ""));
    }
  }

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
      if (State.settings.chatTerminal === true) {
        bar.append(h("button", { class: "msg-act", title: t("Riporta i file cambiati da questa domanda in poi com'erano prima (come in Claude Desktop); la conversazione resta"), text: `⟲ ${t("File")}`, onclick: () => void restoreFiles(index) }));
      }
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
      if (!State.chats.some((x) => x.sending || x.working)) State.stateOverride = null;
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
      c.mode = "";
      c.model = null;
      c.fast = false;
      c.team = false;
      c.desktop = false;
      c.assistant = null;
      c.folder = null;
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
      // The engine goes on from a summary (lib.rs is_compact; Claude Code's own /compact too).
      { name: "compatta", hint: t("Riassumi la conversazione per il motore: meno contesto, meno token"), run: () => {
        const c = State.chat;
        if (c.sending) c.queue.push("/compatta");
        else void submit("/compatta", c);
        State.notify();
      } },
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
    // Claude Code's own commands, the user's (.claude/commands), skills and plugins, as Claude Desktop lists them.
    if (engineOf(State.chat) === "subscription") {
      if (Date.now() - claudeRead > 30_000) {
        claudeRead = Date.now();
        void Promise.resolve(Bridge.chatClaudeCommands()).then((l) => { if (l) claudeCommands = l; });
      }
      for (const name of claudeCommands) {
        if (taken.has(name)) continue;
        taken.add(name);
        list.push({ name, arg: true, hint: `✳ ${t("Comando di Claude Code")}`, run: (a) => {
          const text = a ? `/${name} ${a}` : `/${name}`;
          const c = State.chat;
          if (c.sending) c.queue.push(text);
          else void submit(text, c);
          State.notify();
        } });
      }
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
    // Claude Code: how much it reasons (`--effort`), for this chat and the next ones.
    if (State.chatEngine === "subscription") {
      const now = effortOf(State.chat);
      engineMenu.append(h("div", { class: "engine-head", text: t("Impegno di Claude") }));
      for (const [id, label, hint] of efforts()) {
        engineMenu.append(h("button", {
          class: `engine-item${id === now ? " on" : ""}`, title: hint, text: label,
          onclick: () => pickEffort(id),
        }));
      }
      engineMenu.append(h("div", { class: "engine-note", text: t("Più impegno: risposte più ragionate, ma più lente e più consumo. Vale da subito, anche a metà conversazione.") }));
      // The model for this conversation, as Claude Desktop's picker: the session goes on with it.
      const model = State.chat.model ?? "";
      engineMenu.append(h("div", { class: "engine-head", text: t("Modello di Claude") }));
      for (const [id, label] of [["", t("Quello delle Impostazioni")], ["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]] as [string, string][]) {
        engineMenu.append(h("button", {
          class: `engine-item${id === model ? " on" : ""}`, text: label,
          onclick: () => { State.chat.model = id || null; engineMenu.style.display = "none"; Sound.play("blip"); State.notify(); input.focus(); },
        }));
      }
      engineMenu.append(h("button", {
        class: `engine-item${State.chat.fast ? " on" : ""}`, title: t("Risposte più rapide con lo stesso modello; costa di più e richiede l'uso extra sull'account Claude"),
        text: `${State.chat.fast ? "✓ " : ""}${t("Fast mode")}`,
        onclick: () => { State.chat.fast = !State.chat.fast; engineMenu.style.display = "none"; Sound.play("blip"); State.notify(); input.focus(); },
      }));
      engineMenu.append(h("div", { class: "engine-note", text: t("Per questa conversazione: Claude continua la stessa sessione con il modello scelto.") }));
    }
    engineMenu.style.display = "";
  }

  function efforts(): [string, string, string][] {
    return [
      ["", t("Predefinito di Claude Code"), t("Quello delle impostazioni di Claude Code o del modello")],
      ["low", t("Basso"), t("Veloce ed economico: domande semplici")],
      ["medium", t("Medio"), t("Il giusto per quasi tutto")],
      ["high", t("Alto"), t("Ragiona di più: lavori complessi")],
      ["xhigh", t("Molto alto"), t("Per i lavori lunghi e difficili")],
      ["max", t("Massimo"), t("Il più lento e costoso")],
    ];
  }

  function effortOf(c: ChatSessionState): string {
    return c.effort ?? State.settings.cliEffort ?? "";
  }

  /** For this chat, and remembered for the next ones. */
  function pickEffort(id: string) {
    engineMenu.style.display = "none";
    State.chat.effort = id;
    State.settings.cliEffort = id;
    void Bridge.saveSettings(State.settings);
    State.notify();
  }

  /** «Progetto…»: where this conversation works; the default stays the folder of Impostazioni → Chat. */
  async function toggleFolderMenu() {
    if (engineMenu.style.display !== "none") {
      engineMenu.style.display = "none";
      return;
    }
    const recent = await Bridge.chatFolders().catch(() => [] as string[]);
    const own = State.chat.folder;
    const list = own && !recent.some((f) => f.toLowerCase() === own.toLowerCase()) ? [own, ...recent] : recent;
    clear(engineMenu);
    engineMenu.append(h("button", {
      class: `engine-item${own ? "" : " on"}`, title: State.settings.chatFolder || t("la tua cartella utente"), text: t("Cartella predefinita"),
      onclick: () => pickFolder(null),
    }));
    for (const f of list) {
      engineMenu.append(h("button", {
        class: `engine-item${f === own ? " on" : ""}`, title: f, text: folderName(f),
        onclick: () => pickFolder(f),
      }));
    }
    engineMenu.append(h("button", {
      class: "engine-item", text: t("Scegli una cartella…"),
      onclick: () => {
        engineMenu.style.display = "none";
        void Bridge.chatPickFolder(own ?? (State.settings.chatFolder || null))
          .then((f) => { if (f) pickFolder(f); })
          .catch((e) => flash(String(e).replace(/^Error:\s*/, "")));
      },
    }));
    // A git worktree on a branch of its own, as Claude Desktop gives a session: two chats never touch the same files.
    const base = own ?? (State.settings.chatFolder || null);
    if (base) {
      engineMenu.append(h("button", {
        class: "engine-item", title: t("Una copia del progetto con un suo branch (git worktree) in .claude\\worktrees: questa chat lavora lì senza toccare i file degli altri"),
        text: t("Copia separata (worktree) di {name}", { name: folderName(base) }),
        onclick: () => {
          engineMenu.style.display = "none";
          void Bridge.chatWorktree(base)
            .then((f) => { pickFolder(f); flash(t("Questa chat lavora in una copia separata: {path}", { path: f })); })
            .catch((e) => flash(String(e).replace(/^Error:\s*/, "")));
        },
      }));
    }
    engineMenu.append(h("div", { class: "engine-note", text: t("Vale per questa chat: legge le regole e il git del progetto. La predefinita: Impostazioni → Chat") }));
    engineMenu.style.display = "";
  }

  function folderName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }

  function pickFolder(folder: string | null) {
    engineMenu.style.display = "none";
    if (folder === State.chat.folder || State.chat.sending) return;
    // Another folder is another conversation (Claude Code's sessions belong to theirs).
    if (State.chatHistory.length) startOver();
    State.chat.folder = folder;
    State.notify();
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
    else showSearch(false);
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
  /** Claude Code sessions of the terminal or Claude Desktop (read again at most every 60 s). */
  let outside: { id: string; title: string; folder: string; updated: number }[] = [];
  let outsideRead = 0;
  let historyRead = false;
  const closedProjects = readClosedProjects();

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
    const freshRow = (c: ChatSessionState): HTMLElement => {
      const first = c.history.find((m) => m.role === "user")?.content ?? "";
      const name = CHAT_ENGINES.find((e) => e.id === engineOf(c))?.name ?? engineOf(c);
      return h("div", { class: `history-item${c.sid === State.chatSid ? " on" : ""}`, title: name, onclick: () => switchTo(c.sid) },
        h("div", { class: "history-text" }, h("span", { class: "history-title", text: first || t("Nuova chat") })),
        ...[badge(c)].filter((b): b is HTMLElement => !!b));
    };
    const loose = fresh.filter((c) => !c.folder);
    if (loose.length) historyRows.append(h("div", { class: "side-group", text: t("Aperte") }));
    for (const c of loose) historyRows.append(freshRow(c));
    if (!list.length && !fresh.length) {
      historyRows.append(h("div", { class: "engine-note", text: query.trim()
        ? t("Nessuna conversazione con queste parole.")
        : State.settings.chatHistory === false
          ? t("La cronologia è spenta: Impostazioni → Chat.")
          : t("Ancora nessuna conversazione. Restano qui, su questo PC.") }));
    }
    const savedRow = (c: ChatSummary): HTMLElement => {
      const engine = CHAT_ENGINES.find((e) => e.id === c.engine)?.name ?? c.engine;
      const open = State.chats.find((x) => x.logId === c.id);
      const del = h("button", { class: "history-del", title: t("Elimina"), text: "✕" });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void Promise.resolve(Bridge.chatHistoryDelete(c.id)).then(() => refreshHistory());
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
      const meta = `${when(c.updated)} · ${engine} · ${tn("{n} domanda", "{n} domande", c.turns)}`;
      const row = h("div", { class: `history-item${open && open.sid === State.chatSid ? " on" : ""}`, title: meta, onclick: () => void reopen(c.id) },
        h("div", { class: "history-text" }, titleEl),
        ...[badge(open)].filter((b): b is HTMLElement => !!b),
        edit, pin, del);
      return row;
    };
    // Fissate on top, then the projects, then the rest by date. With no
    // project at all the list is the same as ever.
    let group = "";
    const dated = (c: ChatSummary) => {
      const g = groupOf(c);
      if (g !== group) {
        group = g;
        historyRows.append(h("div", { class: "side-group", text: g }));
      }
      historyRows.append(savedRow(c));
    };
    list.filter((c) => c.pinned).forEach(dated);
    for (const p of projectsOf(list.filter((c) => !c.pinned && c.folder), fresh.filter((c) => c.folder))) drawProject(p, query.trim() !== "", savedRow, freshRow);
    list.filter((c) => !c.pinned && !c.folder).forEach(dated);
    // Sessions of Claude Code started elsewhere: a click takes one in and resumes it here.
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const others = outside.filter((s) => words.every((w) => s.title.toLowerCase().includes(w) || s.folder.toLowerCase().includes(w)));
    if (others.length) historyRows.append(h("div", { class: "side-group", text: t("Claude Code fuori da EasyIsland") }));
    for (const s of others) {
      historyRows.append(h("div", { class: "history-item", title: `${when(s.updated)} · ${s.folder}`, onclick: () => void takeSession(s.id) },
        h("div", { class: "history-text" }, h("span", { class: "history-title", text: s.title }))));
    }
    onHeightChange();
  }

  /** A session of the terminal or Claude Desktop: into the history, then reopened on that session. */
  async function takeSession(id: string) {
    try {
      const conv = await Bridge.chatClaudeSessionImport(id);
      outside = outside.filter((s) => s.id !== id);
      await reopen(conv);
      void refreshHistory();
    } catch (e) {
      flash(String(e).replace(/^Error:\s*/, ""));
    }
  }

  interface Project {
    folder: string;
    saved: ChatSummary[];
    fresh: ChatSessionState[];
    at: number;
  }

  /** The conversations by folder, the project used last first. */
  function projectsOf(saved: ChatSummary[], fresh: ChatSessionState[]): Project[] {
    const map = new Map<string, Project>();
    const of = (folder: string) => {
      const key = folder.toLowerCase();
      let p = map.get(key);
      if (!p) map.set(key, p = { folder, saved: [], fresh: [], at: 0 });
      return p;
    };
    for (const c of saved) {
      const p = of(c.folder!);
      p.saved.push(c);
      p.at = Math.max(p.at, c.updated);
    }
    for (const c of fresh) {
      const p = of(c.folder!);
      p.fresh.push(c);
      p.at = Math.max(p.at, c.at);
    }
    return [...map.values()].sort((a, b) => b.at - a.at);
  }

  /** A project: its head (closes it, «+» starts a chat in it) and its conversations. */
  function drawProject(p: Project, searching: boolean, savedRow: (c: ChatSummary) => HTMLElement, freshRow: (c: ChatSessionState) => HTMLElement) {
    const key = p.folder.toLowerCase();
    const opened = p.saved.map((c) => State.chats.find((x) => x.logId === c.id)).concat(p.fresh);
    // The conversation on screen is never hidden, nor is the search's result.
    const shut = closedProjects.has(key) && !searching && !opened.some((c) => c?.sid === State.chatSid);
    // Closed, it still says that something in it works or asks.
    const alert = shut ? opened.map((c) => badge(c)).find((b) => b) : null;
    const toggle = h("button", { class: "side-project-toggle", title: p.folder, onclick: () => {
      if (closedProjects.has(key)) closedProjects.delete(key);
      else closedProjects.add(key);
      saveClosedProjects(closedProjects);
      renderSide();
    } },
      h("span", { class: "side-project-arrow", text: shut ? "▸" : "▾" }),
      h("span", { class: "side-project-name", text: folderName(p.folder) }),
      h("span", { class: "side-project-count", text: String(p.saved.length + p.fresh.length) }));
    historyRows.append(h("div", { class: "side-project" }, toggle, alert ?? null,
      // A folder only counts in Modalità terminale.
      State.settings.chatTerminal === true && h("button", { class: "side-project-new", title: t("Nuova chat in questo progetto"), text: "+", onclick: () => newInProject(p.folder) })));
    if (shut) return;
    for (const c of p.fresh) historyRows.append(freshRow(c));
    for (const c of p.saved) historyRows.append(savedRow(c));
  }

  function newInProject(folder: string) {
    if (overlay) showSide(false);
    const c = !State.chat.history.length && !State.chat.sending ? State.chat : openNew();
    c.folder = folder;
    closedProjects.delete(folder.toLowerCase());
    saveClosedProjects(closedProjects);
    input.focus();
    State.notify();
  }

  async function refreshHistory() {
    const seq = ++searchSeq;
    const q = historySearch.value;
    if (Date.now() - outsideRead > 60_000) {
      outsideRead = Date.now();
      outside = (await Bridge.chatClaudeSessions()) ?? [];
    }
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
      showSearch(false);
      if (overlay) showSide(false);
      input.focus();
    }
  });
  sideNew.addEventListener("click", startOver);

  /** «Cerca» opens the field; closing it drops the search and brings the whole list back. */
  function showSearch(on: boolean) {
    historySearch.style.display = on ? "" : "none";
    sideFind.classList.toggle("on", on);
    if (on) historySearch.focus();
    else if (historySearch.value) {
      historySearch.value = "";
      void refreshHistory();
    }
  }
  sideFind.addEventListener("click", () => showSearch(historySearch.style.display === "none"));

  /** «/cronologia», «/cerca …»: the sidebar open, with the search when there is one. */
  async function toggleHistory(query?: string) {
    engineMenu.style.display = "none";
    historySearch.value = query ?? "";
    showSide(true);
    await refreshHistory();
    showSearch(true);
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
      // Claude Code's session resumed: its context at once, read from the session's file.
      c.context = got.context ?? null;
      c.text = null;
      c.window = null;
      c.attach = [];
      c.session = null;
      c.engineOverride = got.engine === State.settings.chatEngine ? null : (got.engine as ChatEngine);
      c.folder = got.folder || null;
      c.auto = false;
      c.mode = "";
      c.model = null;
      c.fast = false;
      c.team = false;
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
  teamBtn.addEventListener("click", () => {
    State.chat.team = !State.chat.team;
    Sound.play("blip");
    State.notify();
    input.focus();
  });
  autoBtn.addEventListener("click", () => {
    // Claude Code: Consenti / Nega → Accetta modifiche → Piano → Automatica (its own modes, as Claude Desktop offers them).
    const c = State.chat;
    if (engineOf(c) === "subscription") {
      const order = ["", "acceptEdits", "plan", "auto"];
      const now = c.auto ? "auto" : c.mode;
      const next = order[(order.indexOf(now) + 1) % order.length];
      c.auto = next === "auto";
      c.mode = next === "auto" ? "" : next;
    } else {
      c.auto = !c.auto;
      c.mode = "";
    }
    Sound.play("blip");
    State.notify();
    input.focus();
  });
  // Drawn in the island (a native <select> menu would open behind it); a click elsewhere closes it.
  document.addEventListener("pointerdown", (e) => {
    if (engineMenu.style.display !== "none" && !bar.contains(e.target as Node)) engineMenu.style.display = "none";
  });
  void onEvent<{ sid?: string; text: string }>("chat-stream", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c?.sending) return;
    c.streamed = p.text;
    if (c === State.chat) State.notify();
  });
  function drawTerminal() {
    const term = terms.get(State.chat.sid);
    termRow.style.display = term ? "" : "none";
    termBtn.classList.toggle("on", !!term);
    termOut.textContent = term ? term.lines.join("\n") : "";
    termOut.scrollTop = termOut.scrollHeight;
    onHeightChange();
  }
  async function openTerminal() {
    const c = State.chat;
    try {
      const id = await Bridge.terminalOpen(c.folder ?? (State.settings.chatFolder || null));
      terms.set(c.sid, { id, lines: [] });
      drawTerminal();
      termIn.focus();
    } catch (e) {
      flash(String(e).replace(/^Error:\s*/, ""));
    }
  }
  function closeTerminal() {
    const term = terms.get(State.chat.sid);
    if (term) void Bridge.terminalClose(term.id);
    terms.delete(State.chat.sid);
    drawTerminal();
    input.focus();
  }
  async function restartTerminal() {
    closeTerminal();
    await openTerminal();
  }
  termBtn.addEventListener("click", () => {
    if (terms.has(State.chat.sid)) closeTerminal();
    else void openTerminal();
  });
  termIn.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if ((e as KeyboardEvent).key !== "Enter") return;
    const term = terms.get(State.chat.sid);
    const line = termIn.value;
    termIn.value = "";
    if (!term) return;
    term.lines.push(`> ${line}`);
    drawTerminal();
    void Bridge.terminalWrite(term.id, line).catch((err) => { term.lines.push(String(err).replace(/^Error:\s*/, "")); drawTerminal(); });
  });
  void onEvent<{ id: number; text: string; error?: boolean }>("terminal-out", (p) => {
    for (const term of terms.values()) {
      if (term.id !== p.id) continue;
      term.lines.push(p.text);
      // The last 2000 lines.
      if (term.lines.length > 2000) term.lines.splice(0, term.lines.length - 2000);
      if (terms.get(State.chat.sid) === term) drawTerminal();
    }
  });
  // A piece of work Claude proposed and the user allowed (agent.rs chat_start): a conversation of its own, beside this one.
  void onEvent<{ title: string; prompt: string; folder?: string | null }>("chat-new", (p) => {
    if (!p.prompt?.trim()) return;
    const here = State.chat;
    const c = newChatSession();
    c.folder = p.folder || here.folder;
    c.engineOverride = here.engineOverride;
    State.chats.push(c);
    void submit(p.prompt, c);
    flash(t("Nuova conversazione a parte: «{title}». La trovi nella barra laterale.", { title: p.title || p.prompt.slice(0, 40) }));
    State.notify();
  });
  // Comments on the lines of «Modifiche» (preview window): a message of the chat on screen.
  void onEvent<{ text: string }>("preview-chat", (p) => {
    if (!p.text?.trim()) return;
    const c = State.chat;
    if (c.sending) {
      setInput(p.text);
      enqueue();
    } else void submit(p.text, c);
  });
  // The list of the work left in the background, as it changes.
  void onEvent<{ sid?: string; tasks: BgTask[] }>("chat-background", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c) return;
    c.background = p.tasks ?? [];
    if (c === State.chat) State.notify();
  });
  // A turn the engine started by itself (background work ended): at work like a turn, until its answer.
  void onEvent<{ sid?: string; text: string | null }>("chat-working", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c || c.sending) return;
    c.working = p.text != null;
    c.streamed = p.text ?? "";
    if (c.working) State.stateOverride = "thinking";
    else if (!State.chats.some((x) => x.sending || x.working)) State.stateOverride = null;
    if (!c.working) renderedCount = -1;
    if (c === State.chat) State.notify();
  });
  // An answer written after the turn, when background work ended: in the conversation, with a sound.
  void onEvent<{ sid?: string; text: string }>("chat-later", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c || !p.text.trim()) return;
    if (!c.sending) {
      c.working = false;
      c.streamed = "";
    }
    c.history.push({ id: nextId++, role: "assistant", content: p.text, engine: engineOf(c) });
    c.at = Date.now();
    if (c !== State.chat || State.mode !== "expanded") c.unread = true;
    Sound.play("finish");
    renderedCount = -1;
    State.notify();
    void refreshHistory();
  });
  void onEvent<{ sid?: string; rows: TeamRow[] }>("chat-team", (p) => {
    const c = State.chats.find((x) => x.sid === p.sid);
    if (!c?.sending) return;
    c.teamRows = p.rows;
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
  const lineShows = () => State.mode === "expanded" || isPopped("chat");
  const typeLine = new TypeLine(lineShows, toBottom);
  // «Multi agent»: a line per engine at work, under the reply.
  const teamEl = h("div", { class: "team-rows" });
  const teamLines = new Map<number, { el: HTMLElement; line: TypeLine }>();
  function drawTeam(rows: TeamRow[]) {
    for (const [id, x] of teamLines) {
      if (rows.some((r) => r.id === id)) continue;
      x.line.reset();
      x.el.remove();
      teamLines.delete(id);
    }
    for (const r of rows) {
      let x = teamLines.get(r.id);
      if (!x) {
        const line = new TypeLine(lineShows, toBottom);
        x = { el: h("div", { class: "team-row" }, h("span", { class: "team-dot" }), h("span", { class: "team-name", text: r.engine }), line.el), line };
        teamLines.set(r.id, x);
        teamEl.append(x.el);
        line.set(r.job);
      }
      x.el.dataset.state = r.state;
      if (r.state === "work") {
        const { status } = splitStatus(r.status);
        if (status) x.line.set(status);
      } else x.line.set(r.state === "error" ? r.status : r.job);
    }
  }

  folderBtn.addEventListener("click", () => void toggleFolderMenu());
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
    // Writing on its own after background work: «Ferma» stops it (a message goes in as usual).
    if (c.working && !c.sending && !input.value.trim()) {
      c.working = false;
      c.streamed = "";
      c.background = [];
      void Bridge.chatStop(c.sid);
      State.notify();
      return;
    }
    if (c.sending) {
      if (input.value.trim()) {
        enqueue();
        return;
      }
      if (!c.session && !c.stopping) {
        c.stopping = true;
        void Bridge.chatStop(c.sid);
      }
      return;
    }
    void submit();
  });
  input.addEventListener("input", () => {
    updateSendBtn();
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
      // While it answers: in the queue (a command still runs); Ctrl+Enter stops the reply and sends this at once.
      const typed = input.value.trim();
      if (State.chat.sending && typed && !(typed.startsWith("/") && runSlash(typed))) {
        enqueue();
        if (k.ctrlKey) sendNow(State.chat.queue.length - 1);
        return;
      }
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
      const sending = State.chat.sending || State.chat.working;
      const streamed = State.chat.streamed;
      const ownFolder = State.chat.folder;
      folderBtn.style.display = State.settings.chatTerminal === true && !asked ? "" : "none";
      // The project's branch: read again when the conversation or the project change and when a reply ends (an agent may have moved it).
      const branchKey = ownFolder && !sending ? `${State.chatSid}|${ownFolder}` : "";
      if (ownFolder && branchKey && branchKey !== branchRead) {
        const folder = ownFolder;
        void Bridge.chatBranch(folder).then((b) => {
          if ((branches.get(folder) ?? "") === (b ?? "")) return;
          branches.set(folder, b ?? "");
          State.notify();
        });
      }
      branchRead = branchKey;
      // Its pull request: when a reply ends and the project shows, at most every 60 s.
      if (ownFolder && !sending && State.settings.chatTerminal === true && Date.now() - (prs.get(ownFolder)?.at ?? 0) > 60_000) {
        const folder = ownFolder;
        prs.set(folder, { pr: prs.get(folder)?.pr ?? null, at: Date.now() });
        void Promise.resolve(Bridge.chatPullRequest(folder)).then((pr) => {
          prs.set(folder, { pr: pr && pr.state === "OPEN" ? pr : null, at: Date.now() });
          State.notify();
        });
      }
      const pr = ownFolder && State.settings.chatTerminal === true ? prs.get(ownFolder)?.pr ?? null : null;
      prBtn.style.display = pr ? "" : "none";
      if (pr) {
        const mark = pr.failed.length ? `✗ ${pr.failed.length}` : pr.pending ? "…" : "✓";
        const label = `#${pr.number} ${mark}`;
        if (prBtn.textContent !== label) prBtn.textContent = label;
        prBtn.classList.toggle("failed", pr.failed.length > 0);
        prBtn.title = `${pr.title}\n${t("Controlli: {ok} riusciti, {ko} non riusciti, {wait} in corso.", { ok: pr.passed, ko: pr.failed.length, wait: pr.pending })}`;
      }
      const branch = ownFolder ? branches.get(ownFolder) ?? "" : "";
      const [ctxUsed, ctxSize] = State.chat.context ?? [0, 0];
      const ctxShare = ctxSize ? Math.min(100, Math.round(ctxUsed / ctxSize * 100)) : 0;
      contextMeter.style.display = ctxUsed ? "" : "none";
      contextMeter.classList.toggle("full", ctxShare >= 80);
      contextMeter.classList.toggle("sized", ctxSize > 0);
      contextMeter.style.setProperty("--p", `${ctxShare}%`);
      contextPct.textContent = ctxSize ? `${ctxShare}%` : `${Math.round(ctxUsed / 1000)}k`;
      contextMeter.title = ctxSize
        ? t("Contesto: {used} di {size} token", { used: ctxUsed.toLocaleString(locale()), size: ctxSize.toLocaleString(locale()) })
        : t("Contesto: {used} token", { used: ctxUsed.toLocaleString(locale()) });
      const folderLabel = ownFolder ? folderName(ownFolder) : t("Progetto…");
      const folderKey = `${folderLabel}|${branch}`;
      if (folderBtn.dataset.label !== folderKey) {
        folderBtn.dataset.label = folderKey;
        folderBtn.replaceChildren(folderLabel, ...(branch ? [h("span", { class: "folder-branch", text: ` · ${branch}` })] : []));
      }
      folderBtn.title = ownFolder
        ? [ownFolder, branch && t("Branch: {name}", { name: branch })].filter(Boolean).join("\n")
        : t("Scegli la cartella del progetto per questa chat");
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

      const effort = State.chatEngine === "subscription" ? efforts().find(([id]) => id && id === effortOf(State.chat))?.[1] : undefined;
      engineBtn.textContent = `${engineLabel({ ...State.settings, chatEngine: State.chatEngine })}${effort ? ` · ${effort.toLowerCase()}` : ""} ▾`;
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
      const team = (State.settings.chatTeam ?? []).some((e) => e !== engineOf(State.chat)) && !State.chat.session;
      teamBtn.style.display = team ? "" : "none";
      teamBtn.classList.toggle("on", team && State.chat.team);
      teamBtn.title = State.chat.team
        ? t("Multi agent acceso: questo motore guida, gli altri scelti in Impostazioni aiutano e controllano. Clic per spegnerlo")
        : t("Multi agent: in questa conversazione il motore guida e affida pezzi agli altri motori scelti in Impostazioni; un altro motore controlla il lavoro. Costa di più e richiede più tempo");
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
      const claudeMode = terminal && !auto && engineOf(State.chat) === "subscription" ? State.chat.mode : "";
      autoBtn.classList.toggle("mode", !!claudeMode);
      const modeLabel = auto ? t("Automatica") : claudeMode === "plan" ? t("Piano") : claudeMode === "acceptEdits" ? t("Accetta modifiche") : t("Automatica");
      const labelEl = autoBtn.querySelector("span");
      if (labelEl && labelEl.textContent !== modeLabel) labelEl.textContent = modeLabel;
      el.querySelector(".chat-card")?.classList.toggle("auto", auto);
      autoBtn.title = claudeMode === "plan"
        ? t("Piano: Claude Code legge e prepara un piano senza cambiare niente; lo approvi dalla card e poi lavora. Clic: Automatica")
        : claudeMode === "acceptEdits"
        ? t("Accetta modifiche: le modifiche ai file vanno senza chiedere, i comandi chiedono ancora. Clic: Piano")
        : State.chatEngine === "subscription"
        ? (auto ? t("Automatica: Claude Code decide da solo e blocca le azioni rischiose. Clic per tornare a Consenti / Nega")
          : t("Modalità di Claude Code. Clic: Accetta modifiche, poi Piano, poi Automatica, poi di nuovo Consenti / Nega"))
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
      const sideKey = `${State.chatSid}|${State.pendingApproval?.chatSid ?? ""}|${State.chats.map((c) => `${c.sid}${c.sending ? "s" : ""}${c.unread ? "u" : ""}${c.logId ?? ""}${c.history.length ? "h" : ""}${c.folder ?? ""}`).join(",")}`;
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
        }
        if (thinking) log.append(h("div", { class: "chat-row" }, typeLine.el), teamEl);
        toBottom();
      }
      // The growing reply: only its bubble is redrawn.
      const { body, status } = splitStatus(streamed);
      if (streamEl && streamEl.dataset.len !== String(body.length)) {
        streamEl.dataset.len = String(body.length);
        streamEl.style.display = body ? "" : "none";
        streamEl.replaceChildren(...(body ? [bubble({ id: 0, role: "assistant", content: body }, true).firstChild!] : []));
        toBottom();
      }
      // What it is doing now types itself under the reply.
      if (thinking) typeLine.set(streamed ? status : null);
      else typeLine.reset();
      const rows = thinking ? State.chat.teamRows : [];
      drawTeam(rows);
      // With the team at work, an empty line of the lead's would only blink there.
      typeLine.el.style.display = rows.length && !status ? "none" : "";
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
      // An empty conversation: its quiet picture (Impostazioni → Chat → «Chat vuota»).
      empty.show(!State.chatHistory.length && !sending && !req && !asked ? emptyArt(State.settings.chatEmptyArt) : null);
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

      // The field stays on while it answers: what is written waits in the queue.
      input.disabled = false;
      updateSendBtn();
      renderQueue();
      renderBackground();
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
