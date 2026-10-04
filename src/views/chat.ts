// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
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
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Chiedimi qualsiasi cosa…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Invia" }, svg(ICONS.arrowUp, 14));
  const fresh = h("button", { class: "new-chat-btn", title: "Nuova chat" }, svg(ICONS.plus, 12), h("span", { text: "Nuova chat" }));
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
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, calcRow, bar)),
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

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
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
