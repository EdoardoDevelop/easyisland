// The menu on the left of the open island: the character at its head (drawn by
// island.ts on its own canvas, over the empty head kept here), the sections
// (Panoramica, Agenti, Chat, Azioni, File e schermo) and the active integrations,
// each with its icon and a dot when it has news. It takes the place of the
// header's tabs and of the overview's pills: one way to get anywhere.
// What shows and how is chosen in Impostazioni, never in the island.

import { h, svg, dot, brandIcon, markIcon } from "./dom";
import { ICONS, LINE_SECTIONS } from "./icons";
import { windowsLook } from "../core/uistyle";
import { isSorting, sortable } from "./sortable";
import { State, CLAUDE_TASK, isSessionTask, type AgentTask } from "../core/state";
import { RAIL_BOT, railHead, type IslandViewName } from "../core/layout";
import { t } from "../core/i18n";
import type { ViewActions, ViewHost } from "./views";

type Section = "oggi" | "agenti" | "chat" | "azioni" | "file";

/** The character's diameter at the head of the menu (Impostazioni → Posizione e aspetto). */
export function railBotSize(): number {
  return RAIL_BOT[State.settings.menuCharacter ?? "large"] ?? RAIL_BOT.large;
}

const BADGE: Record<string, string> = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" };

/** Views that belong to a section of the menu (the rest light up their task). */
function sectionOf(view: IslandViewName): Section | null {
  switch (view) {
    case "prompt": return "chat";
    case "actions": case "run": case "rewrite": return "azioni";
    case "files": case "unzip": return "file";
    default: return null;
  }
}

/** The lit row: a section, or the id of the integration whose card is on screen. */
function current(): string {
  const s = sectionOf(State.view);
  if (s) return s;
  if (State.showsSummary && (State.view === "overview" || State.view === "empty")) return "oggi";
  const task = State.focusTask;
  if (isSessionTask(task)) return "agenti";
  return task?.id ?? "oggi";
}

/** Icon of an integration in the menu: the user's emoji, else its logo, else its colour. */
function taskIcon(task: AgentTask): Element {
  const own = State.settings.integrationTabIcons?.[task.id]?.trim() ?? "";
  if (own && !own.startsWith("@")) return h("span", { class: "rail-emoji", text: own });
  const mark = markIcon(task.id, 15);
  if (!mark) return dot(task.color, 8);
  // A wide logo (3CX, n8n, Stripe) shrinks to the emojis' width instead of
  // overflowing the column: every icon of the menu takes the same room.
  const w = Number(mark.getAttribute("width")), hh = Number(mark.getAttribute("height"));
  if (w > ICON_W && hh > 0) {
    mark.setAttribute("width", String(ICON_W));
    mark.setAttribute("height", String(Math.round((ICON_W * hh) / w)));
  }
  return mark;
}

/** A section's glyph: filled in the classic look, a line in the Windows 11 one. */
function glyph(name: keyof typeof LINE_SECTIONS): SVGSVGElement {
  return windowsLook() ? svg(LINE_SECTIONS[name], 16, { stroke: 1.6 }) : svg(ICONS[name], 15);
}

/** The width of an icon in the menu: an emoji's at 13 px. */
const ICON_W = 16;

/** The Agenti row's icon: terminal (default), Claude's logo, or the user's emoji (Impostazioni → Agenti). */
function agentsIcon(): Element {
  const look = State.settings.integrationTabIcons?.[CLAUDE_TASK]?.trim() ?? "";
  if (look === "@logo") return brandIcon(CLAUDE_TASK, 15) ?? svg(ICONS.terminal, 15);
  if (look && look !== "@name") return h("span", { class: "rail-emoji", text: look });
  return glyph("terminal");
}

export function buildRail(actions: ViewActions): ViewHost {
  const head = h("div", { class: "rail-head" });
  const go = (fn: () => void) => () => {
    actions.blip();
    fn();
  };
  const row = (id: string, icon: Element, label: string, onclick: () => void) =>
    h("button", { class: "rail-item", "data-rail": id, onclick: go(onclick) },
      h("span", { class: "rail-icon" }, icon), h("span", { class: "rail-label", text: label }), h("span", { class: "rail-meta" }));

  const sections: Record<Section, HTMLElement> = {
    oggi: row("oggi", glyph("house"), t("Panoramica"), () => {
      State.summary = true;
      actions.setView("overview");
    }),
    agenti: row("agenti", agentsIcon(), t("Agenti"), () => {
      // The agent heard from last (Claude Code, opencode, Codex…); its card switches between them.
      const agent = State.latestSessionTask;
      if (agent) actions.setFocus(agent.id);
      actions.setView("overview");
    }),
    chat: row("chat", glyph("bubble"), t("Chat"), () => actions.setView("prompt")),
    azioni: row("azioni", glyph("bolt"), t("Azioni"), () => actions.setView("actions")),
    file: row("file", glyph("stack"), t("File e schermo"), () => actions.openFiles()),
  };
  const fixed = h("div", { class: "rail-fixed" }, ...Object.values(sections));
  const label = h("div", { class: "rail-label-head", text: t("Integrazioni") });
  const list = h("div", { class: "rail-list" });
  // Dragged into order as the pills were (Impostazioni → Integrazioni → Blocca lo spostamento).
  sortable(list, { enabled: () => !State.settings.lockOrder, onReorder: (ids) => actions.reorder(ids) });
  const el = h("nav", { id: "rail", "aria-label": t("Sezioni") }, head, fixed, label, list);

  let listKey = "";
  let agentsLook: string | null = null;
  let uiSeen = document.documentElement.dataset.ui;
  // The Agenti count once that row was opened: it comes back only when more start.
  let agentsSeen = 0;

  return {
    el,
    sync() {
      head.style.height = `${railHead(railBotSize())}px`;
      // The look changed in Impostazioni: the sections' glyphs follow.
      if (document.documentElement.dataset.ui !== uiSeen) {
        uiSeen = document.documentElement.dataset.ui;
        const glyphs: [Section, keyof typeof LINE_SECTIONS][] = [["oggi", "house"], ["chat", "bubble"], ["azioni", "bolt"], ["file", "stack"]];
        for (const [id, name] of glyphs) sections[id].querySelector(".rail-icon")!.replaceChildren(glyph(name));
        agentsLook = null;
      }
      const look = State.settings.integrationTabIcons?.[CLAUDE_TASK] ?? "";
      if (look !== agentsLook) {
        agentsLook = look;
        sections.agenti.querySelector(".rail-icon")!.replaceChildren(agentsIcon());
      }
      // No agent to show (Claude Code off, nothing followed): no row.
      sections.agenti.style.display = State.latestSessionTask ? "" : "none";
      const on = current();
      const busy = State.sessionTasks.filter((x) => x.state !== "idle" && x.state !== "sleeping" && x.state !== "finished").length;
      if (on === "agenti" || busy < agentsSeen) agentsSeen = busy;
      const news = busy > agentsSeen;
      const agentsMeta = sections.agenti.querySelector<HTMLElement>(".rail-meta")!;
      agentsMeta.textContent = news ? String(busy) : "";
      agentsMeta.className = news ? "rail-meta count" : "rail-meta";

      // Registra lives in File e schermo, not in the menu.
      const tasks = State.tasks.filter((x) => !isSessionTask(x) && x.id !== "integration_recorder");
      const icons = State.settings.integrationTabIcons ?? {};
      // The look too: the Windows 11 one draws line glyphs where the classic has emojis.
      const key = `${document.documentElement.dataset.ui}|` + tasks.map((x) => `${x.id}:${x.name}:${x.color}:${icons[x.id] ?? ""}`).join("|");
      if (key !== listKey && !isSorting(list)) {
        listKey = key;
        list.replaceChildren(...tasks.map((x) => {
          const b = row(x.id, taskIcon(x), x.name, () => {
            actions.setFocus(x.id);
            actions.setView("overview");
          });
          b.dataset.id = x.id;
          b.style.setProperty("--c", x.color);
          return b;
        }));
      }
      label.style.display = tasks.length ? "" : "none";

      for (const b of el.querySelectorAll<HTMLElement>(".rail-item")) {
        b.classList.toggle("on", b.dataset.rail === on);
      }
      for (const b of list.querySelectorAll<HTMLElement>(".rail-item")) {
        const task = tasks.find((x) => x.id === b.dataset.id);
        const meta = b.querySelector<HTMLElement>(".rail-meta")!;
        // Opened: its news has been seen.
        const color = task?.pillBadge && b.dataset.rail !== on ? BADGE[task.pillBadge] : "";
        meta.className = color ? "rail-meta dot" : "rail-meta";
        meta.style.background = color;
      }
    },
    fitHeight() {
      // The head, the sections and every integration, without scrolling. The
      // list's rows, not its box: the box stretches with the island, and the
      // island grew after it up to the screen's height.
      const first = list.firstElementChild as HTMLElement | null;
      const last = list.lastElementChild as HTMLElement | null;
      const rows = first && last ? last.offsetTop + last.offsetHeight - first.offsetTop : 0;
      return head.offsetHeight + fixed.offsetHeight + (label.style.display === "none" ? 0 : label.offsetHeight) + rows + 12;
    },
  };
}
