// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { isSorting, sortable } from "./sortable";
import { h, svg, clear, dot, brandIcon, brandOrDot, hasMark, markIcon } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { plainText } from "../core/markdown";
import { State, canOpen, engineLabel, isSessionTask, sessionOpenLabel, type AgentTask, type AskQuestion } from "../core/state";
import { ISLAND_CHROME_H, MAX_ISLAND_H, washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../character/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildFiles, buildUnzip, buildUpload, buildUploading } from "./upload";
import { buildDiff } from "./diff";
import { buildRecap } from "./recap";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { buildActions, buildRun, type ActionHandlers } from "./actions";
import { planSummary, planText } from "../island/plan";
import { permissionModeLabel } from "../island/hooks";
import { renderMarkdown } from "../core/markdown";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";

export interface ViewActions extends ActionHandlers {
  setView(v: IslandViewName): void;
  /** The tray ("Vassoio"): the files dropped since EasyIsland started. */
  openFiles(): void;
  /** "Annulla" on a dropped file: forget it and go back. */
  cancelDrop(): void;
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
  /** "always": allow and save the rule Claude Code proposed (ApprovalInfo.always). */
  decide(d: "allow" | "deny" | "always"): void;
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
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", "data-id": "tab:home", title: t("Panoramica"), style: "--c:#38BDF8", onclick: () => {
    // Every integration at a glance; a click on one opens its card.
    State.summary = true;
    go("overview");
  } }, svg(ICONS.house, 16));
  const tabClaude = h("button", { class: "tab", "data-id": "tab:claude", title: t("Agenti: le sessioni di Claude Code, opencode e degli altri agenti"), style: "--c:#D97757", onclick: () => {
    // The agent heard from last (Claude Code, opencode, Codex…); the bar on the card switches.
    const agent = State.latestSessionTask;
    if (agent) State.setFocus(agent.id);
    go("overview");
  } });
  // Agenti: the coding agents' sessions (Claude Code, Codex, opencode…), not
  // only Claude's. Terminal icon (default), Claude's logo, name or emoji:
  // Impostazioni → Agenti → Scheda nell'isola.
  let claudeLook: string | null = null;
  const drawClaudeTab = () => {
    const look = State.settings.integrationTabIcons?.integration_claude?.trim() ?? "";
    if (look === claudeLook) return;
    claudeLook = look;
    tabClaude.className = look === "@name" ? "tab int-tab" : look && look !== "@logo" ? "tab int-tab icon" : "tab";
    tabClaude.replaceChildren(look === "@name" ? h("span", { text: t("Agenti") })
      : look === "@logo" ? brandIcon("integration_claude", 15) ?? svg(ICONS.spark, 15)
      : look ? h("span", { class: "int-tab-icon", text: look }) : svg(ICONS.terminal, 15));
  };
  drawClaudeTab();
  const tabChat = h("button", { class: "tab", "data-id": "tab:chat", title: t("Chiedi"), style: "--c:#A78BFA", onclick: () => go("prompt") }, svg(ICONS.bubble, 16));
  const tabDrop = h("button", { class: "tab", "data-id": "tab:drop", title: t("Rilascia"), style: "--c:#22C55E", onclick: () => go("upload") }, svg(ICONS.plus, 16));
  const tabActions = h("button", { class: "tab", "data-id": "tab:actions", title: t("Azioni"), style: "--c:#F5A524", onclick: () => go("actions") }, svg(ICONS.bolt, 16));
  const fixedTabs = [tabHome, tabClaude, tabChat, tabActions, tabDrop];

  const pinBtn = h("button", { title: t("Tieni aperta"), style: "--c:#A78BFA", onclick: () => {
    actions.blip();
    actions.toggleKeepOpen();
  } }, svg(ICONS.pin, 15));
  const gearBtn = h("button", { title: t("Impostazioni"), style: "--c:#94A3B8", onclick: () => go("settings") }, svg(ICONS.gear, 16));
  const soundBtn = h("button", { title: t("Silenzia"), style: "--c:#22D3EE", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 16));
  const closeBtn = h("button", { title: t("Chiudi"), style: "--c:#F4505E", onclick: () => actions.dismiss() }, svg(ICONS.xmark, 14));

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
      tabHome.classList.toggle("on", overview && showsSummary());
      drawClaudeTab();
      // No agent to show (Claude Code off, nothing followed, no session): no tab.
      tabClaude.style.display = State.latestSessionTask ? "" : "none";
      tabClaude.classList.toggle("on", overview && !showsSummary() && isSessionTask(State.focusTask));
      const tabs = State.tabTasks;
      const icons = State.settings.integrationTabIcons ?? {};
      const tabOrder = State.settings.tabOrder ?? [];
      const key = tabs.map((t) => `${t.id}:${t.name}:${t.color}:${icons[t.id] ?? ""}`).join("|") + `#${tabOrder.join("|")}`;
      if (key !== tabsKey && !isSorting(tabsRow)) {
        tabsKey = key;
        intTabs = [];
        for (const t of tabs) {
          // "@logo": the brand logo alone (Impostazioni → Integrazioni → Mostra come).
          const logo = icons[t.id]?.trim() === "@logo" ? markIcon(t.id, 15) : null;
          const icon = logo ? "" : icons[t.id]?.trim();
          intTabs.push(h("button", {
            class: logo ? "tab" : icon ? "tab int-tab icon" : "tab int-tab", "data-id": t.id, title: t.name,
            onclick: () => {
              actions.blip();
              State.setFocus(t.id);
              actions.setView("overview");
            },
          }, logo ?? (icon ? h("span", { class: "int-tab-icon", text: icon }) : brandOrDot(t.id, t.color, 8)),
            logo || icon ? null : h("span", { text: t.name })));
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
        // On ⌂ only the house is lit, even though the last integration keeps the focus.
        b.classList.toggle("on", overview && !showsSummary() && State.focusId === b.dataset.id);
        b.classList.toggle("badge", !!t?.pillBadge);
      }
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      tabActions.classList.toggle("on", v === "actions" || v === "run");
      gearBtn.classList.toggle("on", v === "settings");
      pinBtn.classList.toggle("on", State.keepOpen);
      pinBtn.classList.toggle("pinned", State.keepOpen);
      pinBtn.title = State.keepOpen ? t("Resta aperta: clic per lasciarla chiudere da sola (Ctrl+P)") : t("Tieni aperta (Ctrl+P)");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 16));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 16));
      soundBtn.style.setProperty("--c", State.settings.soundEnabled ? "#22D3EE" : "#F4505E");
      el.style.opacity = v === "confused" ? "0" : "1";
      closeBtn.style.display = State.settings.closeButton ? "" : "none";
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
  const left = card(null, agentBar, leftBody, jump);
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
        const sorting = leftBody.firstElementChild instanceof HTMLElement && isSorting(leftBody.firstElementChild);
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

      jump.style.display = detailOpen || showsSummary() || !canOpen(task) ? "none" : "";

      // Every pill is shown (the island grows to fit them); alerts go first.
      // An integration opened from its header tab stands alone: pills only on ⌂.
      // Claude Code has its own tab too; the summary already lists everything.
      const onTab = showsSummary() || (task != null && (State.isTab(task.id) || isSessionTask(task)));
      // In the user's order (dragged in the island): a pill with an alert keeps its place.
      // Agents live in the Agenti tab (and the summary), not among the pills.
      const others = onTab ? [] : State.otherTasks.filter((t) => !isSessionTask(t));
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
      const leftH = (content ? content.offsetHeight + 12 : 0) + (agentBar.style.display === "none" ? 0 : agentBar.offsetHeight);
      // …and the pills, two per row.
      const rows = Math.ceil(pillCount / 2);
      const pillsH = rows > 0 ? rows * 28 + (rows - 1) * 4 + 16 : 0;
      // Only past the tallest island do the pills scroll.
      pills.classList.toggle("scroll", pillsH > MAX_ISLAND_H - ISLAND_CHROME_H);
      return Math.max(leftH, pillsH);
    },
  };
}

/** The ⌂ tab shows the summary, unless a permission or a question is waiting. */
function showsSummary(): boolean {
  return State.showsSummary;
}

/** Panoramica: one row per integration (and agent) with its latest line; a click opens its card. */
function renderSummary(actions: ViewActions): HTMLElement {
  const grid = h("div", { class: "summary" });
  for (const t of State.tasks) {
    const label = pillLabel(t);
    const status = t.steps.length ? t.steps[t.steps.length - 1] : t.state === "idle" ? "" : t.state;
    const row = h("button", { class: "summary-row", "data-id": t.id, title: label.title ?? t.name, onclick: () => actions.setFocus(t.id) },
      brandOrDot(t.id, t.color, 8),
      h("span", { class: "summary-name", text: label.text }),
      h("span", { class: "summary-status", text: status }));
    if (t.pillBadge) row.classList.add(`badge-${t.pillBadge}`);
    grid.append(row);
  }
  if (!State.tasks.length) grid.append(h("span", { class: "hint", text: t("Nessuna integrazione attiva") }));
  // Dragged into the order the user wants: the same order as the pills.
  sortable(grid, { enabled: () => !State.settings.lockOrder, onReorder: (ids) => actions.reorder(ids) });
  return grid;
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


function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = pillLabel(task);
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "div",
    { class: (label.song ? "pill song" : "pill") + (hasMark(task.id) ? " has-brand" : ""), "data-id": task.id, title: label.title ?? "",
      onclick: () => actions.setFocus(task.id) },
    canvas,
    markIcon(task.id, 13),
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
      h("div", { class: "title", text: t("Nulla in esecuzione al momento.") }),
      h("div", { class: "sub", text: t("Trascina un file o chiedimi qualsiasi cosa.") }),
    ),
    h("div", { class: "grow" }),
    btn(t("Chiedi alla chat"), "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
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
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, risk, code, plan, always, row)));
  let rowKey = "";
  return {
    el,
    sync() {
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
        b.title = t("Consenti e non chiedere più (la regola proposta dall'agente)");
        row.append(b);
      }
      row.append(btn(t("Consenti"), "primary", () => actions.decide("allow"), "Y"));
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
      foot.append(h("button", { class: "link-btn", text: inOpencode ? t("Rispondi in opencode") : t("Rispondi nel terminale"), onclick: () => {
        if (inOpencode) actions.openTarget();
        actions.handToTerminal();
      } }));
      if (q.multiSelect) foot.append(go);
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
  const title = h("div", { class: "title" });
  const open = btn(t("Apri terminale"), "primary", () => actions.openTerminal());
  const row = h("div", { class: "actions" },
    open,
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, `${State.focusTask?.agentName ?? "Claude Code"} ha finito`));
      // Claude's last message when the relay found it, else the last step.
      const said = State.focusTask?.lastMessage;
      title.classList.toggle("last-msg", !!said);
      title.textContent = said ? plainText(said) : State.focusTask?.steps.at(-1) ?? t("Sessione terminata");
      // "Apri Claude", "Apri VS Code" or "Apri terminale": where the session runs.
      (open.firstChild as HTMLElement).textContent = sessionOpenLabel(State.focusTask?.sessionHost);
    },
    // A long last message grows the card instead of sliding under the buttons:
    // the three rows, the stack's gaps and padding, the card's margins.
    fitHeight: () => who.offsetHeight + title.offsetHeight + row.offsetHeight + 2 * 5 + 8 + 20,
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: t("Troppi colpi tutti insieme.") }),
    h("div", { class: "sub", text: t("Dammi un attimo: torno al lavoro tra tre secondi.") }),
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
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: t("Suono") }), volume),
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
        text: t("Impostazioni…"),
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
      autoLabel.textContent = `${t("Pannello aperto")} · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: t("Claude Code") }),
      );
      clear(apiBadge);
      apiBadge.append(
        dot("#8E939C", 6),
        h("span", { text: `Chat · ${engineLabel(s)}` }),
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
  map.set("question", buildQuestion(actions));
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
  map.set("recap", buildRecap(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder(t("L'invio via email non è disponibile in questa versione."), ""));
  map.set("searching", buildPlaceholder(t("Claude sta cercando…"), ""));
  map.set("result", buildPlaceholder(t("Risultato"), ""));
  return map;
}
