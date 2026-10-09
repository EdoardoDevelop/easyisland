// The weekly recap card (src/island/recap.ts counts the week). The character
// sits on the left as on the other cards; nothing animates here.

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { Recap, formatCount, formatDuration, weekRangeLabel, type WeeklySummary } from "../island/recap";
import type { ViewActions, ViewHost } from "./views";

function chip(value: string, label: string): HTMLElement {
  return h("div", { class: "recap-chip" }, h("div", { class: "v", text: value }), h("div", { class: "l", text: label }));
}

/** "Label value · Label value", values in white. */
function metaLine(pairs: [string, string][]): HTMLElement | null {
  if (pairs.length === 0) return null;
  const el = h("div", { class: "recap-meta" });
  pairs.forEach(([label, value], i) => {
    if (i > 0) el.append(h("span", { class: "sep", text: "·" }));
    el.append(h("span", { text: label }), h("span", { class: "n", text: value }));
  });
  return el;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildRecap(actions: ViewActions): ViewHost {
  const body = h("div", { class: "stack recap-stack" });
  const card = h("div", { class: "card wash recap-card" }, body);
  card.style.setProperty("--wash", washRGBA("indigo"));
  const el = h("div", { class: "view" }, card);
  let built = -1;

  const ok = () => h("div", { class: "actions" }, h("button", { class: "btn secondary", onclick: () => actions.collapse() }, h("span", { text: "OK" })));

  function summaryBody(s: WeeklySummary): Node[] {
    const chips = h("div", { class: "recap-chips" },
      chip(formatDuration(s.totalMinutes), "al lavoro"),
      chip(formatCount(s.sessionCount), plural(s.sessionCount, "sessione", "sessioni")),
      chip(formatCount(s.filesChanged), plural(s.filesChanged, "file", "file")),
    );
    if (s.linesAdded + s.linesRemoved > 0) chips.append(chip(`+${formatCount(s.linesAdded)} / −${formatCount(s.linesRemoved)}`, "righe"));
    if (s.commandsRun > 0) chips.append(chip(formatCount(s.commandsRun), plural(s.commandsRun, "comando", "comandi")));

    const first: [string, string][] = [];
    if (s.topAgent) first.push(["Agente", s.topAgent]);
    if (s.topProject) first.push(["Progetto", s.topProject]);
    if (s.busiestDay) first.push(["Giorno più pieno", s.busiestDay]);
    const second: [string, string][] = [];
    if (s.longestSessionMinutes > 1) second.push(["Sessione più lunga", formatDuration(s.longestSessionMinutes)]);
    if (s.permissionsAllowed + s.permissionsDenied > 0) {
      second.push(["Permessi", `${s.permissionsAllowed} ${plural(s.permissionsAllowed, "consentito", "consentiti")}, ${s.permissionsDenied} ${plural(s.permissionsDenied, "negato", "negati")}`]);
    }
    if (s.questions > 0) second.push(["Domande", formatCount(s.questions)]);

    return [
      h("div", { class: "recap-head" },
        h("span", { class: "recap-title", text: "La tua settimana con gli agenti" }),
        h("span", { class: "grow" }),
        h("span", { class: "recap-range", text: weekRangeLabel(s) })),
      chips,
      ...[metaLine(first), metaLine(second)].filter((x): x is HTMLElement => !!x),
      ok(),
    ];
  }

  function emptyBody(): Node[] {
    return [
      h("div", { class: "title", text: "Nessuna sessione la settimana scorsa" }),
      h("div", { class: "sub", text: "EasyIsland conta le sessioni degli agenti mentre lavorano: ripassa lunedì prossimo." }),
      ok(),
    ];
  }

  return {
    el,
    sync() {
      // Rebuilt only when the recap was (re)loaded.
      if (built === Recap.version) return;
      built = Recap.version;
      clear(body);
      body.append(...(Recap.summary ? summaryBody(Recap.summary) : emptyBody()));
    },
    // The rows, the stack's gaps and padding, the card's margins.
    fitHeight: () => [...body.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0)
      + 7 * Math.max(0, body.children.length - 1) + 8 + 20,
  };
}
