// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatSummary } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, State, engineLabel, type ChatEngine, type ChatMessage } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import type { ViewHost } from "./views";
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

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  // Claude answers in markdown: rendered as DOM, never as HTML (core/markdown.ts).
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

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  // The engine and model, above the chat: a click picks another one.
  const engineBtn = h("button", { class: "engine-pick", title: t("Cambia motore della chat") }) as HTMLButtonElement;
  const engineMenu = h("div", { class: "engine-menu" });
  engineMenu.style.display = "none";
  // The conversations of before (chat_log.rs): a click reopens one.
  const historyBtn = h("button", { class: "history-btn", title: t("Cronologia delle chat") }, svg(ICONS.history, 13, { stroke: 2 })) as HTMLButtonElement;
  const historyMenu = h("div", { class: "history-menu" });
  historyMenu.style.display = "none";
  const head = h("div", { class: "chat-head" }, chipRow, engineBtn, historyBtn, engineMenu);
  const log = h("div", { class: "chat-log" });
  // A reply arriving (OpenAI-compatible engines stream it, openai.rs).
  let streamEl: HTMLElement | null = null;
  let streamed = "";
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: t("Chiedimi qualsiasi cosa…"),
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: t("Invia") }, svg(ICONS.arrowUp, 14));
  const fresh = h("button", { class: "new-chat-btn", title: t("Nuova chat (Ctrl+N)") }, svg(ICONS.plus, 12), h("span", { text: t("Nuova chat") }));
  const bar = h("div", { class: "chat-bar" }, fresh, input, send);
  // The calculator: a calculation typed in the field shows its result here.
  const calcValue = h("b", { class: "calc-value" });
  const calcHint = h("span", { class: "calc-hint", text: t("Invio copia · Ctrl+Invio chiede alla chat") });
  const calcRow = h("div", { class: "calc-row" }, h("span", { class: "calc-eq", text: "=" }), calcValue, calcHint);
  calcRow.style.display = "none";
  let calcResult: number | null = null;
  function updateCalc() {
    calcResult = calculate(input.value);
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
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, head, historyMenu, log, calcRow, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;
  let drafted = false;

  async function submit(override?: string) {
    const query = (override ?? input.value).trim();
    if (!query || sending) return;
    if (override == null) {
      input.value = "";
      updateCalc();
    }
    sending = true;
    if (historyMenu.style.display !== "none") showHistory(false);
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const text = State.chatText;
    const first = State.chatHistory.length === 1;
    const context: ChatContext | null = !first
      ? null
      : text
        ? { kind: "text", label: text.label, text: text.text }
        : file
          ? { kind: "file", name: file.name, path: file.path }
          : null;

    streamed = "";
    try {
      const reply = await Bridge.chatSend(query, context, State.chatEngine);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      streamed = "";
      streamEl = null;
      renderedCount = -1;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  /** Forgets the conversation and whatever it was about (file, copied text). */
  function startOver() {
    if (sending) return;
    if (historyMenu.style.display !== "none") showHistory(false);
    State.chatHistory = [];
    State.droppedFile = null;
    State.chatText = null;
    State.promptContext = null;
    // An engine picked in the menu was for that conversation only.
    State.chatEngineOverride = null;
    void Bridge.chatReset();
    Sound.play("blip");
    State.notify();
    onHeightChange();
    input.value = "";
    input.focus();
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
    historyBtn.classList.toggle("on", open);
    State.notify();
    onHeightChange();
  }

  async function toggleHistory() {
    engineMenu.style.display = "none";
    if (historyMenu.style.display !== "none") {
      showHistory(false);
      return;
    }
    const list = (await Bridge.chatHistoryList()) ?? historyDemo;
    clear(historyMenu);
    if (!list.length) {
      historyMenu.append(h("div", { class: "engine-note", text: State.settings.chatHistory === false
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
      const row = h("div", { class: "history-item", title: c.title, onclick: () => void reopen(c.id) },
        h("div", { class: "history-text" },
          h("span", { class: "history-title", text: c.title }),
          h("span", { class: "history-meta", text: `${when(c.updated)} · ${engine} · ${tn("{n} domanda", "{n} domande", c.turns)}` })),
        del);
      historyMenu.append(row);
    }
    showHistory(true);
  }

  /** The conversation comes back in place of the current one, on its engine. */
  async function reopen(id: string) {
    if (sending) return;
    try {
      const c = await Bridge.chatHistoryOpen(id);
      State.chatHistory = c.lines.map((l) => ({ id: nextId++, role: l.role, content: l.content }));
      State.droppedFile = null;
      State.chatText = null;
      State.promptContext = null;
      State.chatEngineOverride = c.engine === State.settings.chatEngine ? null : (c.engine as ChatEngine);
      renderedCount = -1;
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
  // Drawn in the island (a native <select> menu would open behind it); a click elsewhere closes it.
  document.addEventListener("pointerdown", (e) => {
    if (engineMenu.style.display !== "none" && !head.contains(e.target as Node)) engineMenu.style.display = "none";
  });
  void onEvent<{ text: string }>("chat-stream", (p) => {
    if (!sending) return;
    streamed = p.text;
    State.notify();
  });

  externalSend = (q) => void submit(q);
  fresh.addEventListener("click", startOver);
  send.addEventListener("click", () => void submit());
  input.addEventListener("input", () => {
    updateCalc();
    onHeightChange();
  });
  input.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (k.key === "Enter") {
      e.preventDefault();
      // A calculation: Enter copies the result, Ctrl+Enter still asks Claude.
      if (calcResult != null && !k.ctrlKey) void copyCalc();
      else void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const text = State.chatText;
      const wantChip = text
        ? `${text.label} · ${t("{n} caratteri", { n: text.text.length.toLocaleString(locale()) })}`
        : file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      engineBtn.textContent = `${engineLabel({ ...State.settings, chatEngine: State.chatEngine })} ▾`;
      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0) + (streamed ? 0.25 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        streamEl = null;
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking && streamed) {
          streamEl = h("div", { class: "chat-row" });
          log.append(streamEl);
        } else if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }
      // The growing reply: only its bubble is redrawn.
      if (streamEl && streamEl.dataset.len !== String(streamed.length)) {
        streamEl.dataset.len = String(streamed.length);
        streamEl.replaceChildren(bubble({ id: 0, role: "assistant", content: streamed }).firstChild!);
        log.scrollTop = log.scrollHeight;
      }

      if (State.chatDraft != null) {
        input.value = State.chatDraft;
        State.chatDraft = null;
        drafted = true;
        updateCalc();
      }
      if (State.chatInsert != null) {
        const before = input.value.trimEnd();
        input.value = `${before}${before ? " " : ""}${State.chatInsert} `;
        State.chatInsert = null;
        drafted = true;
        updateCalc();
      }
      input.placeholder = State.chatHistory.length === 0 ? t("Chiedimi qualsiasi cosa… o fai un calcolo") : t("Continua…");

      input.disabled = sending;
      // Only when there is something to forget.
      fresh.style.display = State.chatHistory.length > 0 || file || text ? "" : "none";
      (fresh as HTMLButtonElement).disabled = sending;
    },
    // The open history list makes the island as tall as it needs (up to its maximum).
    fitHeight() {
      if (historyMenu.style.display === "none") return 0;
      return 26 + head.offsetHeight + 12 + Math.min(historyMenu.scrollHeight, 380) + bar.offsetHeight + 8;
    },
    focus() {
      input.focus();
      // A drafted question keeps its text: the cursor goes after it.
      if (drafted) input.setSelectionRange(input.value.length, input.value.length);
      else input.select();
      drafted = false;
    },
  };
}
