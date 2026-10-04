// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { isSorting, sortable } from "./sortable";
import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, sessionOpenLabel, type AgentTask, type AskQuestion } from "../core/state";
import { ISLAND_CHROME_H, MAX_ISLAND_H, washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../character/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildFiles, buildUnzip, buildUpload, buildUploading } from "./upload";
import { buildDiff } from "./diff";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { buildActions, buildRun, type ActionHandlers } from "./actions";

export interface ViewActions extends ActionHandlers {
  setView(v: IslandViewName): void;
  /** "File caricati": the history of dropped files. */
  openFiles(): void;
  refreshFiles(): void;
  askAboutFile(f: { name: string; path: string }): void;
  /** "Cattura una zona": snip a part of the screen and ask Claude about it. */
  captureScreen(): void;
  /** A picture saved in the inbox (screenshot, clipboard): open the chat with it attached. */
  askAboutPicture(f: { name: string; path: string }): void;
  /** "Estrai…" on a dropped ZIP: "beside" | "downloads" | "desktop". */
  extractZip(place: string): void;
  /** 📌: keep the island open (no auto-close). */
  toggleKeepOpen(): void;
  collapse(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  /** AskUserQuestion answered from the island: question → chosen label(s). */
  answerQuestions(answers: Record<string, string>): void;
  /** Leave the pending request to the terminal (Claude Code asks there). */
  handToTerminal(): void;
  /** The ✕: closes now, handing any pending request back to the terminal. */
  dismiss(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** A proposal from the habits: Crea / Non ora / No, mai. */
  answerSuggestion(fp: string, choice: "create" | "snooze" | "dismiss"): void;
  /** "Installa" on the update notice. */
  installUpdate(): void;
  /** Pills dragged into a new order (ids of the ones dragged among). */
  reorder(ids: string[]): void;
  /** The header's tabs (fixed and integrations) dragged into a new order. */
  reorderTabs(ids: string[]): void;
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
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
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
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", "data-id": "tab:home", title: "Panoramica", style: "--c:#38BDF8", onclick: () => {
    // Back from an integration tab: the overview's own card again.
    if (State.focusId && State.isTab(State.focusId)) {
      const first = State.tasks.find((t) => !State.isTab(t.id));
      if (first) State.setFocus(first.id);
    }
    go("overview");
  } }, svg(ICONS.house, 16));
  const tabChat = h("button", { class: "tab", "data-id": "tab:chat", title: "Chiedi", style: "--c:#A78BFA", onclick: () => go("prompt") }, svg(ICONS.bubble, 16));
  const tabDrop = h("button", { class: "tab", "data-id": "tab:drop", title: "Rilascia", style: "--c:#22C55E", onclick: () => go("upload") }, svg(ICONS.plus, 16));
  const tabActions = h("button", { class: "tab", "data-id": "tab:actions", title: "Azioni", style: "--c:#F5A524", onclick: () => go("actions") }, svg(ICONS.bolt, 16));
  const fixedTabs = [tabHome, tabChat, tabActions, tabDrop];

  const pinBtn = h("button", { title: "Tieni aperta", style: "--c:#A78BFA", onclick: () => {
    actions.blip();
    actions.toggleKeepOpen();
  } }, svg(ICONS.pin, 15));
  const gearBtn = h("button", { title: "Impostazioni", style: "--c:#94A3B8", onclick: () => go("settings") }, svg(ICONS.gear, 16));
  const soundBtn = h("button", { title: "Silenzia", style: "--c:#22D3EE", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 16));
  const closeBtn = h("button", { title: "Chiudi", style: "--c:#F4505E", onclick: () => actions.dismiss() }, svg(ICONS.xmark, 14));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  // One row: the fixed tabs and the integrations the user wants as tabs
  // (Impostazioni → Integrazioni), in the order dragged in the island.
  const tabsRow = h("div", { class: "tabs" }, ...fixedTabs);
  let tabsKey = "";
  let intTabs: HTMLElement[] = [];
  sortable(tabsRow, { enabled: () => !State.settings.lockOrder, onReorder: (ids) => actions.reorderTabs(ids) });

  const el = h(
    "div",
    { id: "header" },
    tabsRow,
    h("div", { class: "header-actions" }, pinBtn, gearBtn, soundBtn, closeBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      const overview = v === "overview" || v === "empty";
      const onTab = State.focusId != null && State.isTab(State.focusId);
      tabHome.classList.toggle("on", overview && !onTab);
      const tabs = State.tabTasks;
      const icons = State.settings.integrationTabIcons ?? {};
      const tabOrder = State.settings.tabOrder ?? [];
      const key = tabs.map((t) => `${t.id}:${t.name}:${t.color}:${icons[t.id] ?? ""}`).join("|") + `#${tabOrder.join("|")}`;
      if (key !== tabsKey && !isSorting(tabsRow)) {
        tabsKey = key;
        intTabs = [];
        for (const t of tabs) {
          const icon = icons[t.id]?.trim();
          intTabs.push(h("button", {
            class: icon ? "tab int-tab icon" : "tab int-tab", "data-id": t.id, title: t.name,
            onclick: () => {
              actions.blip();
              State.setFocus(t.id);
              actions.setView("overview");
            },
          }, icon ? h("span", { class: "int-tab-icon", text: icon }) : dot(t.color, 8),
            icon ? null : h("span", { text: t.name })));
        }
        // Dragged order first; the rest as usual: fixed tabs, then integrations.
        const all = [...fixedTabs, ...intTabs];
        const rank = (b: HTMLElement) => {
          const i = tabOrder.indexOf(b.dataset.id ?? "");
          return i >= 0 ? i : tabOrder.length + all.indexOf(b);
        };
        tabsRow.replaceChildren(...all.sort((a, b) => rank(a) - rank(b)));
      }
      for (const b of intTabs) {
        const t = tabs.find((x) => x.id === b.dataset.id);
        b.classList.toggle("on", overview && State.focusId === b.dataset.id);
        b.classList.toggle("badge", !!t?.pillBadge);
      }
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      tabActions.classList.toggle("on", v === "actions" || v === "run");
      gearBtn.classList.toggle("on", v === "settings");
      pinBtn.classList.toggle("on", State.keepOpen);
      pinBtn.classList.toggle("pinned", State.keepOpen);
      pinBtn.title = State.keepOpen ? "Resta aperta: clic per lasciarla chiudere da sola" : "Tieni aperta";
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 16));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 16));
      soundBtn.style.setProperty("--c", State.settings.soundEnabled ? "#22D3EE" : "#F4505E");
      el.style.opacity = v === "confused" ? "0" : "1";
      closeBtn.style.display = State.settings.closeButton ? "" : "none";
      closeBtn.title = State.pendingApproval ? "Chiudi: rispondi nel terminale" : "Chiudi (Esc)";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

/** Opens the diff view on `file` (a full path from State.diffs). */
function openDiff(actions: ViewActions, file: string) {
  State.diffFile = file;
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
    const d = [...State.diffs].reverse().find((x) => baseName(x.file) === name);
    if (d) openDiff(actions, d.file);
  });
  const who = h("div", { class: "who" });
  // The session's edited files, newest first: a click opens the diff.
  const files = h("div", { class: "diff-files" });
  let filesKey = "";
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el, files);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Apri", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 12),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  sortable(pills, { enabled: () => !State.settings.lockOrder, onReorder: (ids) => actions.reorder(ids) });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let pillCount = 0;
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
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // VS Code with a live Claude Code session keeps the ticker; every other
      // pill shows its own card, exactly like IntegrationCardView.
      const sessionActive =
        task?.id === "integration_claude" && (task.state !== "idle" || task.steps.length > 0);

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
          h("span", { class: "tool", text: task.source === "claudeCode" ? "Claude Code" : "n8n" }),
        );
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
        State.pruneDiffs();
        const list = State.diffFiles();
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
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
          JSON.stringify(State.widgetStatus[task.id.replace(/^widget:/, "")] ?? null),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen ? "none" : "";

      // Every pill is shown (the island grows to fit them); alerts go first.
      // An integration opened from its header tab stands alone: pills only on ⌂.
      const onTab = task != null && State.isTab(task.id);
      // In the user's order (dragged in the island): a pill with an alert keeps its place.
      const others = onTab ? [] : State.otherTasks;
      pillCount = others.length;
      const pillKey = others.map((t) => `${t.id}:${t.pillBadge ?? ""}:${pillLabel(t).title ?? pillLabel(t).text}`).join("|");
      if (pillKey !== pillIds && !isSorting(pills)) {
        pillIds = pillKey;
        clear(pills);
        for (const t of others) pills.append(buildPill(t, actions));
        pruneMiniBots();
      }
      // Every integration switched off: no empty box, the main card takes the room.
      el.classList.toggle("solo", others.length === 0);
    },
    fitHeight() {
      // The left card's content (it flows from the top), plus a bottom margin…
      const content = leftBody.firstElementChild as HTMLElement | null;
      const leftH = content ? content.offsetHeight + 12 : 0;
      // …and the pills, two per row.
      const rows = Math.ceil(pillCount / 2);
      const pillsH = rows > 0 ? rows * 28 + (rows - 1) * 4 + 16 : 0;
      // Only past the tallest island do the pills scroll.
      pills.classList.toggle("scroll", pillsH > MAX_ISLAND_H - ISLAND_CHROME_H);
      return Math.max(leftH, pillsH);
    },
  };
}

/** The pill's text: the song for Musica (name and artist in the tooltip), the name otherwise. */
function pillLabel(task: AgentTask): { text: string; title?: string; song?: boolean } {
  if (task.id === "integration_claude") return { text: "VS Code" };
  if (task.id === "integration_media") {
    const d = (State.integrations[task.id]?.data ?? {}) as Record<string, unknown>;
    if (d.active && typeof d.title === "string" && d.title) {
      const artist = typeof d.artist === "string" && d.artist ? ` — ${d.artist}` : "";
      return { text: d.title, title: `${d.playing ? "In riproduzione" : "In pausa"}: ${d.title}${artist}`, song: true };
    }
  }
  return { text: task.name };
}

function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = pillLabel(task);
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "div",
    { class: label.song ? "pill song" : "pill", "data-id": task.id, title: label.title ?? "",
      onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label.text }),
  );
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: "Nulla in esecuzione al momento." }),
      h("div", { class: "sub", text: "Trascina un file o chiedimi qualsiasi cosa." }),
    ),
    h("div", { class: "grow" }),
    btn("Chiedi a Claude", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, code, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      clear(who);
      if (State.pendingApproval?.source === "chat") {
        who.append(h("div", { class: "who-row" },
          h("span", { class: "n", text: "La chat" }),
          h("span", { text: "vuole usare un connettore" })));
      } else {
        who.append(agentWho(State.focusTask, "chiede un permesso"));
      }
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // Two buttons, built once. Rebuilding them between a mouse-down and a
      // mouse-up would swallow the click, and there is nothing left to vary:
      // "Always" is gone until the remembered-rules list exists to back it.
      if (rowKey === "built") return;
      rowKey = "built";
      clear(row);
      row.append(
        btn("Nega", "secondary", () => actions.decide("deny"), "N"),
        btn("Consenti", "primary", () => actions.decide("allow"), "Y"),
      );
    },
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
        all.length > 1 ? `ha ${all.length} domande · ${index + 1} di ${all.length}` : "ha una domanda"));
      title.textContent = q.question;
      for (const o of q.options) {
        const b = h("button", { class: "ask-opt", title: o.description, text: o.label });
        b.addEventListener("click", () => {
          if (!q.multiSelect) return next(q, o.label);
          if (picked.has(o.label)) picked.delete(o.label);
          else picked.add(o.label);
          b.classList.toggle("on", picked.has(o.label));
          go.disabled = picked.size === 0;
        });
        options.append(b);
      }
      const go = h("button", { class: "btn primary ask-go", text: index + 1 < all.length ? "Avanti" : "Invia" }) as HTMLButtonElement;
      go.disabled = true;
      go.addEventListener("click", () => {
        if (picked.size) next(q, q.options.map((o) => o.label).filter((l) => picked.has(l)).join(", "));
      });
      foot.append(h("button", { class: "link-btn", text: "Rispondi nel terminale", onclick: () => actions.handToTerminal() }));
      if (q.multiSelect) foot.append(go);
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code ha una domanda"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Claude ha bisogno di una risposta.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Rispondi nel terminale: EasyIsland non può ancora rispondere al posto tuo." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Workflow interrotto." });
  const detail = h("div", { class: "detail" });
  // n8n opens its editor; a Claude Code session goes back to the app it runs in.
  const open = btn("Apri in n8n", "secondary", () => {
    if (State.focusTask?.source === "n8n") actions.openUrl("");
    else actions.openTerminal();
  });
  const row = h("div", { class: "actions" },
    btn("Riprova", "primary", () => actions.setView(State.defaultView())),
    open,
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, task?.source === "n8n" ? "n8n" : "Claude Code"));
      title.textContent = task?.source === "n8n" ? "Workflow interrotto." : "Sessione interrotta da un errore.";
      detail.textContent = task?.steps.at(-1) ?? "Nessun dettaglio disponibile.";
      (open.firstChild as HTMLElement).textContent =
        task?.source === "n8n" ? "Apri in n8n" : sessionOpenLabel(task?.sessionHost);
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const open = btn("Apri terminale", "primary", () => actions.openTerminal());
  const row = h("div", { class: "actions" },
    open,
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code ha finito"));
      // Claude's last message when the relay found it, else the last step.
      const said = State.focusTask?.lastMessage;
      title.classList.toggle("last-msg", !!said);
      title.textContent = said ?? State.focusTask?.steps.at(-1) ?? "Sessione terminata";
      title.title = said ?? "";
      // "Apri Claude", "Apri VS Code" or "Apri terminale": where the session runs.
      (open.firstChild as HTMLElement).textContent = sessionOpenLabel(State.focusTask?.sessionHost);
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Troppi colpi tutti insieme." }),
    h("div", { class: "sub", text: "Dammi un attimo: torno al lavoro tra tre secondi." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── Notice (easyisland-hook notify) ───────────────────────────────────────────────

const NOTICE_WASH: Record<string, Wash> = { ok: "green", warn: "amber", error: "red", info: "indigo" };
const NOTICE_LABEL: Record<string, string> = { ok: "fatto", warn: "attenzione", error: "errore", info: "notifica" };

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
      who.append(h("span", { class: "n", text: "Notifica" }), h("span", { text: NOTICE_LABEL[n.level] ?? "" }));
      title.textContent = n.title || n.text;
      text.textContent = n.title ? n.text : "";
      clear(row);
      if (n.suggestion) {
        const fp = n.suggestion;
        who.firstChild!.textContent = "Proposta";
        row.append(
          btn(n.suggestionAccept || "Crea", "primary", () => actions.answerSuggestion(fp, "create")),
          btn("Non ora", "secondary", () => actions.answerSuggestion(fp, "snooze")),
          btn("No, mai", "secondary", () => actions.answerSuggestion(fp, "dismiss")),
        );
      } else if (n.install) {
        // A new version: installed only with this click.
        row.append(
          btn("Installa", "primary", () => actions.installUpdate()),
          btn("Più tardi", "secondary", () => actions.collapse()),
        );
      } else {
        if (n.url) row.append(btn("Apri", "primary", () => { actions.openUrl(n.url); actions.collapse(); }));
        row.append(btn("OK", n.url ? "secondary" : "primary", () => actions.collapse()));
      }
      host.append(card(NOTICE_WASH[n.level] ?? "indigo", stack(116, 16, who, title, text, row)));
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Suono" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 14),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: "Impostazioni…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Pannello aperto · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(
        dot("#8E939C", 6),
        h("span", { text: s.chatEngine === "api" ? "Chat · API" : "Chat · Abbonamento" }),
      );
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
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
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("notify", buildNotify(actions));
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload(actions));
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  map.set("actions", buildActions(actions));
  map.set("run", buildRun(actions));
  map.set("unzip", buildUnzip(actions));
  map.set("files", buildFiles(actions));
  map.set("diff", buildDiff(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder("L'invio via email non è disponibile in questa versione.", ""));
  map.set("searching", buildPlaceholder("Claude sta cercando…", ""));
  map.set("result", buildPlaceholder("Risultato", ""));
  return map;
}
