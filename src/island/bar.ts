// The elements of the fixed bar (docs/architettura.md → «Barra fissa»): the user's
// integrations, widgets and quick actions in the bar's three areas, and the
// strip (permission, call, recording, meeting, agent at work, the bar of the
// app in use), beside the character unless the user put it elsewhere. The island
// keeps the data and prepares each element here, with the same icons as its
// menu and its actions; the character's window (the bar) only lays them out
// and sends the clicks back (src/core/link.ts). Texts are put in with
// textContent: a value read from a service never becomes markup.

import { h } from "../views/dom";
import { renderActionIcon } from "../views/action-icons";
import { taskIcon } from "../views/rail";
import { State } from "../core/state";
import type { BarPiece } from "../core/link";
import type { StripItem } from "../views/strip";

/**
 * The strip as one element: its line and its buttons. Each button carries its
 * index (`data-btn`): the click comes back as `strip:btn:<i>` (Island.barClick).
 */
function stripPiece(item: StripItem, area: BarPiece["area"]): BarPiece {
  const el = h("span", { class: "bar-strip" });
  el.dataset.tone = item.tone;
  if (item.title || item.sub) {
    el.append(h("span", { class: "bar-strip-text" },
      ...(item.title ? [h("strong", { text: item.title })] : []),
      ...(item.sub ? [h("span", { class: "bar-strip-sub", text: item.sub })] : [])));
  }
  item.buttons.forEach((b, i) => {
    const look = b.look ?? "both";
    const icon = b.icon !== undefined && look !== "text";
    const btn = h("span", { class: `bar-strip-btn ${b.tone}`, title: b.hint ?? b.label });
    btn.dataset.btn = String(i);
    if (b.color) btn.style.setProperty("--action", b.color);
    if (icon) btn.append(h("span", { class: "bar-icon" }, renderActionIcon(b.icon, 14)));
    if (look !== "icon" || !icon) btn.append(h("span", { text: b.label }));
    el.append(btn);
  });
  return { key: "strip", area, html: el.outerHTML, title: [item.title, item.sub].filter(Boolean).join(" — ") };
}

/** The status line of an integration or widget: its summary, or its last step. */
function valueOf(taskId: string): { value: string; level?: "ok" | "warn" | "error" } {
  const st = State.widgetStatus[taskId.replace(/^widget:/, "")];
  const task = State.tasks.find((x) => x.id === taskId);
  const step = task?.steps.length ? task.steps[task.steps.length - 1] : "";
  return { value: st?.summary || step || "", level: st?.level };
}

/**
 * What the bar shows now, in the user's order. Elements that are gone are
 * skipped. `strip` is what the strip shows now (null: nothing): at its place in
 * the list, or first beside the character when the user did not place it.
 */
export function barPieces(strip: StripItem | null): BarPiece[] {
  const out: BarPiece[] = [];
  const items = State.settings.fixedBarItems ?? [];
  if (strip && !items.some((x) => x.id === "strip")) out.push(stripPiece(strip, State.settings.fixedBarSlot ?? "center"));
  for (const it of items) {
    const area = it.area === "start" || it.area === "end" ? it.area : "center";
    const show = it.show ?? "both";
    if (it.id === "strip") {
      if (strip) out.push(stripPiece(strip, area));
    } else if (it.id.startsWith("task:")) {
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
