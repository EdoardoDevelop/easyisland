import type { Notice } from "../core/state";
// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { isSorting, sortable } from "./sortable";
import { h, svg, clear, dot, brandOrDot, markIcon } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, canAskSession, canOpen, engineLabel, isSessionTask, replyMode, sessionOpenLabel, type AgentTask, type AskQuestion } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { buildPrompt } from "./chat";
import { buildChoose, buildFiles, buildUnzip, buildUpload, buildUploading } from "./upload";
import { buildDiff } from "./diff";
import { buildRecap } from "./recap";
import { buildMoment, type MomentActions } from "./moment";
import { buildDaily } from "./daily";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { buildActions, buildRun, type ActionHandlers } from "./actions";
import { buildRewrite, type RewriteHandlers } from "./rewrite";
import { planSummary, planText } from "../island/plan";
import { permissionModeLabel } from "../island/hooks";
import { renderMarkdown } from "../core/markdown";
import { Bridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { softphoneVersion } from "../core/softphone";
import { THREECX } from "./threecx";
import { t } from "../core/i18n";

export interface ViewActions extends ActionHandlers, RewriteHandlers, MomentActions {
  setView(v: IslandViewName): void;
  /** The tray ("Vassoio"): the files dropped since EasyIsland started. */
  openFiles(): void;
  /** "Annulla" on a dropped file: forget it and go back. */
  cancelDrop(): void;
  refreshFiles(): void;
  askAboutFile(f: { name: string; path: string }): void;
  /** "Riquadra e chiedi": circle a zone of the screen and ask about it (capture.ts). */
  captureScreen(): void;
  /** A picture saved in the inbox (screenshot, clipboard): open the chat with it attached. */
  askAboutPicture(f: { name: string; path: string }): void;
  /** Text from an integration (a Notion page) attached to a new chat, waiting for the question. */
  askAboutText(label: string, text: string): void;
  /** A fresh chat, nothing in it (Accesso remoto's "Apri la chat"). */
  openChat(): void;
  /** A new chat with this question sent (an integration's "chiedi alla chat"). */
  askChat(question: string): void;
  /** A notice on the island (an integration's alert or action). */
  showNotice(n: Notice): void;
  /** "Estrai…" on a dropped ZIP: "beside" | "downloads" | "desktop". */
  extractZip(place: string): void;
  /** 📌: keep the island open (no auto-close). */
  toggleKeepOpen(): void;
  /** ▢ of the island as an app: full screen on or off. */
  toggleMaximized(): void;
  collapse(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  /** "always": allow and save the rule Claude Code proposed (ApprovalInfo.always). */
  decide(d: "allow" | "deny" | "always"): void;
  /** AskUserQuestion answered from the island: question → chosen label(s). */
  answerQuestions(answers: Record<string, string>): void;
  /** Leave the pending request to the terminal (Claude Code asks there). */
  handToTerminal(): void;
  /** Esc or "Più tardi" on a permission or a question: fold the island, the request keeps waiting. */
  foldCard(): void;
  /** Something is being written in a card: the island does not close on its own meanwhile. */
  holdOpen(on: boolean): void;
  /** "Chiedi a questa sessione": the chat asks a read-only copy of the focused session. */
  askSession(): void;
  /** The ✕: closes now, handing any pending request back to the terminal. */
  dismiss(): void;
  toggleSound(): void;
  openSettingsWindow(): void;
  blip(): void;
  /** A proposal from the habits: Crea / Non ora / No, mai. */
  answerSuggestion(fp: string, choice: "create" | "snooze" | "dismiss"): void;
  /** "Installa" on the update notice. */
  installUpdate(): void;
  /** Pills dragged into a new order (ids of the ones dragged among). */
  reorder(ids: string[]): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
  /**
   * Natural height of the view's content in px (the area under the header).
   * When it does not fit the view's default height the island grows, up to
   * MAX_ISLAND_H; views without it keep their fixed height.
   */
  fitHeight?(): number;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  // The key shown on the button also presses it (onIslandKey in island.ts).
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick, ...(kbd ? { "data-key": kbd.toLowerCase() } : {}) },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px max(16px, calc(${padLeft}px * var(--bot-room, 1)))`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

const USAGE_ID = "integration_claude_usage";

/**
 * The plan's windows for the header (usage.rs PlanGauge), or null when the
 * card is off, has no plan yet, or the user keeps it in the card only.
 */
function planGauge(): { key: string; parts: HTMLElement[]; title: string } | null {
  if (!State.settings.activeIntegrations.includes(USAGE_ID) || State.settings.integrationConfig.planInHeader === false) return null;
  const status = State.widgetStatus[USAGE_ID];
  const plan = status?.plan;
  if (!plan) return null;
  const now = Date.now() / 1000;
  const windows: [string, [number, number] | undefined][] = [[t("5h"), plan.fiveHour], [t("7g"), plan.sevenDay]];
  const shown = windows.flatMap(([label, w]) => {
    if (!w) return [];
    const pct = Math.round(w[1] <= now ? 0 : w[0]);
    return [{ label, pct }];
  });
  if (!shown.length) return null;
  // Past 15 minutes the numbers are old (as the card's "Piano aggiornato"): grey.
  const stale = plan.at != null && now - plan.at >= 15 * 60;
  const level = (p: number) => (stale ? "stale" : p >= 100 ? "full" : p >= 80 ? "warn" : "");
  const parts = shown.map(({ label, pct }) =>
    h("span", { class: `pg ${level(pct)}`, style: `--p:${Math.min(100, pct)}%` },
      h("b", { text: label }), h("span", { text: `${pct}%` })));
  // The card's own lines ("Piano · 5 ore: 12% · si azzera tra 2 h 10"), as the tooltip;
  // "Piano aggiornato" (how old, and why) first when the numbers are old.
  const lines = (status.fields ?? []).filter((f) => f.label.startsWith(t("Piano"))).map((f) => `${f.label}: ${f.value}`);
  if (stale) lines.sort((a, b) => Number(b.startsWith(t("Piano aggiornato"))) - Number(a.startsWith(t("Piano aggiornato"))));
  return { key: `${stale}|` + shown.map((s) => `${s.label}${s.pct}`).join("|") + lines.join("|"), parts, title: [t("Piano Claude"), ...lines].join("\n") };
}

/**
 * What the character says in the top bar: the request waiting, the session at
 * work or the card on screen; on Panoramica, what needs looking at. Two short lines.
 */
function bubble(): [string, string] {
  const req = State.pendingApproval;
  const task = State.focusTask;
  if (req) {
    const who = req.source === "chat" ? t("La chat") : task?.name ?? t("Un agente");
    return [req.questions?.length ? t("{who} ha una domanda", { who }) : t("{who} chiede un permesso", { who }), req.command || req.tool || ""];
  }
  switch (State.view) {
    case "prompt": return [t("Chiedimi pure."), `Chat · ${engineLabel(State.settings)}`];
    case "actions": case "run": case "rewrite": return [t("Le tue azioni."), t("anche sul testo selezionato nell'app in primo piano")];
    case "files": case "unzip": return [t("File e schermo."), t("Rilascia un file sull'isola o riquadra una zona")];
    case "upload": case "choose": return [t("Rilascia qui un file."), t("Ti chiedo cosa farne")];
  }
  if (State.showsSummary) {
    const news = State.tasks.filter((x) => x.pillBadge);
    const busy = State.sessionTasks.filter((x) => x.state !== "idle" && x.state !== "sleeping" && x.state !== "finished");
    const first = news.length === 1 ? t("Novità da {name}.", { name: news[0].name })
      : news.length > 1 ? t("{n} integrazioni hanno novità.", { n: news.length }) : t("Tutto tranquillo.");
    const second = busy.length === 1 ? t("{name} sta lavorando", { name: busy[0].name })
      : busy.length > 1 ? t("{n} sessioni al lavoro", { n: busy.length }) : "";
    return [first, second];
  }
  if (!task) return [t("Tutto tranquillo."), ""];
  const last = task.steps.at(-1) ?? "";
  return [task.agentName ? `${task.name} · ${task.agentName}` : task.name, last];
}

export function buildHeader(actions: ViewActions): ViewHost & { field: HTMLElement } {
  const pinBtn = h("button", { title: t("Tieni aperta"), style: "--c:#A78BFA", onclick: () => {
    actions.blip();
    actions.toggleKeepOpen();
  } }, svg(ICONS.pin, 15));
  // Impostazioni open in their own window, never inside the island.
  const gearBtn = h("button", { title: t("Impostazioni"), style: "--c:#94A3B8", onclick: () => {
    actions.blip();
    actions.openSettingsWindow();
  } }, svg(ICONS.sliders, 16));
  // The memory map (src/memory), a click away instead of Impostazioni → Chat → Memoria.
  const memBtn = h("button", { title: t("Mappa della memoria"), style: "--c:#34D399", onclick: () => {
    actions.blip();
    void Bridge.memoryWindowOpen();
  } }, svg(ICONS.memory, 16, { stroke: 1.8 }));
  const soundBtn = h("button", { title: t("Silenzia"), style: "--c:#22D3EE", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 16));
  const closeBtn = h("button", { title: t("Chiudi"), style: "--c:#F4505E", onclick: () => actions.dismiss() }, svg(ICONS.xmark, 14));
  // The island as an app: — and ▢ like a window's.
  const minBtn = h("button", { title: t("Riduci a icona"), style: "--c:#94A3B8", onclick: () => void Bridge.minimizeIsland() }, svg(ICONS.minimize, 14));
  const maxBtn = h("button", { title: t("Schermo intero"), style: "--c:#94A3B8", onclick: () => actions.toggleMaximized() }, svg(ICONS.maximize, 14));
  let maxShown: boolean | null = null;
  // Claude's plan (Consumo Claude): "5h 12%  7g 83%", a click opens the card.
  const planBtn = h("button", { class: "plan-gauge", onclick: () => {
    actions.blip();
    State.setFocus(USAGE_ID);
    actions.setView("overview");
  } });
  let planKey = "";

  // The character's bubble (Impostazioni → Posizione e aspetto → Fumetto), and
  // the place of the one field (search.ts, put here by island.ts).
  const say = h("span", { class: "say-1" });
  const sayMore = h("span", { class: "say-2" });
  const talk = h("div", { class: "say" }, say, sayMore);
  const field = h("div", { class: "header-field" });

  const el = h(
    "div",
    { id: "header" },
    talk,
    field,
    h("div", { class: "header-actions" }, planBtn, pinBtn, memBtn, gearBtn, soundBtn, minBtn, maxBtn, closeBtn),
  );

  return {
    el,
    field,
    sync() {
      const v = State.view;
      const [a, b] = bubble();
      if (say.textContent !== a) say.textContent = a;
      if (sayMore.textContent !== b) sayMore.textContent = b;
      talk.style.display = State.settings.characterBubble === false ? "none" : "";
      talk.title = b ? `${a}
${b}` : a;
      pinBtn.classList.toggle("on", State.keepOpen);
      pinBtn.classList.toggle("pinned", State.keepOpen);
      pinBtn.title = State.keepOpen ? t("Resta aperta: clic per lasciarla chiudere da sola (Ctrl+P)") : t("Tieni aperta (Ctrl+P)");
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 16));
      soundBtn.style.setProperty("--c", State.settings.soundEnabled ? "#22D3EE" : "#F4505E");
      el.style.opacity = v === "confused" ? "0" : "1";
      closeBtn.style.display = State.settings.closeButton ? "" : "none";
      minBtn.style.display = State.appWindow ? "" : "none";
      maxBtn.style.display = State.appWindow ? "" : "none";
      if (maxShown !== State.maximized) {
        maxShown = State.maximized;
        maxBtn.replaceChildren(svg(State.maximized ? ICONS.restore : ICONS.maximize, 14));
        maxBtn.title = State.maximized ? t("Esci da schermo intero") : t("Schermo intero");
      }
      const plan = planGauge();
      planBtn.style.display = plan ? "" : "none";
      if (plan && plan.key !== planKey) {
        planKey = plan.key;
        planBtn.replaceChildren(...plan.parts);
        planBtn.title = plan.title;
      }
      closeBtn.title = State.pendingApproval ? t("Chiudi: rispondi nel terminale") : t("Chiudi (Esc)");
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

/** Opens the diff view on `file` (a full path from State.diffs). */
function openDiff(actions: ViewActions, file: string) {
  State.diffFile = file;
  State.diffTask = State.focusTask?.id ?? null;
  actions.setView("diff");
}

/** "a.ts": the last part of a Windows or POSIX path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function buildOverview(actions: ViewActions): ViewHost {
  // A step with a diff ("Modifica · a.ts +12 −3"): its file's newest edit.
  const ticker = new Ticker((text) => {
    const name = text.replace(/\s+\+\d+ −\d+$/, "").split(" · ").pop() ?? "";
    const d = [...State.diffs].reverse().find((x) => x.task === State.focusId && baseName(x.file) === name);
    if (d) openDiff(actions, d.file);
  });
  const who = h("div", { class: "who" });
  // The session's edited files, newest first: a click opens the diff.
  const files = h("div", { class: "diff-files" });
  let filesKey = "";
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el, files);
  const leftBody = h("div", { class: "left-body" });
  // Agenti: one chip per agent with a session, to switch between them.
  const agentBar = h("div", { class: "agent-switch" });
  let agentBarKey = "";
  const jump = h(
    "button",
    { class: "icon-btn jump", title: t("Apri"), onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 12),
  );
  // A side question to the session on screen, answered by a read-only copy of it.
  const askJump = h(
    "button",
    { class: "icon-btn jump ask-jump", title: t("Chiedi a questa sessione"), onclick: () => actions.askSession() },
    svg(ICONS.bubble, 12),
  );
  const left = card("indigo", agentBar, leftBody, jump, askJump);
  // One card: the menu on the left (rail.ts) lists the integrations.
  const el = h("div", { class: "view overview solo" }, h("div", { class: "left" }, left));

  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
    askAboutPicture: (f) => actions.askAboutPicture(f),
    askAboutText: (label, text) => actions.askAboutText(label, text),
    openChat: () => actions.openChat(),
    askChat: (q) => actions.askChat(q),
    runQuick: (id) => {
      const a = (State.settings.actions ?? []).find((x) => x.id === id);
      if (a) actions.runAction(a);
    },
    holdOpen: (on) => actions.holdOpen(on),
    showNotice: (n) => actions.showNotice(n),
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      // The glow at the bottom, as in the chat: the tab's own colour.
      left.style.setProperty("--wash", task && !showsSummary()
        ? `color-mix(in srgb, ${task.color} 45%, transparent)` : washRGBA("indigo"));
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // Agenti: a chip per agent that has been heard from (the tab's own agent
      // always), when there is more than one to choose from.
      const home = State.homeAgentId;
      const agents = isSessionTask(task) && !showsSummary()
        ? State.sessionTasks.filter((t) => t.id === home || t.lastActive)
        : [];
      const barKey = agents.length > 1 ? agents.map((t) => `${t.id}:${t.state}:${t.id === task?.id}`).join("|") : "";
      if (barKey !== agentBarKey) {
        agentBarKey = barKey;
        agentBar.replaceChildren(...(agents.length > 1 ? [...agents]
          // Always the same order, so a chip does not jump under the mouse.
          .sort((a, b) => (a.id === home ? -1 : b.id === home ? 1 : a.id.localeCompare(b.id)))
          .map((t) => {
            const busy = t.state !== "idle" && t.state !== "sleeping" && t.state !== "finished";
            const chip = h("button", {
              class: t.id === task?.id ? "agent-chip on" : "agent-chip",
              title: t.lastActive ? `${t.agentName ?? "Claude Code"} · ${t.name}` : t.agentName ?? "Claude Code",
              onclick: () => actions.setFocus(t.id),
            }, brandOrDot(t.id, t.color, 7), h("span", { text: t.agentName ?? "Claude Code" }));
            if (busy) chip.append(h("i", { class: "agent-busy" }));
            return chip;
          }) : []));
        agentBar.style.display = agents.length > 1 ? "" : "none";
      }

      // VS Code with a live Claude Code session keeps the ticker; every other
      // pill shows its own card, exactly like IntegrationCardView.
      const sessionActive = !showsSummary() &&
        isSessionTask(task) && (task!.state !== "idle" || task!.steps.length > 0);

      if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: task.agentName ?? (task.source === "claudeCode" ? "Claude Code" : "n8n") }),
        );
        // Plan mode, edits accepted on their own, no confirmations at all.
        const permMode = permissionModeLabel(task.permissionMode);
        if (permMode) who.append(h("span", { class: permMode.warn ? "mode-badge warn" : "mode-badge", text: permMode.text, title: permMode.tip }));
        // The agent's plan when it has one ("2/4", the list in the tooltip),
        // otherwise where the ticker is among the last steps.
        const plan = planSummary(task.plan);
        if (plan) {
          who.append(h("span", { class: "count plan", text: `${plan.done}/${plan.total}`, title: planText(task.plan) }));
        } else if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
        State.pruneDiffs();
        const list = State.diffFiles(task!.id);
        const key = list.map((f) => `${f.file}:${f.added}:${f.removed}`).join("|");
        if (key !== filesKey) {
          filesKey = key;
          // One summary: the card is narrow, the diff view has a tab per file.
          const added = list.reduce((s, f) => s + f.added, 0);
          const removed = list.reduce((s, f) => s + f.removed, 0);
          const label = list.length === 1 ? baseName(list[0].file) : `${list.length} file`;
          files.replaceChildren(...(list.length ? [h("button", {
            class: "diff-file", title: `Modifiche: ${list.map((f) => baseName(f.file)).join(", ")}`,
            onclick: () => openDiff(actions, list[0].file),
          },
          h("span", { class: "diff-name", text: label }),
          h("span", { class: "diff-add", text: `+${added}` }),
          h("span", { class: "diff-del", text: `−${removed}` }))] : []));
          files.style.display = list.length ? "" : "none";
        }
      } else if (showsSummary()) {
        const key = "summary~" + State.tasks.map((t) => `${t.id}:${t.state}:${t.pillBadge ?? ""}:${pillLabel(t).text}:${t.steps.join("|")}`).join("~");
        const grid = leftBody.querySelector<HTMLElement>(".summary");
        const sorting = !!grid && isSorting(grid);
        if (key !== cardKey && !sorting) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderSummary(actions));
        }
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          // A Notion page open in the card redraws itself (notionpage.ts): not rebuilt while typing.
          task.id === "integration_notion" && detailOpen ? "page" : JSON.stringify(info?.data ?? {}),
          JSON.stringify(State.widgetStatus[task.id.replace(/^widget:/, "")] ?? null),
          task.id === THREECX ? softphoneVersion() : 0,
          // An integration of the user's: redrawn when it or its records change elsewhere.
          task.id.startsWith("custom:") ? State.customVersion : 0,
          // The header's bell and speaker change only a setting.
          task.id === THREECX ? `${State.settings.integrationConfig?.threecxAlert}${State.settings.integrationConfig?.threecxRing}` : "",
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(safeCard(task, hooks));
        }
      }

      jump.style.display = detailOpen || showsSummary() || !canOpen(task) ? "none" : "";
      askJump.style.display = mode === "ticker" && !showsSummary() && canAskSession(task) ? "" : "none";

    },
    fitHeight() {
      // The left card's content (it flows from the top), plus a bottom margin…
      const content = leftBody.firstElementChild as HTMLElement | null;
      return (content ? content.offsetHeight + 12 : 0) + (agentBar.style.display === "none" ? 0 : agentBar.offsetHeight);
    },
  };
}

/**
 * An integration's card, or a plain one saying it cannot be shown when its
 * data trips the card up: the error is logged and the rest of the island
 * keeps working (another card, the menu, the next update of the same one).
 */
function safeCard(task: AgentTask, hooks: IntegrationCardHooks): HTMLElement {
  try {
    return renderIntegrationCard(task, hooks);
  } catch (e) {
    void Bridge.log(`card ${task.id}: ${(e as Error)?.stack ?? e}`).catch(() => {});
    console.error(e);
    return h("div", { class: "int-card" },
      h("div", { class: "int-head" }, dot(task.color, 7), h("b", { text: task.name })),
      h("div", { class: "int-status wrap" }, h("span", { text: t("Questa scheda non si può mostrare: i dati ricevuti non sono nel formato atteso. Riprovo al prossimo aggiornamento.") })),
      h("div", { class: "int-actions" },
        h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: () => hooks.openSettings() })));
  }
}

/** The ⌂ tab shows the summary, unless a permission or a question is waiting. */
function showsSummary(): boolean {
  return State.showsSummary;
}

/** Panoramica: a tile per integration (and agent) with its latest line; a click opens its card. */
function renderSummary(actions: ViewActions): HTMLElement {
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const head = h("div", { class: "today-head" }, h("span", { class: "today-title", text: t("Panoramica") }), h("span", { class: "today-date", text: date }));
  const grid = h("div", { class: "summary" });
  for (const t of State.tasks) {
    // Registra lives in File e schermo.
    if (t.id === "integration_recorder") continue;
    const label = pillLabel(t);
    const status = t.steps.length ? t.steps[t.steps.length - 1] : t.state === "idle" ? "" : t.state;
    const row = h("button", { class: "summary-row", "data-id": t.id, title: label.title ?? t.name, onclick: () => actions.setFocus(t.id) },
      // The logo, large and half hidden in the bottom-left corner; a circle of
      // the integration's colour for those without one.
      h("span", { class: "summary-mark", "aria-hidden": "true" }, markIcon(t.id, 52) ?? h("i", { class: "summary-circle" })),
      h("span", { class: "summary-top" },
        h("span", { class: "summary-name", text: label.text }),
        t.pillBadge ? h("i", { class: "summary-badge" }) : null),
      h("span", { class: "summary-status", text: status || " " }));
    row.style.setProperty("--c", t.color);
    if (t.pillBadge) row.classList.add(`badge-${t.pillBadge}`);
    grid.append(row);
  }
  if (!State.tasks.length) grid.append(h("span", { class: "hint", text: t("Nessuna integrazione attiva") }));
  // Dragged into the order the user wants: the same order as the menu.
  sortable(grid, { enabled: () => !State.settings.lockOrder, onReorder: (ids) => actions.reorder(ids) });
  return h("div", { class: "today" }, head, grid);
}

/** The pill's text: the song for Musica (name and artist in the tooltip), the name otherwise. */
function pillLabel(task: AgentTask): { text: string; title?: string; song?: boolean } {
    if (task.agentName) return { text: task.agentName, title: task.name };
  if (task.id === "integration_media") {
    const d = (State.integrations[task.id]?.data ?? {}) as Record<string, unknown>;
    if (d.active && typeof d.title === "string" && d.title) {
      const artist = typeof d.artist === "string" && d.artist ? ` — ${d.artist}` : "";
      return { text: d.title, title: `${d.playing ? "In riproduzione" : "In pausa"}: ${d.title}${artist}`, song: true };
    }
  }
  return { text: task.name };
}


// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 max(16px, calc(118px * var(--bot-room, 1)));flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: t("Nulla in esecuzione al momento.") }),
      h("div", { class: "sub", text: t("Trascina un file o chiedimi qualsiasi cosa.") }),
    ),
    h("div", { class: "grow" }),
    btn(t("Chiedi alla chat"), "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

/**
 * How long a permission or a question still waits for a click here ("1:32"):
 * after that the relay gives up and the terminal (or, for the chat, a refusal)
 * takes over. Written only when the second changes.
 */
function waitLeft(el: HTMLElement) {
  const req = State.pendingApproval;
  const ms = req?.deadline != null ? req.deadline - Date.now() : null;
  const text = ms == null ? "" : (() => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return t("attende ancora {t}", { t: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` });
  })();
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.toggle("soon", ms != null && ms < 20_000);
  el.title = req?.source === "chat"
    ? t("Poi la chiamata al connettore viene rifiutata")
    : t("Poi si risponde solo nel terminale; l'agente intanto resta fermo");
}

/** Keeps waitLeft ticking once a second while a request waits; stops by itself. */
function waitTimer(el: HTMLElement): () => void {
  let timer = 0;
  return () => {
    waitLeft(el);
    if (timer || State.pendingApproval?.deadline == null) return;
    timer = window.setInterval(() => {
      if (!State.pendingApproval) {
        window.clearInterval(timer);
        timer = 0;
      }
      waitLeft(el);
    }, 1000);
  };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  // What "Sempre" saves, said before the click (Claude Code's own proposal).
  const always = h("div", { class: "always-hint" });
  // A command that deletes, force-pushes, publishes… said in words (island/risk.ts).
  const risk = h("div", { class: "risk-hint" });
  // ExitPlanMode: the plan, rendered, scrolling inside the card.
  const plan = h("div", { class: "plan-box md" });
  let planShown = "";
  const row = h("div", { class: "actions" });
  const left = h("span", { class: "wait-left" });
  const showLeft = waitTimer(left);
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, risk, code, plan, always, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      showLeft();
      clear(who);
      if (State.pendingApproval?.source === "chat") {
        who.append(h("div", { class: "who-row" },
          h("span", { class: "n", text: t("La chat") }),
          h("span", { text: t("vuole usare un connettore") })));
      } else {
        const task = State.focusTask;
        const asks = State.pendingApproval?.plan ? t("ha un piano pronto") : t("chiede un permesso");
        who.append(agentWho(task, task?.agentName ? `· ${task.agentName} ${asks}` : asks));
      }
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      const planText = State.pendingApproval?.plan ?? "";
      if (planText !== planShown) {
        planShown = planText;
        plan.replaceChildren(...(planText ? renderMarkdown(planText, { openUrl: (u) => void Bridge.openUrl(u) }) : []));
        plan.scrollTop = 0;
      }
      plan.style.display = planText ? "" : "none";
      const risks = State.pendingApproval?.risks ?? [];
      risk.textContent = risks.map((r) => `⚠ ${r}`).join("\n");
      risk.style.display = risks.length ? "" : "none";
      // A chat's card has "Sempre" only when its engine offered it (opencode, read-only commands).
      const rule = State.pendingApproval?.always;
      always.textContent = rule ? t("Sempre: {rule}", { rule }) : "";
      always.style.display = rule ? "" : "none";
      // Rebuilt only when a request with or without "Sempre" comes in: rebuilding
      // between a mouse-down and a mouse-up would swallow the click.
      const key = rule ? "always" : "plain";
      if (rowKey === key) return;
      rowKey = key;
      clear(row);
      row.append(btn(t("Nega"), "secondary", () => actions.decide("deny"), "N"));
      if (rule) {
        const b = btn(t("Sempre"), "secondary", () => actions.decide("always"), "S");
        b.title = t("Consenti e non chiedere più per quanto scritto sopra");
        row.append(b);
      }
      row.append(btn(t("Consenti"), "primary", () => actions.decide("allow"), "Y"));
      // Not now: the island folds, the request keeps waiting and comes back on opening.
      const later = h("button", { class: "link-btn later-btn", text: t("Più tardi"), onclick: () => actions.foldCard() });
      later.title = t("Riduci l'isola senza rispondere (Esc): la richiesta resta in attesa");
      row.append(later, left);
    },
    // The "Sempre" line can wrap: grow rather than slide under the buttons.
    fitHeight: () => who.offsetHeight + risk.offsetHeight + code.offsetHeight + plan.offsetHeight + always.offsetHeight
      + row.offsetHeight + (3 + (risk.offsetHeight ? 1 : 0) + (plan.offsetHeight ? 1 : 0)) * 5 + 8 + 20,
  };
}

// ── AskUserQuestion ───────────────────────────────────────────────────────────

/**
 * Claude Code's multiple-choice questions, one at a time. Single choice answers
 * on the click; multiple choice toggles and then "Avanti". The terminal stays
 * available for anything the buttons cannot say (a free-text answer).
 */
function buildAsk(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title ask-q" });
  const options = h("div", { class: "ask-options" });
  const foot = h("div", { class: "ask-foot" });
  const left = h("span", { class: "wait-left" });
  const showLeft = waitTimer(left);
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, options, foot)));

  let key = "";
  let index = 0;
  let answers: Record<string, string> = {};
  let picked = new Set<string>();

  function next(q: AskQuestion, value: string) {
    answers[q.question] = value;
    const all = State.pendingApproval?.questions ?? [];
    picked = new Set();
    if (index + 1 < all.length) {
      index += 1;
      key = ""; // redraw for the next question
      State.notify();
      return;
    }
    actions.answerQuestions(answers);
  }

  return {
    el,
    sync() {
      showLeft();
      const req = State.pendingApproval;
      const all = req?.questions ?? [];
      const id = req?.requestId ?? "";
      // A new request starts again from the first question.
      if (key.split("|")[0] !== id) {
        index = 0;
        answers = {};
        picked = new Set();
      }
      const want = `${id}|${index}`;
      if (key === want) return;
      key = want;
      const q = all[index];
      clear(who);
      clear(options);
      clear(foot);
      if (!q) return;
      who.append(agentWho(State.focusTask,
        all.length > 1 ? t("ha {n} domande · {i} di {n}", { n: all.length, i: index + 1 }) : t("ha una domanda")));
      title.textContent = q.question;
      q.options.forEach((o, i) => {
        // 1–9 pick the option from the keyboard (onIslandKey in island.ts).
        const b = h("button", { class: "ask-opt", title: o.description, text: o.label,
          ...(i < 9 ? { "data-key": String(i + 1) } : {}) });
        b.addEventListener("click", () => {
          if (!q.multiSelect) return next(q, o.label);
          if (picked.has(o.label)) picked.delete(o.label);
          else picked.add(o.label);
          b.classList.toggle("on", picked.has(o.label));
          go.disabled = picked.size === 0;
        });
        options.append(b);
      });
      const go = h("button", { class: "btn primary ask-go", "data-key": "Enter",
        text: index + 1 < all.length ? t("Avanti") : t("Invia") }) as HTMLButtonElement;
      go.disabled = true;
      go.addEventListener("click", () => {
        if (picked.size) next(q, q.options.map((o) => o.label).filter((l) => picked.has(l)).join(", "));
      });
      // Anything the buttons cannot say: typed here, sent as the answer.
      const other = h("input", { class: "ask-other", type: "text", placeholder: t("Altro… scrivi la risposta e premi Invio") }) as HTMLInputElement;
      other.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
      other.addEventListener("focus", () => void Bridge.focusWindow(true));
      other.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const text = other.value.trim();
        if (!text) return;
        void Bridge.focusWindow(false);
        next(q, text);
      });
      options.append(other);
      // opencode asks in its own window too (opencode_agent.rs): the link brings it back.
      const inOpencode = State.focusTask?.sessionHost === "opencode";
      // A task of EasyIsland waits for the answer: later, from Impostazioni → Flussi.
      const inTask = State.focusTask?.sessionHost === "compiti";
      foot.append(h("button", { class: "link-btn", text: inTask ? t("Rispondi più tardi") : inOpencode ? t("Rispondi in opencode") : t("Rispondi nel terminale"), onclick: () => {
        if (inOpencode) actions.openTarget();
        actions.handToTerminal();
      } }));
      if (q.multiSelect) foot.append(go);
      foot.append(left);
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const open = btn(t("Apri terminale"), "primary", () => actions.openTerminal());
  const note = h("div", { class: "sub" });
  const row = h("div", { class: "actions" }, open, note);
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      const task = State.focusTask;
      // Gemini CLI asks its permissions in its own terminal: say who, and take you there.
      who.append(agentWho(task, task?.agentName ? t("{name} aspetta una risposta", { name: task.agentName }) : t("Claude Code ha una domanda")));
      title.textContent = task?.steps.at(-1) ?? t("Claude ha bisogno di una risposta.");
      (open.firstChild as HTMLElement).textContent = sessionOpenLabel(task?.sessionHost);
      note.textContent = t("Si risponde nel suo terminale.");
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: t("Workflow interrotto.") });
  const detail = h("div", { class: "detail" });
  // n8n opens its editor; a Claude Code session goes back to the app it runs in.
  const open = btn(t("Apri in n8n"), "secondary", () => {
    if (State.focusTask?.source === "n8n") actions.openUrl("");
    else actions.openTerminal();
  });
  const row = h("div", { class: "actions" },
    btn(t("Riprova"), "primary", () => actions.setView(State.defaultView())),
    open,
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, task?.source === "n8n" ? "n8n" : task?.agentName ?? "Claude Code"));
      title.textContent = task?.source === "n8n" ? t("Workflow interrotto.") : t("Sessione interrotta da un errore.");
      detail.textContent = task?.steps.at(-1) ?? t("Nessun dettaglio disponibile.");
      (open.firstChild as HTMLElement).textContent =
        task?.source === "n8n" ? t("Apri in n8n") : sessionOpenLabel(task?.sessionHost);
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  // Claude's last message, rendered as markdown and scrolling inside the card.
  const said = h("div", { class: "finished-md md" });
  let saidShown: string | null = null;
  const title = h("div", { class: "title" });

  // "Continua": the next message for the session, without leaving the island
  // (src-tauri/src/session_reply.rs). Shown only where the session can take it.
  const input = h("input", { class: "reply-input", type: "text" }) as HTMLInputElement;
  const send = h("button", { class: "btn primary reply-send", text: t("Invia") }) as HTMLButtonElement;
  const status = h("div", { class: "reply-status" });
  const reply = h("div", { class: "reply-row" }, input, send);
  let sending = false;
  async function submit() {
    const task = State.focusTask;
    const how = replyMode(task);
    const text = input.value.trim();
    if (!task || !how || !text || sending) return;
    sending = true;
    send.disabled = true;
    status.textContent = "";
    try {
      const got = await Bridge.sessionReply(how.mode, text, task.sessionPid?.pid ?? null, task.sessionId ?? null, how.scheme ?? null);
      input.value = "";
      actions.holdOpen(false);
      void Bridge.focusWindow(false);
      Sound.play("send");
      if (got === "prefilled") {
        status.textContent = t("Scritto in {app}: premi Invio lì per mandarlo.", { app: how.scheme === "cursor" ? "Cursor" : "VS Code" });
      } else {
        // The session works again: the card's job is done.
        actions.collapse();
      }
    } catch (err) {
      status.textContent = String(err).replace(/^Error:\s*/, "");
      Sound.play("error");
    } finally {
      sending = false;
      send.disabled = false;
    }
  }
  send.addEventListener("click", () => void submit());
  input.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  input.addEventListener("focus", () => void Bridge.focusWindow(true));
  // While something is being written, the island does not close on its own.
  input.addEventListener("input", () => actions.holdOpen(input.value.trim().length > 0));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
    // Esc and the card's letter keys stay with the field while typing.
    if (e.key !== "Escape") e.stopPropagation();
  });

  const open = btn(t("Apri terminale"), "primary", () => actions.openTerminal());
  const askBtn = btn(t("Chiedi"), "secondary", () => actions.askSession());
  (askBtn as HTMLElement).title = t("Una domanda a una copia della sessione, che intanto non viene toccata");
  const row = h("div", { class: "actions" },
    open,
    askBtn,
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, said, title, reply, status, row)));
  let lastTask: string | null = null;
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, `${task?.agentName ?? "Claude Code"} ha finito`));
      // Claude's last message when the relay found it, else the last step.
      const message = task?.lastMessage?.trim() || null;
      if (message !== saidShown) {
        saidShown = message;
        said.replaceChildren(...(message ? renderMarkdown(message, { openUrl: (u) => void Bridge.openUrl(u) }) : []));
        said.scrollTop = 0;
      }
      said.style.display = message ? "" : "none";
      title.textContent = message ? "" : task?.steps.at(-1) ?? t("Sessione terminata");
      title.style.display = message ? "none" : "";
      // A new session's card starts empty.
      if (task?.id !== lastTask) {
        lastTask = task?.id ?? null;
        input.value = "";
        status.textContent = "";
      }
      const how = replyMode(task);
      reply.style.display = how ? "" : "none";
      input.placeholder = how?.mode === "link"
        ? t("Continua… (si apre in {app}, poi premi Invio lì)", { app: how.scheme === "cursor" ? "Cursor" : "VS Code" })
        : t("Continua… scrivi il prossimo messaggio e premi Invio");
      status.style.display = status.textContent ? "" : "none";
      (askBtn as HTMLElement).style.display = canAskSession(task) ? "" : "none";
      // "Apri Claude", "Apri VS Code" or "Apri terminale": where the session runs.
      (open.firstChild as HTMLElement).textContent = sessionOpenLabel(task?.sessionHost);
    },
    // A long last message grows the card instead of sliding under the buttons:
    // the rows, the stack's gaps and padding, the card's margins.
    fitHeight: () => {
      const rows = [who, said, title, reply, status, row].filter((e) => e.offsetHeight > 0);
      return rows.reduce((s, e) => s + e.offsetHeight, 0) + (rows.length - 1) * 5 + 8 + 20;
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 max(16px, calc(128px * var(--bot-room, 1)))" },
    h("div", { class: "title", text: t("Troppi colpi tutti insieme.") }),
    h("div", { class: "sub", text: t("Dammi un attimo: torno al lavoro tra tre secondi.") }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 max(16px, calc(98px * var(--bot-room, 1)))" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── Notice (easyisland-hook notify) ───────────────────────────────────────────────

const NOTICE_WASH: Record<string, Wash> = { ok: "green", warn: "amber", error: "red", info: "indigo" };
const NOTICE_LABEL: Record<string, string> = { ok: t("fatto"), warn: t("attenzione"), error: t("errore"), info: t("notifica") };

/** A message from any script: `easyisland-hook notify "Titolo" "Testo" --stato ok`. */
function buildNotify(actions: ViewActions): ViewHost {
  const who = h("div", { class: "who-row" });
  const title = h("div", { class: "title" });
  const text = h("div", { class: "sub" });
  const row = h("div", { class: "actions" });
  const host = h("div", { class: "view" });
  let key = "";
  return {
    el: host,
    sync() {
      const n = State.notice;
      const k = n ? JSON.stringify(n) : "";
      if (k === key) return;
      key = k;
      clear(host);
      if (!n) return;
      clear(who);
      who.append(h("span", { class: "n", text: t("Notifica") }), h("span", { text: NOTICE_LABEL[n.level] ?? "" }));
      title.textContent = n.title || n.text;
      text.textContent = n.title ? n.text : "";
      clear(row);
      if (n.suggestion) {
        const fp = n.suggestion;
        who.firstChild!.textContent = t("Proposta");
        row.append(
          btn(n.suggestionAccept || t("Crea"), "primary", () => actions.answerSuggestion(fp, "create")),
          btn(t("Non ora"), "secondary", () => actions.answerSuggestion(fp, "snooze")),
          btn(t("No, mai"), "secondary", () => actions.answerSuggestion(fp, "dismiss")),
        );
      } else if (n.install) {
        // A new version: installed only with this click.
        row.append(
          btn(t("Installa"), "primary", () => actions.installUpdate()),
          btn(t("Più tardi"), "secondary", () => actions.collapse()),
        );
      } else {
        if (n.url) row.append(btn(t("Apri"), "primary", () => { actions.openUrl(n.url); actions.collapse(); }));
        row.append(btn("OK", n.url ? "secondary" : "primary", () => actions.collapse()));
      }
      host.append(card(NOTICE_WASH[n.level] ?? "indigo", stack(116, 16, who, title, text, row)));
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 max(16px, calc(118px * var(--bot-room, 1)))" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("ask", buildAsk(actions));
  map.set("question", buildQuestion(actions));
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("notify", buildNotify(actions));
  map.set("prompt", buildPrompt(onChatHeightChange, actions));
  map.set("upload", buildUpload(actions));
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  map.set("actions", buildActions(actions));
  map.set("run", buildRun(actions));
  map.set("rewrite", buildRewrite(actions));
  map.set("unzip", buildUnzip(actions));
  map.set("files", buildFiles(actions));
  map.set("diff", buildDiff(actions));
  map.set("recap", buildRecap(actions));
  map.set("moment", buildMoment(actions));
  map.set("daily", buildDaily(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder(t("L'invio via email non è disponibile in questa versione."), ""));
  map.set("searching", buildPlaceholder(t("Claude sta cercando…"), ""));
  map.set("result", buildPlaceholder(t("Risultato"), ""));
  return map;
}
