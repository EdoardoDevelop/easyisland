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
import { actionIcon, actionIconSvg } from "./action-icons";
import { unreadNews } from "./news";

type Section = "oggi" | "agenti" | "chat" | "azioni" | "file" | "notizie";

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
    case "news": return "notizie";
    default: return null;
  }
}

/**
 * Views that are no row of the menu (a moment, the recap, the day's summary, a
 * suggestion, a search's result…): nothing is lit while they are on screen.
 */
const NOWHERE: ReadonlySet<IslandViewName> = new Set<IslandViewName>([
  "recap", "moment", "daily", "note", "notify", "searching", "result", "done", "remember", "talk", "barcard", "greeting", "mail",
]);

/** The lit row: a section, or the id of the integration whose card is on screen. */
function current(): string {
  const s = sectionOf(State.view);
  if (s) return s;
  if (NOWHERE.has(State.view)) return "";
  if (State.showsSummary && (State.view === "overview" || State.view === "empty")) return "oggi";
  const task = State.focusTask;
  if (isSessionTask(task)) return "agenti";
  return task?.id ?? "oggi";
}

/** Icon of an integration in the menu (and in the fixed bar): the user's emoji, else its logo, else its colour. */
export function taskIcon(task: AgentTask): Element {
  const own = State.settings.integrationTabIcons?.[task.id]?.trim() ?? "";
  if (own && !own.startsWith("@")) return h("span", { class: "rail-emoji", text: own });
  // An integration of the user's: the icon the chat gave it.
  const custom = task.id.startsWith("custom:") ? State.customs.find((c) => `custom:${c.id}` === task.id)?.icon : "";
  if (custom) return h("span", { class: "rail-emoji", text: custom });
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

/** A pointer out of the open island (the window may be larger than it). */
function outsideIsland(e: PointerEvent): boolean {
  const island = document.getElementById("island");
  if (!island) return false;
  const r = island.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * A row that, dragged out of the island and let go there, becomes a window
 * (`drop` with the screen point); a press that does not leave stays a click.
 */
function tearable(row: HTMLElement, drop: (at: { x: number; y: number }) => void): HTMLElement {
  row.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const from = { x: down.clientX, y: down.clientY };
    let on = false;
    // The whole page listens from the press on: a quick drag leaves the row at once.
    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      if (!on) {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < 6) return;
        on = true;
        // Outside the window too, until the release.
        try {
          row.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
        row.classList.add("dragging");
      }
      row.classList.toggle("tearing", outsideIsland(e));
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (!on) return;
      if (row.hasPointerCapture(e.pointerId)) row.releasePointerCapture(e.pointerId);
      row.classList.remove("dragging", "tearing");
      // Not a click on the row as well.
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      row.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => row.removeEventListener("click", swallow, { capture: true }), 0);
      if (e.type === "pointerup" && outsideIsland(e)) drop({ x: e.screenX, y: e.screenY });
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  });
  return row;
}

export function buildRail(actions: ViewActions): ViewHost {
  const head = h("div", { class: "rail-head" });
  const go = (fn: () => void) => () => {
    actions.blip();
    fn();
  };
  const row = (id: string, icon: Element, label: string, onclick: () => void) =>
    h("button", { class: "rail-item", "data-rail": id, onclick: go(onclick) },
      h("span", { class: "rail-icon" }, icon), h("span", { class: "rail-label", text: label, title: label }), h("span", { class: "rail-meta" }));

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
    chat: tearable(row("chat", glyph("bubble"), t("Chat"), () => {
      if (!actions.popped("chat")) actions.setView("prompt");
    }), (at) => actions.popOut("chat", at)),
    azioni: row("azioni", glyph("bolt"), t("Azioni"), () => actions.setView("actions")),
    file: row("file", glyph("stack"), t("File e schermo"), () => actions.openFiles()),
    notizie: row("notizie", actionIconSvg(actionIcon("i:globe")!, 15), t("Notizie"), () => actions.setView("news")),
  };
  const fixed = h("div", { class: "rail-fixed" }, ...Object.values(sections));
  const label = h("div", { class: "rail-label-head", text: t("Integrazioni") });
  const list = h("div", { class: "rail-list" });
  // Dragged into order as the pills were (Impostazioni → Integrazioni → Blocca lo spostamento).
  // …or dragged out of the island: a window of its own (popout.ts).
  sortable(list, {
    enabled: () => !State.settings.lockOrder,
    onReorder: (ids) => actions.reorder(ids),
    out: { outside: outsideIsland, drop: (id, e) => actions.popOut(id, { x: e.screenX, y: e.screenY }) },
  });
  const el = h("nav", { id: "rail", "aria-label": t("Sezioni") }, head, fixed, label, list);
  // More rows below the edge: the last one fades out, so it reads as «scroll», not as cut.
  const edge = () => list.classList.toggle("more", list.scrollHeight - list.scrollTop - list.clientHeight > 2);
  list.addEventListener("scroll", edge, { passive: true });
  new ResizeObserver(edge).observe(list);

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
      // Notizie: a tab of its own, off in Impostazioni → Notizie; the count of news not seen yet.
      sections.notizie.style.display = State.settings.news?.tab === false ? "none" : "";
      const unread = current() === "notizie" ? 0 : unreadNews();
      const newsMeta = sections.notizie.querySelector<HTMLElement>(".rail-meta")!;
      newsMeta.textContent = unread ? String(unread) : "";
      newsMeta.className = unread ? "rail-meta count" : "rail-meta";
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
            // In a window of its own: that window comes forward instead.
            if (actions.popped(x.id)) return;
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
        b.classList.toggle("on", !!on && b.dataset.rail === on);
      }
      edge();
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
