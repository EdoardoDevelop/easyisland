// The elements of the fixed bar (docs/barra-fissa.md, step 2): the user's
// integrations, widgets and quick actions in the bar's three areas. The island
// keeps the data and prepares each element here, with the same icons as its
// menu and its actions; the character's window (the bar) only lays them out
// and sends the clicks back (src/core/link.ts). Texts are put in with
// textContent: a value read from a service never becomes markup.

import { h } from "../views/dom";
import { renderActionIcon } from "../views/action-icons";
import { taskIcon } from "../views/rail";
import { State } from "../core/state";
import type { BarPiece } from "../core/link";

/** The status line of an integration or widget: its summary, or its last step. */
function valueOf(taskId: string): { value: string; level?: "ok" | "warn" | "error" } {
  const st = State.widgetStatus[taskId.replace(/^widget:/, "")];
  const task = State.tasks.find((x) => x.id === taskId);
  const step = task?.steps.length ? task.steps[task.steps.length - 1] : "";
  return { value: st?.summary || step || "", level: st?.level };
}

/** What the bar shows now, in the user's order. Elements that are gone are skipped. */
export function barPieces(): BarPiece[] {
  const out: BarPiece[] = [];
  for (const it of State.settings.fixedBarItems ?? []) {
    const area = it.area === "start" || it.area === "end" ? it.area : "center";
    const show = it.show ?? "both";
    if (it.id.startsWith("task:")) {
      const task = State.tasks.find((x) => x.isIntegration && x.id === it.id.slice(5));
      if (!task) continue;
      const { value, level } = valueOf(task.id);
      const el = h("span", { class: "bar-item" });
      if (show !== "value") el.append(h("span", { class: "bar-icon" }, taskIcon(task)));
      if (show !== "icon") el.append(h("span", { class: "bar-text", text: value || task.name }));
      out.push({ key: it.id, area, html: el.outerHTML, title: value ? `${task.name} — ${value}` : task.name, tone: level });
    } else if (it.id.startsWith("action:")) {
      const a = (State.settings.actions ?? []).find((x) => x.id === it.id.slice(7));
      if (!a) continue;
      const el = h("span", { class: "bar-item bar-action" });
      if (a.color) el.style.setProperty("--action", a.color);
      if (show !== "value") el.append(h("span", { class: "bar-icon" }, renderActionIcon(a.icon, 15)));
      if (show !== "icon") el.append(h("span", { class: "bar-text", text: a.name }));
      out.push({ key: it.id, area, html: el.outerHTML, title: a.name });
    }
  }
  return out;
}
