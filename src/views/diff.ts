// "Modifiche": what Claude Code changed in one file of the session (HANDOFF
// 6.6, point 1). The diffs are computed by the relay (hook/src/diff.rs) from the
// hook payload alone and kept in memory (State.diffs): 50 at most, an hour at
// most, gone when the session ends. Nothing here reads the file.

import { h } from "./dom";
import { State, type FileDiff } from "../core/state";
import { Bridge } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";
import { t } from "../core/i18n";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** The first changed line of the file's newest edit, for ↗ (1 when unknown). */
function firstLine(edits: FileDiff[]): number {
  const hunk = edits.at(-1)?.hunks[0];
  if (!hunk || hunk.new <= 0) return 1;
  // Skip the context lines in front of the change.
  const lead = hunk.lines.findIndex((l) => l[0] === "+" || l[0] === "-");
  return hunk.new + Math.max(0, lead);
}

/** One edit: its hunks, each with line numbers when Claude Code gave them. */
function renderEdit(d: FileDiff, index: number, total: number): HTMLElement {
  const el = h("div", { class: "diff-edit" });
  if (total > 1) {
    el.append(h("div", { class: "diff-edit-head",
      text: `${t("Modifica {i} di {n}", { i: index + 1, n: total })}  ·  +${d.added} −${d.removed}` }));
  }
  if (d.tooBig) {
    el.append(h("div", { class: "diff-big", text: `Diff troppo grande: +${d.added} −${d.removed} righe.` }));
    return el;
  }
  for (const hunk of d.hunks) {
    if (hunk.new > 0) el.append(h("div", { class: "diff-hunk", text: `riga ${hunk.new}` }));
    let oldNo = hunk.old;
    let newNo = hunk.new;
    for (const line of hunk.lines) {
      const sign = line[0];
      const kind = sign === "+" ? "add" : sign === "-" ? "del" : "ctx";
      let no = "";
      if (newNo > 0) {
        if (kind === "del") no = String(oldNo++);
        else {
          no = String(newNo++);
          if (kind === "ctx") oldNo++;
        }
      }
      el.append(h("div", { class: `diff-line ${kind}` },
        h("span", { class: "diff-no", text: no }),
        h("span", { class: "diff-sign", text: sign === "+" || sign === "-" ? sign : " " }),
        h("span", { class: "diff-code", text: line.slice(1) })));
    }
  }
  return el;
}

export function buildDiff(actions: ViewActions): ViewHost {
  const name = h("b", { class: "diff-title" });
  const counts = h("span", { class: "diff-counts" });
  const open = h("button", { class: "diff-open", title: t("Apri in VS Code"), text: "↗" }) as HTMLButtonElement;
  const head = h("div", { class: "files-head" },
    h("button", { class: "files-back", title: t("Indietro"), text: "‹", onclick: () => actions.setView("overview") }),
    name, counts, open);
  const tabs = h("div", { class: "diff-tabs" });
  const list = h("div", { class: "diff-list" });
  const body = h("div", { class: "files-body diff-body" }, head, tabs, list);
  const el = h("div", { class: "view" }, h("div", { class: "card files-card" }, body));

  let key = "";
  let line = 1;

  open.addEventListener("click", async () => {
    const file = State.diffFile;
    if (!file) return;
    const ok = await Bridge.openFileInVSCode(file, line).catch(() => false);
    open.title = ok ? t("Apri in VS Code") : t("VS Code non trovato, o il file non esiste più");
    open.classList.toggle("fail", !ok);
  });

  return {
    el,
    sync() {
      State.pruneDiffs();
      const files = State.diffFiles(State.diffTask);
      if (!State.diffFile || !files.some((f) => f.file === State.diffFile)) {
        State.diffFile = files[0]?.file ?? null;
      }
      const file = State.diffFile;
      const edits = State.diffs.filter((d) => d.file === file && (!State.diffTask || d.task === State.diffTask));
      const k = `${file}|${files.map((f) => f.file).join(",")}|${edits.map((d) => d.id).join(",")}`;
      if (k === key) return;
      key = k;

      tabs.replaceChildren(...(files.length > 1 ? files : []).map((f) => h("button", {
        class: `diff-file${f.file === file ? " on" : ""}`, title: f.file,
        onclick: () => {
          State.diffFile = f.file;
          State.notify();
        },
      },
      h("span", { class: "diff-name", text: baseName(f.file) }),
      h("span", { class: "diff-add", text: `+${f.added}` }),
      h("span", { class: "diff-del", text: `−${f.removed}` }))));
      tabs.style.display = files.length > 1 ? "" : "none";

      if (!file) {
        name.textContent = t("Modifiche");

        name.title = "";
        counts.textContent = "";
        open.style.display = "none";
        list.replaceChildren(h("div", { class: "files-empty",
          text: t("Nessuna modifica in questa sessione. I file che Claude Code cambia compaiono qui.") }));
        return;
      }
      const added = edits.reduce((s, d) => s + d.added, 0);
      const removed = edits.reduce((s, d) => s + d.removed, 0);
      name.textContent = baseName(file);
      name.title = file;
      counts.replaceChildren(
        h("span", { class: "diff-add", text: `+${added}` }), " ",
        h("span", { class: "diff-del", text: `−${removed}` }));
      open.style.display = "";
      open.classList.remove("fail");
      line = firstLine(edits);
      list.replaceChildren(...edits.map((d, i) => renderEdit(d, i, edits.length)));
      list.scrollTop = list.scrollHeight; // the newest edit is the last one
    },
    fitHeight: () => body.offsetHeight + 16,
  };
}
