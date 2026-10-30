// «Notizie» in the island (docs/chat.md → Notizie): the news found on Google
// News for the subjects the user follows (src-tauri/src/news.rs), newest
// first, grouped by nothing but filterable by subject. A row opens the article;
// «Salva» sends it to the memory's da-leggere; «Aggiorna» checks now. The menu
// counts the news found since the view was last opened (`seenAt`, kept in the
// island's localStorage).
// Learning from use (step 3): «Non mi interessa» hides the news and lowers its
// subject, «Di più» raises it and searches the same story now (news.rs →
// taste, more or fewer news per check). At −3 the view asks whether to stop
// following the subject: «Smetti di seguirlo» moves it to the excluded ones.

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { Bridge } from "../core/bridge";
import { State, type NewsItem } from "../core/state";
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

/** Thumbnails asked of news.rs, by news id: the data URL, null for none, a promise while asked. */
const thumbs = new Map<string, string | null | Promise<string | null>>();

/**
 * A news' thumbnail: the article's picture (Bing News) or the paper's logo
 * (Google News), asked once; until then, or without one, the paper's initial.
 */
function thumb(n: NewsItem): HTMLElement {
  const logo = (n.image ?? "").includes("favicons");
  const box = h("div", { class: logo ? "news-thumb logo" : "news-thumb" },
    h("span", { class: "news-initial", text: (n.source.trim()[0] ?? "•").toUpperCase() }));
  const show = (url: string | null) => {
    if (!url) return;
    box.replaceChildren(h("img", { src: url, alt: "", draggable: "false" }));
  };
  if (!n.image) return box;
  const known = thumbs.get(n.id);
  if (typeof known === "string" || known === null) show(known);
  else {
    const asked = known ?? Bridge.newsImage(n.id).catch(() => null);
    thumbs.set(n.id, asked);
    void asked.then((url) => {
      thumbs.set(n.id, url ?? null);
      show(url ?? null);
    });
  }
  return box;
}

/** Taste at which the view proposes to stop following a subject. */
const DROP_AT = -3;

/** «Smetti di seguirlo»: the subject leaves the followed ones and never comes back as a proposal. */
function stopFollowing(name: string) {
  const news = (State.settings.news ??= { topics: [], excluded: [] });
  news.topics = news.topics.filter((x) => x.name !== name);
  if (!news.excluded.some((x) => x.toLowerCase() === name.toLowerCase())) news.excluded.push(name);
  delete State.newsTaste[name];
  void Bridge.saveSettings(State.settings);
  State.notify();
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
  const ask = h("div", { class: "news-ask" });
  const status = h("span", { class: "recap-range" });
  const refresh = h("button", { class: "btn secondary", onclick: () => void run() }, h("span", { text: t("Aggiorna") })) as HTMLButtonElement;
  const body = h("div", { class: "stack recap-stack news-stack" },
    h("div", { class: "recap-head" },
      h("span", { class: "recap-title", text: t("Notizie") }),
      h("span", { class: "grow" }),
      status),
    ask,
    filters,
    list,
    h("div", { class: "actions" },
      refresh,
      h("button", { class: "btn secondary", onclick: () => void Bridge.openSettingsAt("notizie") }, h("span", { text: t("Scegli gli argomenti") })),
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

  /** «Non mi interessa» / «Di più» on one news. */
  async function feedback(id: string, more: boolean) {
    if (more) status.textContent = t("Cerco…");
    try {
      const r = await Bridge.newsFeedback(id, more);
      State.newsTaste = { ...State.newsTaste, [r.topic]: r.taste };
      if (more) status.textContent = r.added ? t("{n} sulla stessa storia", { n: r.added }) : t("Niente altro su questa storia");
      State.notify();
    } catch (err) {
      status.textContent = String(err).replace(/^Error:\s*/, "");
    }
  }

  /** The first followed subject the user keeps turning down: stop following it? */
  function drawAsk(followed: string[]) {
    clear(ask);
    const name = followed.find((n) => (State.newsTaste[n] ?? 0) <= DROP_AT);
    if (!name) return;
    ask.append(
      h("span", { class: "grow", text: t("Le notizie su «{name}» non ti interessano?", { name }) }),
      h("button", { class: "news-save", text: t("Smetti di seguirlo"), onclick: () => stopFollowing(name) }),
      h("button", { class: "news-save", text: t("Tienilo"), onclick: () => {
        delete State.newsTaste[name];
        void Bridge.newsKeep(name);
        State.notify();
      } }));
  }

  function draw() {
    const followed = (State.settings.news?.topics ?? []).filter((x) => !x.off).map((x) => x.name);
    drawAsk(followed);
    // A subject just dropped: its news go now, not at the next check.
    const all = State.news.filter((n) => followed.includes(n.topic));
    const topics = [...new Set(all.map((n) => n.topic))];
    if (topic && !topics.includes(topic)) topic = "";
    clear(filters);
    if (topics.length > 1) {
      for (const name of ["", ...topics]) {
        filters.append(h("button", { class: name === topic ? "news-filter on" : "news-filter", text: name || t("Tutte"), onclick: () => { topic = name; key = ""; draw(); } }));
      }
    }
    clear(list);
    // Impostazioni → Notizie → Aspetto: a list, with thumbnails, or cards.
    const look = State.settings.news?.look ?? "list";
    list.className = `news-items ${look}`;
    const shown = all.filter((n) => !topic || n.topic === topic).slice(0, 40);
    if (!shown.length) {
      const none = followed.length
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
      const more = h("button", { class: "news-save", text: t("Di più"), title: t("Più notizie su «{name}», e subito altre su questa storia", { name: n.topic }) }) as HTMLButtonElement;
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        more.disabled = true;
        void feedback(n.id, true);
      });
      const less = h("button", { class: "news-save", text: "✕", title: t("Non mi interessa: meno notizie su «{name}»", { name: n.topic }), "aria-label": t("Non mi interessa") });
      less.addEventListener("click", (e) => {
        e.stopPropagation();
        void feedback(n.id, false);
      });
      const text = h("div", { class: "news-text" },
        h("div", { class: "news-title", text: n.title }),
        ...(n.summary && look !== "cards" ? [h("div", { class: "news-summary", text: n.summary })] : []),
        h("div", { class: "news-meta" },
          h("span", { class: "news-from", text: [n.source, ago(n.at), topics.length > 1 && !topic ? n.topic : ""].filter(Boolean).join(" · ") }),
          h("span", { class: "grow" }),
          more,
          save,
          less));
      list.append(h("div", { class: n.found > seen ? "news-item new" : "news-item", role: "link", tabindex: "0", title: n.link, onclick: () => actions.openUrl(n.link) },
        ...(look === "list" ? [] : [thumb(n)]),
        text));
    }
  }

  return {
    el,
    sync() {
      const k = `${topic}|${State.settings.news?.look}|${State.news.map((n) => n.id).join(",")}|${(State.settings.news?.topics ?? []).map((x) => x.name).join(",")}|${JSON.stringify(State.newsTaste)}`;
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
