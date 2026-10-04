// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { CHAT_ENGINES, State, engineLabel, type ChatEngine, type ChatMessage } from "../core/state";
import { calculate, formatResult, plainResult } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import type { ViewHost } from "./views";

let nextId = 1;

/** Set by the chat view: sends a message as if typed (used by quick actions). */
let externalSend: ((query: string) => void) | null = null;

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
  const engineBtn = h("button", { class: "engine-pick", title: "Cambia motore della chat" }) as HTMLButtonElement;
  const engineMenu = h("div", { class: "engine-menu" });
  engineMenu.style.display = "none";
  const head = h("div", { class: "chat-head" }, chipRow, engineBtn, engineMenu);
  const log = h("div", { class: "chat-log" });
  // A reply arriving (OpenAI-compatible engines stream it, openai.rs).
  let streamEl: HTMLElement | null = null;
  let streamed = "";
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Chiedimi qualsiasi cosa…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Invia" }, svg(ICONS.arrowUp, 14));
  const fresh = h("button", { class: "new-chat-btn", title: "Nuova chat (Ctrl+N)" }, svg(ICONS.plus, 12), h("span", { text: "Nuova chat" }));
  const bar = h("div", { class: "chat-bar" }, fresh, input, send);
  // The calculator: a calculation typed in the field shows its result here.
  const calcValue = h("b", { class: "calc-value" });
  const calcHint = h("span", { class: "calc-hint", text: "Invio copia · Ctrl+Invio chiede a Claude" });
  const calcRow = h("div", { class: "calc-row" }, h("span", { class: "calc-eq", text: "=" }), calcValue, calcHint);
  calcRow.style.display = "none";
  let calcResult: number | null = null;
  function updateCalc() {
    calcResult = calculate(input.value);
    calcRow.style.display = calcResult == null ? "none" : "";
    if (calcResult != null) {
      calcValue.textContent = formatResult(calcResult);
      calcHint.textContent = "Invio copia · Ctrl+Invio chiede a Claude";
      calcRow.classList.remove("copied");
    }
  }
  async function copyCalc() {
    if (calcResult == null) return;
    const text = plainResult(calcResult);
    try {
      await navigator.clipboard.writeText(text);
      calcHint.textContent = "Copiato negli appunti ✓";
      calcRow.classList.add("copied");
      Sound.play("finish");
    } catch {
      calcHint.textContent = "Copia non riuscita";
    }
  }

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, head, log, calcRow, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit(override?: string) {
    const query = (override ?? input.value).trim();
    if (!query || sending) return;
    if (override == null) {
      input.value = "";
      updateCalc();
    }
    sending = true;
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
      const reply = await Bridge.chatSend(query, context);
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
    State.chatHistory = [];
    State.droppedFile = null;
    State.chatText = null;
    State.promptContext = null;
    void Bridge.chatReset();
    Sound.play("blip");
    State.notify();
    onHeightChange();
    input.value = "";
    input.focus();
  }

  /** Engines worth offering: Claude Code always, the others once they have a key or a model. */
  async function readyEngines(): Promise<typeof CHAT_ENGINES> {
    const s = State.settings;
    const out: typeof CHAT_ENGINES = [];
    for (const e of CHAT_ENGINES) {
      if (e.id === s.chatEngine || e.id === "subscription") { out.push(e); continue; }
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
      const label = engineLabel({ ...State.settings, chatEngine: e.id });
      engineMenu.append(h("button", {
        class: `engine-item${e.id === State.settings.chatEngine ? " on" : ""}`, title: e.hint, text: label,
        onclick: () => pickEngine(e.id),
      }));
    }
    engineMenu.append(h("div", { class: "engine-note", text: "Chiavi, modelli e indirizzi: Impostazioni → Chat" }));
    engineMenu.style.display = "";
  }

  function pickEngine(id: ChatEngine) {
    engineMenu.style.display = "none";
    if (id === State.settings.chatEngine || sending) return;
    State.settings.chatEngine = id;
    void Bridge.saveSettings(State.settings);
    // Another engine is another conversation (the backend starts over too).
    if (State.chatHistory.length) startOver();
    else State.notify();
  }

  engineBtn.addEventListener("click", () => void toggleEngineMenu());
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
        ? `${text.label} · ${text.text.length.toLocaleString("it-IT")} caratteri`
        : file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      engineBtn.textContent = `${engineLabel(State.settings)} ▾`;
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

      input.placeholder = State.chatHistory.length === 0 ? "Chiedimi qualsiasi cosa… o fai un calcolo" : "Continua…";
      input.disabled = sending;
      // Only when there is something to forget.
      fresh.style.display = State.chatHistory.length > 0 || file || text ? "" : "none";
      (fresh as HTMLButtonElement).disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
