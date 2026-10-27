// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatSummary } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, State, engineLabel, type ChatAssistant, type ChatEngine, type ChatMessage, type QuickAction, type Skill } from "../core/state";
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
  actions: { runAction(a: QuickAction): void; decide(d: "allow" | "deny" | "always"): void },
): ViewHost {
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
  // «Anteprima» (src/preview/): files and pages of the chat's work, in their window.
  const previewBtn = h("button", { class: "history-btn", title: t("Anteprima: file e pagine web accanto alla chat") }, svg(ICONS.preview, 13, { stroke: 1.8 })) as HTMLButtonElement;
  // Opens the Anteprima, and closes it when it is open in the island.
  previewBtn.addEventListener("click", () => void (State.previewOpen ? Bridge.previewHide() : Bridge.previewShow()));
  const head = h("div", { class: "chat-head" }, chipRow, engineBtn, remoteBtn, autoBtn, previewBtn, historyBtn, exportBtn, engineMenu);
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
  // 🎤: dictation — the service of Telegram's «Vocali» if one is chosen, else Windows' own (Win+H).
  const mic = h("button", { class: "mic-btn", title: t("Detta (clic per iniziare e per finire)"), text: "🎤" }) as HTMLButtonElement;
  const bar = h("div", { class: "chat-bar" }, fresh, input, mic, send);
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
  // «@appunti»: copied text added to the next question (any turn, any engine).
  let textAttach: { label: string; text: string } | null = null;
  // The assistant of this conversation ("/" → an assistant), shown as a chip.
  let assistant: ChatAssistant | null = null;
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
    if (textAttach) {
      asked = `${textAttach.label}:\n${textAttach.text}\n\n${asked}`;
      textAttach = null;
    }

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

  /** «⑂ Dirama da qui» (as LibreChat and TypingMind fork a chat): a new conversation up to this answer. */
  async function fork(index: number) {
    if (sending) return;
    const keep = State.chatHistory.slice(0, index + 1);
    State.chatHistory = keep;
    renderedCount = -1;
    await Bridge.chatFork(lines(keep));
    flash(`⑂ ${t("Nuova conversazione da qui: quella di prima resta nella cronologia")}`);
    Sound.play("blip");
    State.notify();
    input.focus();
  }

  /** "/" → an assistant: a new conversation with its engine and instructions. */
  async function useAssistant(a: ChatAssistant) {
    if (sending) return;
    startOver();
    await Bridge.chatReset();
    assistant = a;
    if (a.engine && CHAT_ENGINES.some((e) => e.id === a.engine)) {
      State.chatEngineOverride = a.engine === State.settings.chatEngine ? null : (a.engine as ChatEngine);
    }
    await Bridge.chatPersona(a.instructions);
    chipRow.dataset.label = "";
    flash(`${a.icon || "🤖"} ${t("Assistente {n}: scrivi la domanda", { n: a.name })}`);
    State.notify();
    input.focus();
  }

  function dropAssistant() {
    assistant = null;
    void Bridge.chatPersona(null);
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
      State.chatAttach = { name: pic.name, path: pic.path };
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
            State.chatAttach = { name: f.name, path: f.path };
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
        State.chatAttach = { name: f.name, path: f.path };
        Sound.play("approve");
        State.notify();
      },
    }));
    renderMenu();
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
    textAttach = null;
    assistant = null;
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
      const titleEl = h("span", { class: "history-title", text: `${c.pinned ? "📌 " : ""}${c.title}` });
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
      const row = h("div", { class: "history-item", title: c.title, onclick: () => void reopen(c.id) },
        h("div", { class: "history-text" },
          titleEl,
          h("span", { class: "history-meta", text: `${when(c.updated)} · ${engine} · ${tn("{n} domanda", "{n} domande", c.turns)}` })),
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
      textAttach = null;
      if (assistant) dropAssistant();
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

  mic.addEventListener("click", () => void dictate());
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
      const chipKey = `${pick ? "pick" : ""}${wantChip}${win && !pick ? win.path : ""}|${attach?.path ?? ""}|${assistant?.id ?? ""}|${textAttach?.text.length ?? ""}`;
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
        if (textAttach && !pick) {
          chipRow.append(contextChip(`📋 ${textAttach.label} · ${t("{n} caratteri", { n: textAttach.text.length.toLocaleString(locale()) })}`, undefined, () => {
            textAttach = null;
            chipRow.dataset.label = "";
            State.notify();
            input.focus();
          }, t("Togli il testo")));
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
      previewBtn.style.display = terminal && State.settings.chatPreview !== false ? "" : "none";
      previewBtn.classList.toggle("on", State.previewOpen);
      previewBtn.title = State.previewOpen ? t("Chiudi l'Anteprima") : t("Anteprima: file e pagine web accanto alla chat");
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
      // The waiting permission, always the last thing in the conversation.
      const req = State.pendingApproval?.source === "chat" ? State.pendingApproval : null;
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
      fresh.style.display = State.chatHistory.length > 0 || file || text || win || asked || attach || assistant || textAttach ? "" : "none";
      mic.disabled = sending;
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
