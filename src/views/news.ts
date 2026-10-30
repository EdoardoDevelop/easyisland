// «Notizie» in the island (docs/chat.md → Notizie): the news found on Google
// News for the subjects the user follows (src-tauri/src/news.rs), newest
// first, grouped by nothing but filterable by subject. A row opens the article;
// «Salva» sends it to the memory's da-leggere; «Aggiorna» checks now. The menu
// counts the news found since the view was last opened (`seenAt`, kept in the
// island's localStorage).

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";
import { locale, t } from "../core/i18n";

const SEEN_KEY = "easyisland.news.seen";

/** When the view was last opened (unix seconds). */
export function newsSeenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Math.floor(Date.now() / 1000)));
  } catch {
    // Storage unavailable: the count just stays.
  }
}

/** News found since the view was last opened. */
export function unreadNews(): number {
  const seen = newsSeenAt();
  return State.news.filter((n) => n.found > seen).length;
}

/** «2 h fa», «ieri», «28 ott». */
function ago(at: number): string {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 3600) return t("{n} min fa", { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return t("{n} h fa", { n: Math.round(s / 3600) });
  if (s < 2 * 86_400) return t("ieri");
  return new Date(at * 1000).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

export function buildNews(actions: ViewActions): ViewHost {
  const list = h("div", { class: "news-items" });
  const filters = h("div", { class: "news-filters" });
  const status = h("span", { class: "recap-range" });
  const refresh = h("button", { class: "btn secondary", onclick: () => void run() }, h("span", { text: t("Aggiorna") })) as HTMLButtonElement;
  const body = h("div", { class: "stack recap-stack news-stack" },
    h("div", { class: "recap-head" },
      h("span", { class: "recap-title", text: t("Notizie") }),
      h("span", { class: "grow" }),
      status),
    filters,
    list,
    h("div", { class: "actions" },
      refresh,
      h("button", { class: "btn secondary", onclick: () => void Bridge.openSettingsAt("notizie") }, h("span", { text: t("Argomenti") })),
      h("button", { class: "btn secondary", onclick: () => actions.collapse() }, h("span", { text: "OK" }))));
  const card = h("div", { class: "card wash recap-card" }, body);
  card.style.setProperty("--wash", washRGBA("cyan"));
  const el = h("div", { class: "view" }, card);
  let topic = "";
  let key = "";
  let saved = new Set<string>();

  async function run() {
    refresh.disabled = true;
    status.textContent = t("Cerco…");
    try {
      const n = await Bridge.newsRefresh();
      status.textContent = n ? t("{n} nuove", { n }) : t("Niente di nuovo");
    } catch (err) {
      status.textContent = String(err).replace(/^Error:\s*/, "");
    } finally {
      refresh.disabled = false;
    }
  }

  function draw() {
    const topics = [...new Set(State.news.map((n) => n.topic))];
    if (topic && !topics.includes(topic)) topic = "";
    clear(filters);
    if (topics.length > 1) {
      for (const name of ["", ...topics]) {
        filters.append(h("button", { class: name === topic ? "news-filter on" : "news-filter", text: name || t("Tutte"), onclick: () => { topic = name; key = ""; draw(); } }));
      }
    }
    clear(list);
    const shown = State.news.filter((n) => !topic || n.topic === topic).slice(0, 30);
    if (!shown.length) {
      const none = (State.settings.news?.topics ?? []).length
        ? t("Ancora nessuna notizia: arrivano al prossimo controllo, o con «Aggiorna».")
        : t("Scegli gli argomenti da seguire in Impostazioni → Notizie.");
      list.append(h("div", { class: "sub", text: none }));
    }
    const seen = newsSeenAt();
    for (const n of shown) {
      const save = h("button", { class: "news-save", text: saved.has(n.id) ? t("Salvata") : t("Salva"), title: t("Salva nella memoria (da leggere)") }) as HTMLButtonElement;
      save.disabled = saved.has(n.id);
      save.addEventListener("click", async (e) => {
        e.stopPropagation();
        save.disabled = true;
        try {
          await Bridge.newsSave(n.title, n.link, n.source);
          saved.add(n.id);
          save.textContent = t("Salvata");
        } catch {
          save.disabled = false;
        }
      });
      list.append(h("div", { class: n.found > seen ? "news-item new" : "news-item", role: "link", tabindex: "0", title: n.link, onclick: () => actions.openUrl(n.link) },
        h("div", { class: "news-title", text: n.title }),
        h("div", { class: "news-meta" },
          h("span", { text: [n.source, ago(n.at), topics.length > 1 && !topic ? n.topic : ""].filter(Boolean).join(" · ") }),
          h("span", { class: "grow" }),
          save)));
    }
  }

  return {
    el,
    sync() {
      const k = `${topic}|${State.news.map((n) => n.id).join(",")}`;
      if (k === key) return;
      key = k;
      draw();
      // Open on screen: what is here now counts as seen (the bold stays until next time).
      if (State.view === "news") markSeen();
    },
    fitHeight: () => [...body.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0)
      + 7 * Math.max(0, body.children.length - 1) + 8 + 20,
  };
}
