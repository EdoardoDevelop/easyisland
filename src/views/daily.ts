// The morning and end-of-day card (src/island/daily.ts): the engine's summary
// of today or tomorrow when one is chosen (giornata.rs), the agents' time, the
// repositories with changes not committed, the pull requests waiting.
// Laid out like the weekly recap; a row opens its folder or its page.

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { Bridge } from "../core/bridge";
import { Daily, type DailySummary } from "../island/daily";
import { formatCount, formatDuration } from "../island/recap";
import type { ViewActions, ViewHost } from "./views";
import { locale, t } from "../core/i18n";
import { renderMarkdown } from "../core/markdown";
import { State } from "../core/state";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Rows shown per list; the rest is a "+N". */
const ROWS = 3;

function chip(value: string, label: string): HTMLElement {
  return h("div", { class: "recap-chip" }, h("div", { class: "v", text: value }), h("div", { class: "l", text: label }));
}

/** "3 file non salvati · 2 commit da inviare". */
export function repoLine(r: { changed: number; ahead: number }): string {
  const parts: string[] = [];
  if (r.changed > 0) parts.push(`${r.changed} ${plural(r.changed, t("file modificato"), t("file modificati"))}`);
  if (r.ahead > 0) parts.push(`${r.ahead} ${plural(r.ahead, t("commit da inviare"), t("commit da inviare "))}`);
  return parts.join(" · ");
}

export function buildDaily(actions: ViewActions): ViewHost {
  const body = h("div", { class: "stack recap-stack" });
  const card = h("div", { class: "card wash recap-card" }, body);
  card.style.setProperty("--wash", washRGBA("indigo"));
  const el = h("div", { class: "view" }, card);
  let built = -1;

  function list(title: string, rows: HTMLElement[]): HTMLElement[] {
    if (!rows.length) return [];
    const shown = rows.slice(0, ROWS);
    if (rows.length > ROWS) shown.push(h("div", { class: "daily-more", text: t("e altri {n}", { n: rows.length - ROWS }) }));
    return [h("div", { class: "daily-list" }, h("div", { class: "daily-h", text: title }), ...shown)];
  }

  function row(main: string, side: string, hint: string, onClick: () => void): HTMLElement {
    return h("button", { class: "daily-row", title: hint, onclick: onClick },
      h("span", { class: "daily-main", text: main }),
      h("span", { class: "daily-side", text: side }));
  }

  /** The engine's summary: written, being written, failed, or «Chiedi» when an engine is chosen. */
  function aiBlock(s: DailySummary): HTMLElement[] {
    const ai = s.ai;
    const title = h("div", { class: "daily-h", text: s.which === "morning" ? t("La giornata di oggi") : t("La giornata di domani") });
    if (ai?.text) {
      return [h("div", { class: "daily-list" }, title,
        h("div", { class: "daily-ai md" }, ...renderMarkdown(ai.text, { openUrl: (url) => actions.openUrl(url) })))];
    }
    if (ai?.busy) return [h("div", { class: "daily-list" }, title, h("div", { class: "sub", text: t("Sto scrivendo il riassunto dalle integrazioni…") }))];
    if (!State.settings.dailyAi) return [];
    const note = h("div", { class: "daily-more", text: ai?.error ? t("Riassunto non riuscito: {e}", { e: ai.error }) : "" });
    const ask = h("button", { class: "btn secondary", text: ai?.error ? t("Riprova") : t("Chiedi il riassunto all'IA") }) as HTMLButtonElement;
    ask.addEventListener("click", async () => {
      ask.disabled = true;
      const err = await Daily.askAi();
      if (err) {
        note.textContent = err;
        ask.disabled = false;
      }
    });
    return [h("div", { class: "daily-list" }, title, ...(ai?.error ? [note] : []), h("div", { class: "row" }, ask))];
  }

  function content(s: DailySummary): Node[] {
    const morning = s.which === "morning";
    const date = s.day.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short" }).replace(".", "");
    const chips = h("div", { class: "recap-chips" });
    if (s.minutes > 0) {
      chips.append(
        chip(formatDuration(s.minutes), morning ? t("ieri al lavoro") : t("oggi al lavoro")),
        chip(formatCount(s.sessions), plural(s.sessions, t("sessione"), t("sessioni"))),
      );
      if (s.linesAdded + s.linesRemoved > 0) chips.append(chip(`+${formatCount(s.linesAdded)} / −${formatCount(s.linesRemoved)}`, t("righe")));
    }
    const repos = list(t("Modifiche non salvate"), s.digest.repos.map((r) =>
      row(r.name, `${r.branch ? `${r.branch} · ` : ""}${repoLine(r)}`, r.path, () => void Bridge.actionOpenApp(r.path, "").catch(() => {}))));
    const prs = s.digest.prs ?? [];
    const review = list(t("Pull request da rivedere"), prs.filter((p) => p.review).map((p) =>
      row(p.title, `${p.repo} #${p.number}`, p.url, () => actions.openUrl(p.url))));
    const mine = list(t("Le tue pull request aperte"), prs.filter((p) => !p.review).map((p) =>
      row(p.title, `${p.repo} #${p.number}`, p.url, () => actions.openUrl(p.url))));
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const notion = list(t("Oggi in Notion"), s.notion.map((x) => {
      const day = (x.due ?? "").slice(0, 10);
      const time = x.due && x.due.includes("T") ? new Date(x.due).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "";
      return row(x.title, day && day < today ? t("scaduta") : time || t("oggi"), x.url, () => actions.openUrl(x.url));
    }));
    const news = list(t("Notizie"), s.news.map((n) => row(n.title, n.source, n.link, () => actions.openUrl(n.link))));
    const ai = aiBlock(s);
    const nothing = !chips.childElementCount && !repos.length && !prs.length && !notion.length && !news.length && !s.ai?.text;
    return [
      h("div", { class: "recap-head" },
        h("span", { class: "recap-title", text: morning ? t("Buongiorno") : t("Fine giornata") }),
        h("span", { class: "grow" }),
        h("span", { class: "recap-range", text: morning ? t("ieri, {date}", { date }) : date })),
      ...ai,
      ...(chips.childElementCount ? [chips] : []),
      ...notion,
      ...repos,
      ...review,
      ...mine,
      ...news,
      ...(nothing ? [h("div", { class: "sub", text: morning
        ? t("Ieri nessun agente al lavoro, niente da salvare e nessuna pull request in attesa.")
        : t("Oggi nessun agente al lavoro, niente da salvare e nessuna pull request in attesa.") })] : []),
      ...(s.digest.prs === null && !nothing ? [h("div", { class: "daily-more", text: t("Per le pull request serve gh o il token di GitHub (Impostazioni → Integrazioni).") })] : []),
      h("div", { class: "actions" }, h("button", { class: "btn secondary", onclick: () => actions.collapse() }, h("span", { text: "OK" }))),
    ];
  }

  return {
    el,
    sync() {
      if (built === Daily.version) return;
      built = Daily.version;
      clear(body);
      if (Daily.summary) body.append(...content(Daily.summary));
    },
    fitHeight: () => [...body.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0)
      + 7 * Math.max(0, body.children.length - 1) + 8 + 20,
  };
}
