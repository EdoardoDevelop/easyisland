// Integration cards shown in the overview's left card — DOM ports of
// IntegrationCardView and friends from IslandViewContent.swift.
//
// Cal.com is the one simplification: macOS shows a three-level calendar
// (month → day → booking); here it is the list of upcoming bookings.

import { h, svg, clear, dot, brandOrDot } from "./dom";
import { ICONS } from "./icons";
import { State, PROBE_INTEGRATIONS, sessionOpenLabel, type AgentTask } from "../core/state";
import { Bridge, type NotionPage } from "../core/bridge";
import { THREECX, threecxCard } from "./threecx";
import { weatherCard } from "./weather";
import { netConfigCard, pingRow, resetNetConfig } from "./netconfig";
import { locale, t } from "../core/i18n";
import { Sound } from "../core/sound";

/** Same shape as the Swift `timeAgo` computed properties. */
export function timeAgo(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return t("adesso");
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return t("{n}g", { n: Math.floor(diff / 86400) });
}

/** Card titles that are not the task's own name, mapped to the brand logo's id. */
const BRAND_BY_NAME: Record<string, string> = {
  Vercel: "integration_vercel", Resend: "integration_resend", GitHub: "integration_github", Stripe: "integration_stripe",
  Notion: "integration_notion", n8n: "integration_n8n",
};

function header(color: string, name: string, kind: string, extra?: Node): HTMLElement {
  const id = BRAND_BY_NAME[name] ?? State.tasks.find((t) => t.name === name)?.id ?? "";
  const row = h("div", { class: "int-head" }, brandOrDot(id, color, 7), h("b", { text: name }), h("span", { text: kind }));
  if (extra) row.append(extra);
  return row;
}

/** Highlighted first row + plain rows, the layout every list card shares. */
function listRow(accent: string, first: boolean, ...children: Node[]): HTMLElement {
  const row = h("div", { class: first ? "int-row first" : "int-row" }, dot(accent, 5), ...children);
  if (first) row.style.background = `${accent}14`;
  return row;
}

function get(id: string): Record<string, unknown> {
  return (State.integrations[id]?.data ?? {}) as Record<string, unknown>;
}

function arr(id: string, key: string): Record<string, unknown>[] {
  const v = get(id)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

// ── Not configured / idle ─────────────────────────────────────────────────────

const OPEN_URLS: Record<string, string> = {
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
};

function idleCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const info = State.integrations[task.id];
  const configured = info?.configured ?? false;
  const error = info?.error ?? null;
  // The Claude Code pill is about hooks, not a key — the macOS wording would be
  // misleading here.
  const missing = task.id === "integration_claude" ? t("Hook non installati") : t("Chiave non configurata");
  const label = error ?? (configured ? "Connesso · caricamento…" : missing);
  const statusColor = error || !configured ? "#F4505E" : "#22C55E";

  const actions = h("div", { class: "int-actions" });
  if (task.id === "integration_claude") {
    // A session the hooks have seen goes back to its own app (Claude, VS Code,
    // a terminal); before any session, VS Code.
    const host = task.sessionHost;
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}b3`,
        text: host ? sessionOpenLabel(host) : t("Apri Visual Studio Code"),
        onclick: () => void (host
          ? Bridge.openSession(host, task.sessionCwd ?? null)
          : Bridge.openInVSCode(task.sessionCwd ?? null)),
      }),
    );
  } else if (task.id === "integration_n8n") {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: t("Apri n8n"),
        onclick: () => void Bridge.openN8n(),
      }),
    );
  } else if (OPEN_URLS[task.id]) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: t("Apri {name}", { name: task.name }),
        onclick: () => void Bridge.openUrl(OPEN_URLS[task.id]),
      }),
    );
  }
  if (configured) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: t("Aggiorna"),
        onclick: () => void Bridge.refreshIntegration(task.id),
      }),
    );
  } else {
    actions.append(
      h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }),
    );
  }

  return h(
    "div",
    { class: "int-card" },
    header(task.color, task.name, t("Integrazione")),
    h("div", { class: "int-status" }, dot(statusColor, 5), h("span", { text: label })),
    actions,
  );
}

// ── Vercel ────────────────────────────────────────────────────────────────────

function vercelCard(onDetail: () => void): HTMLElement {
  const deployments = arr("integration_vercel", "deployments");
  const rows = h("div", { class: "int-rows" });
  deployments.slice(0, 3).forEach((d, i) => {
    const accent = d.state === "READY" ? "#22C55E" : "#F4505E";
    const name = h("span", { class: "int-name", text: String(d.projectName ?? "") });
    const ago = h("span", { class: "int-ago", text: timeAgo(d.createdAt) });
    if (i === 0) {
      const more = h(
        "button",
        { class: "int-more", title: t("Dettagli"), onclick: onDetail },
        svg(ICONS.ellipsis, 12),
      );
      rows.append(listRow(accent, true, name, ago, more));
    } else {
      rows.append(listRow(accent, false, name, ago));
    }
  });
  return h("div", { class: "int-card" }, header("#7C5CFF", "Vercel", "Deploy"), rows);
}

function vercelDetail(onBack: () => void): HTMLElement {
  const d = arr("integration_vercel", "deployments")[0] ?? {};
  const success = d.state === "READY";
  const accent = success ? "#22C55E" : "#F4505E";
  const status = success ? t("Pronto") : d.state === "CANCELED" ? t("Annullato") : t("Errore");
  const body = h("div", { class: "int-detail-body" });
  if (d.commitMessage) body.append(h("div", { class: "int-commit", text: String(d.commitMessage) }));
  const meta = h("div", { class: "int-meta" });
  if (d.branch) meta.append(h("span", { text: String(d.branch) }));
  meta.append(h("span", { text: `${timeAgo(d.createdAt)} fa` }));
  body.append(meta);
  if (d.url) {
    body.append(
      h("button", {
        class: "int-link",
        text: String(d.url),
        onclick: () => void Bridge.openUrl(`https://${d.url}`),
      }),
    );
  }
  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 13, { stroke: 2.4 })),
      dot(accent, 6),
      h("b", { text: String(d.projectName ?? "Deploy") }),
      h("span", { class: "int-badge", style: `color:${accent};background:${accent}24`, text: status }),
    ),
    body,
  );
}

// ── Resend ────────────────────────────────────────────────────────────────────

function resendCard(): HTMLElement {
  const emails = arr("integration_resend", "emails");
  const total = get("integration_resend").total;
  const extra =
    total != null
      ? h("span", { class: "int-total" }, h("i", { class: "pulse" }), h("span", { text: String(total) }))
      : undefined;
  const rows = h("div", { class: "int-rows" });
  emails.slice(0, 3).forEach((e, i) => {
    const delivered = e.lastEvent === "delivered";
    const accent = delivered ? "#22C55E" : "#F4505E";
    const to = Array.isArray(e.to) ? String(e.to[0] ?? "?") : "?";
    const short = to.split("@")[0];
    const cells: Node[] = [
      h("span", { class: "int-name", text: short }),
      h("span", { class: "int-ago", text: timeAgo(e.createdAt) }),
    ];
    if (i === 0 && e.subject) cells.push(h("span", { class: "int-sub", text: String(e.subject) }));
    rows.append(listRow(accent, i === 0, ...cells));
  });
  return h("div", { class: "int-card" }, header("#22C55E", "Resend", t("Email"), extra), rows);
}

// ── GitHub ────────────────────────────────────────────────────────────────────

function statRow(icon: string, color: string, label: string, value: string): HTMLElement {
  return h(
    "div",
    { class: "int-stat" },
    h("i", { class: "int-stat-icon", style: `color:${color}` }, svg(icon, 10)),
    h("span", { class: "int-stat-label", text: label }),
    h("span", { class: "int-stat-value", text: value }),
  );
}

function githubCard(): HTMLElement {
  const d = get("integration_github");
  const stars = Number(d.totalStars ?? 0);
  const repos = Number(d.totalRepos ?? 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return h(
    "div",
    { class: "int-card" },
    header("#F4505E", "GitHub", t("Panoramica")),
    h(
      "div",
      { class: "int-stats" },
      statRow(ICONS.star, "#F5A524", t("Stelle totali"), fmt(stars)),
      statRow(ICONS.stack, "#6B7079", "Repository", String(repos)),
    ),
  );
}

// ── Stripe ────────────────────────────────────────────────────────────────────

function stripeCard(): HTMLElement {
  const d = get("integration_stripe");
  const balance = (Number(d.balance ?? 0) / 100).toFixed(2);
  const currency = String(d.currency ?? "eur").toUpperCase();
  const rows = h("div", { class: "int-rows tight" });
  for (const p of arr("integration_stripe", "payments")) {
    const success = p.status === "succeeded";
    const accent = success ? "#22C55E" : "#F4505E";
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot(accent, 5),
        h("span", { class: "int-name", text: String(p.description ?? t("Pagamento")) }),
        h("span", {
          class: "int-amount",
          style: "color:#22c55e",
          text: `+${(Number(p.amount ?? 0) / 100).toFixed(2)}`,
        }),
        h("span", { class: "int-ago", text: timeAgo(p.createdAt) }),
      ),
    );
  }
  return h(
    "div",
    { class: "int-card" },
    header("#0570DE", "Stripe", t("Pagamenti")),
    h("div", { class: "int-balance" }, h("span", { text: balance }), h("i", { text: currency })),
    rows,
  );
}

// ── Notion ────────────────────────────────────────────────────────────────────

/**
 * Notion (notion.rs): the user's tasks from the database chosen in the
 * settings (soonest first, ticked off with a click), "Nuova nota" into the
 * page or database chosen there, the pages the user keeps in the card, and a
 * search. A page opens in the Notion app when it is installed (lib.rs
 * open_url_now); the bubble sends its text to the chat. What is being typed
 * lives outside the card, which is rebuilt at every update.
 */
const notion = {
  query: "",
  found: null as NotionPage[] | null,
  busy: false,
  note: "",
  timer: 0,
  search: null as HTMLInputElement | null,
  /** "Nuova nota": open, its text, and how the last save went. */
  noteOpen: false,
  noteArea: null as HTMLTextAreaElement | null,
  noteState: "" as "" | "saving" | "saved" | "error",
  noteMsg: "",
  /** Tasks ticked off and waiting for Notion: hidden at once. */
  ticking: new Set<string>(),
  redraw: null as (() => void) | null,
};

function notionSearchSoon() {
  window.clearTimeout(notion.timer);
  const q = notion.query.trim();
  if (q.length < 2) {
    notion.found = null;
    notion.busy = false;
    notion.redraw?.();
    return;
  }
  notion.busy = true;
  notion.redraw?.();
  notion.timer = window.setTimeout(async () => {
    try {
      const found = await Bridge.notionSearch(q, 8);
      if (notion.query.trim() !== q) return;
      notion.found = found;
      notion.note = "";
    } catch (e) {
      notion.note = String(e).replace(/^Error:\s*/, "");
    }
    notion.busy = false;
    notion.redraw?.();
  }, 350);
}

interface NotionTask { id: string; title: string; url: string; due: string | null; canTick: boolean }

/** When a task is due, in words, and whether it is late. */
export function dueLabel(due: string | null, now = new Date()): { text: string; late: boolean; today: boolean } {
  if (!due) return { text: "", late: false, today: false };
  const hasTime = due.includes("T");
  const d = hasTime ? new Date(due) : new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { text: "", late: false, today: false };
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(now)) / 86_400_000);
  const time = hasTime ? ` ${d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}` : "";
  if (days < 0) return { text: days === -1 ? t("ieri") : t("{n} giorni fa", { n: -days }), late: true, today: false };
  if (days === 0) {
    const late = hasTime && d.getTime() < now.getTime();
    return { text: `${t("oggi")}${time}`, late, today: true };
  }
  if (days === 1) return { text: `${t("domani")}${time}`, late: false, today: false };
  return { text: d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }), late: false, today: false };
}

function notionCard(hooks: IntegrationCardHooks): HTMLElement {
  const cfg = State.settings.integrationConfig;
  const data = get("integration_notion");
  const all = arr("integration_notion", "tasks") as unknown as NotionTask[];
  for (const id of notion.ticking) if (!all.some((x) => x.id === id)) notion.ticking.delete(id);
  const tasks = all.filter((x) => !notion.ticking.has(x.id));
  const due = tasks.filter((x) => dueLabel(x.due).late || dueLabel(x.due).today).length;

  const body = h("div", { class: "notion-body" });
  const msg = h("div", { class: "notion-note" });
  const say = (text: string) => { msg.textContent = text; msg.style.display = text ? "" : "none"; };

  const search = notion.search ?? (notion.search = h("input", {
    class: "nc-input notion-search", placeholder: t("Cerca in Notion…"), spellcheck: "false",
    onpointerdown: () => void Bridge.focusWindow(true),
    oninput: (e: Event) => { notion.query = (e.target as HTMLInputElement).value; notionSearchSoon(); },
    onkeydown: (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key === "Escape" && notion.query) {
        k.stopPropagation();
        notion.query = "";
        (k.target as HTMLInputElement).value = "";
        notionSearchSoon();
      } else if (k.key === "Enter") {
        const first = (notion.found ?? [])[0];
        if (first) void Bridge.openUrl(first.url);
      }
    },
  }) as HTMLInputElement);

  const ask = async (p: { id: string }, b: HTMLElement) => {
    b.classList.add("working");
    try {
      const [title, text] = await Bridge.notionPageText(p.id);
      hooks.askAboutText(`Notion · ${title}`, text);
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""));
    } finally {
      b.classList.remove("working");
    }
  };

  const pageRow = (p: { id: string; title: string; emoji?: string | null; url: string; database?: boolean; lastEditedAt?: string }) => {
    const askBtn: HTMLElement | null = p.database ? null
      : iconButton(ICONS.bubble, t("Chiedi alla chat su questa pagina"), "#A78BFA", () => void ask(p, askBtn!));
    return h("div", { class: "int-page", role: "button", title: t("Apri in Notion"),
      onclick: () => { if (p.url) void Bridge.openUrl(p.url); } },
    p.emoji
      ? h("span", { class: "int-emoji", text: String(p.emoji) })
      : h("i", { class: "int-emoji" }, svg(p.database ? ICONS.stack : ICONS.doc, 11)),
    h("span", { class: "int-name", text: String(p.title || t("Senza titolo")) }),
    p.lastEditedAt ? h("span", { class: "int-ago", text: timeAgo(p.lastEditedAt) }) : null,
    askBtn ? h("span", { class: "notion-tools" }, askBtn) : null);
  };

  const taskRow = (x: NotionTask) => {
    const when = dueLabel(x.due);
    const tick = h("button", {
      class: "notion-tick", title: x.canTick ? t("Segna come fatta") : t("Questo database non ha una casella o uno stato «fatto»"),
      disabled: !x.canTick,
      onclick: async (e: Event) => {
        e.stopPropagation();
        notion.ticking.add(x.id);
        notion.redraw?.();
        try {
          await Bridge.notionTaskDone(x.id);
          Sound.play("approve");
        } catch (err) {
          notion.ticking.delete(x.id);
          say(String(err).replace(/^Error:\s*/, ""));
          notion.redraw?.();
        }
      },
    });
    return h("div", { class: "int-page notion-task", role: "button", title: t("Apri in Notion"),
      onclick: () => { if (x.url) void Bridge.openUrl(x.url); } },
    tick,
    h("span", { class: "int-name", text: x.title }),
    when.text ? h("span", { class: `notion-due${when.late ? " due-late" : when.today ? " due-today" : ""}`, text: when.text }) : null);
  };

  const noteBox = () => {
    const area = notion.noteArea ?? (notion.noteArea = h("textarea", {
      class: "nc-input notion-note-area", rows: "3", spellcheck: "true",
      placeholder: t("Scrivi la nota… (Ctrl+Invio per salvare)"),
      onpointerdown: () => void Bridge.focusWindow(true),
      onkeydown: (e: Event) => {
        const k = e as KeyboardEvent;
        if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) { k.preventDefault(); void saveNote(); }
        if (k.key === "Escape") { k.stopPropagation(); notion.noteOpen = false; notion.redraw?.(); }
      },
    }) as HTMLTextAreaElement);
    const saveNote = async () => {
      const text = area.value.trim();
      if (!text || notion.noteState === "saving") return;
      notion.noteState = "saving";
      notion.redraw?.();
      const now = new Date();
      const stamp = `${now.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
      try {
        const where = await Bridge.notionAddNote(text, stamp);
        area.value = "";
        notion.noteState = "saved";
        notion.noteMsg = t("Salvata in «{p}» ✓", { p: where });
        notion.noteOpen = false;
        Sound.play("approve");
      } catch (e) {
        notion.noteState = "error";
        notion.noteMsg = String(e).replace(/^Error:\s*/, "");
      }
      notion.redraw?.();
    };
    window.setTimeout(() => { if (area.isConnected && document.activeElement !== area) area.focus(); }, 0);
    return h("div", { class: "notion-compose" }, area,
      h("div", { class: "notion-compose-row" },
        h("span", { class: "notion-note", text: t("In «{p}»", { p: cfg.notionInbox?.title || "Notion" }) }),
        h("button", { class: "btn secondary", onclick: () => { notion.noteOpen = false; notion.redraw?.(); } }, h("span", { text: t("Annulla") })),
        h("button", { class: "btn primary", disabled: notion.noteState === "saving", onclick: () => void saveNote() },
          h("span", { text: notion.noteState === "saving" ? t("Salvo…") : t("Salva") }))));
  };

  const section = (label: string, extra?: Node | null) => h("div", { class: "notion-section" }, h("span", { text: label }), extra ?? null);

  const draw = () => {
    clear(body);
    say("");
    const searching = notion.query.trim().length >= 2;
    if (searching) {
      const list = notion.found ?? [];
      for (const p of list) body.append(pageRow(p));
      say(notion.note
        || (notion.busy ? t("Cerco…") : "")
        || (list.length === 0 ? t("Nessuna pagina trovata: l'integrazione vede solo le pagine condivise con lei.") : ""));
      return;
    }
    if (notion.noteOpen && cfg.notionInbox) body.append(noteBox());
    else if (notion.noteState === "saved" || notion.noteState === "error") {
      body.append(h("div", { class: `notion-note${notion.noteState === "error" ? " bad" : ""}`, text: notion.noteMsg }));
    }
    const shown = tasks.filter((x) => !notion.ticking.has(x.id));
    if (data.tasksSet) {
      const more = shown.length > 5 ? h("button", { class: "link-btn", text: t("tutte ({n})", { n: shown.length }),
        onclick: () => { if (cfg.notionTasks?.url) void Bridge.openUrl(cfg.notionTasks.url); } }) : null;
      body.append(section(t("Da fare"), more));
      if (typeof data.tasksError === "string" && data.tasksError) body.append(h("div", { class: "notion-note bad", text: data.tasksError }));
      else if (shown.length === 0) body.append(h("div", { class: "notion-note", text: t("Niente da fare ✓") }));
      for (const x of shown.slice(0, 5)) body.append(taskRow(x));
    }
    if (cfg.notionPins.length) {
      body.append(section(t("Pagine")));
      for (const p of cfg.notionPins.slice(0, 6)) body.append(pageRow(p));
    }
    if (!data.tasksSet && !cfg.notionPins.length && !cfg.notionInbox) {
      body.append(h("div", { class: "notion-note", text: t("Scegli nelle Impostazioni il database delle tue attività, le pagine da tenere qui e dove salvare le note.") }),
        h("button", { class: "btn secondary notion-setup", onclick: () => hooks.openSettings() }, h("span", { text: t("Impostazioni di Notion") })));
    }
  };
  notion.redraw = () => {
    // A tick or a note changes the header too: rebuild through the overview.
    draw();
    kind.textContent = sub();
  };

  const sub = () => (notion.query.trim().length >= 2 ? t("Risultati")
    : data.tasksSet ? (due ? t("{n} da fare oggi", { n: due }) : t("In ordine")) : t("Le tue pagine"));
  const noteBtn = cfg.notionInbox
    ? h("button", { class: "link-btn notion-new", style: "color:#E8E8E8d9", text: `+ ${t("Nota")}`, title: t("Nuova nota in «{p}»", { p: cfg.notionInbox.title }),
      onclick: () => { notion.noteOpen = !notion.noteOpen; notion.noteState = ""; notion.redraw?.(); } })
    : undefined;
  const head = header("#E8E8E8", "Notion", sub(), noteBtn);
  const kind = head.querySelector("span:last-of-type") ?? h("span");
  draw();
  // Put back into a rebuilt card: the search keeps the keyboard.
  if (notion.query) window.setTimeout(() => { if (search.isConnected) search.focus(); }, 0);
  return h("div", { class: "int-card notion-card" }, head, search, body, msg);
}

// ── Cal.com ───────────────────────────────────────────────────────────────────

function calcomCard(): HTMLElement {
  const bookings = arr("integration_calcom", "bookings")
    .slice()
    .sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());
  const rows = h("div", { class: "int-rows tight" });
  if (bookings.length === 0) {
    rows.append(h("div", { class: "int-empty", text: t("Nessuna chiamata in programma") }));
  }
  for (const b of bookings.slice(0, 3)) {
    const when = new Date(String(b.start));
    const day = when.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
    const time = when.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot("#C9956A", 4),
        h("span", { class: "int-time", text: `${day} ${time}` }),
        h("span", { class: "int-name", text: String(b.title ?? t("Riunione")) }),
      ),
    );
  }
  return h("div", { class: "int-card" }, header("#C9956A", "Cal.com", t("Agenda")), rows);
}

// ── n8n ───────────────────────────────────────────────────────────────────────

function n8nCard(task: AgentTask, onDetail: () => void, openSettings: () => void): HTMLElement {
  const hasActivity = task.steps.length > 0 && (task.state === "finished" || task.state === "error");
  if (!hasActivity) return idleCard(task, openSettings);
  const success = task.state === "finished";
  const accent = success ? "#22C55E" : "#F4505E";
  return h(
    "div",
    { class: "int-card" },
    header("#F29B38", "n8n", "Workflow"),
    h(
      "div",
      { class: "int-actions" },
      h(
        "button",
        {
          class: "int-pill",
          style: `background:${accent}1a;border-color:${accent}38`,
          onclick: onDetail,
        },
        dot(accent, 5),
        h("span", { class: "int-name", text: task.steps[0] ?? "Workflow" }),
        svg(ICONS.ellipsis, 12),
      ),
    ),
  );
}

function n8nDetail(task: AgentTask, onBack: () => void): HTMLElement {
  const success = task.state === "finished";
  const accent = success ? "#22C55E" : "#F4505E";
  const detail = task.steps[1];
  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 13, { stroke: 2.4 })),
      dot(accent, 6),
      h("b", { text: task.steps[0] ?? "Workflow" }),
      h("span", {
        class: "int-badge",
        style: `color:${accent};background:${accent}24`,
        text: success ? t("Riuscito") : t("Fallito"),
      }),
    ),
    detail
      ? h("pre", { class: "int-detail-text", text: detail })
      : h("div", {
          class: "int-status",
          text: success ? t("Completato con successo.") : t("Nessun dettaglio sull'errore."),
        }),
  );
}

// ── Appunti ───────────────────────────────────────────────────────────────────

/** Asks Rust once for a local integration's state (the card opens before any event). */
const requested = new Set<string>();
function ensureLoaded(id: string) {
  if (State.integrations[id]?.loaded || requested.has(id)) return;
  requested.add(id);
  void Bridge.refreshIntegration(id);
}

const TRANSFORMS: [string, string][] = [
  ["upper", t("MAIUSCOLO")], ["lower", t("minuscolo")], ["oneline", t("Una riga")],
  ["trim", t("Senza spazi")], ["json", "JSON"], ["urldecode", "URL"],
];

function iconButton(icon: string, title: string, color: string, onclick: (e: MouseEvent) => void, active = false): HTMLElement {
  return h("button", {
    class: active ? "clip-btn on" : "clip-btn",
    title, style: `--c:${color}`,
    onclick: (e: Event) => { e.stopPropagation(); onclick(e as MouseEvent); },
  }, svg(icon, 12));
}

/** An image of the history: thumbnail and size; copy, ask Claude, pin, delete. */
function clipboardPictureRow(task: AgentTask, it: Record<string, unknown>, hooks: IntegrationCardHooks): HTMLElement {
  const id = Number(it.id);
  const size = `${it.width} × ${it.height}`;
  const label = h("span", { class: "int-name", text: size });
  const flash = (text: string) => {
    label.textContent = text;
    window.setTimeout(() => { label.textContent = size; }, 1400);
  };
  const use = async (paste: boolean) => {
    try {
      await Bridge.clipboardUse(id, "", paste);
      flash(paste ? "Incollata ✓" : "Copiata ✓");
    } catch (e) {
      flash(String(e).replace(/^Error:\s*/, ""));
    }
  };
  const ask = async () => {
    try {
      hooks.askAboutPicture(await Bridge.clipboardAsk(id));
    } catch (e) {
      flash(String(e).replace(/^Error:\s*/, ""));
    }
  };
  const thumb = h("img", { class: "clip-thumb", src: String(it.thumb ?? ""), alt: "" });
  return h("div", { class: it.pinned ? "int-row clip-row clip-pic pinned" : "int-row clip-row clip-pic",
    title: t("Immagine {size} · clic: incolla nell'app in primo piano", { size }), onclick: () => void use(true) },
    dot(it.pinned ? task.color : "#5b5f67", 5), thumb, label,
    h("span", { class: "int-ago", text: timeAgo(it.at) }),
    h("span", { class: "clip-tools" },
      iconButton(ICONS.copy, t("Copia senza incollare"), "#38BDF8", () => void use(false)),
      iconButton(ICONS.bubble, t("Chiedi alla chat su questa immagine"), "#A78BFA", () => void ask()),
      iconButton(ICONS.pin, it.pinned ? t("Togli dai fissati") : t("Fissa in cima"), "#A78BFA",
        () => void Bridge.clipboardPin(id, !it.pinned), !!it.pinned),
      iconButton(ICONS.xmark, t("Elimina"), "#F4505E", () => void Bridge.clipboardRemove(id))));
}

function clipboardCard(task: AgentTask, hooks: IntegrationCardHooks): HTMLElement {
  ensureLoaded(task.id);
  const items = arr(task.id, "items");
  const extra = items.some((i) => !i.pinned)
    ? h("button", { class: "link-btn clip-clear", style: "color:#8e939c", text: t("Svuota"),
      onclick: () => void Bridge.clipboardClear() })
    : undefined;
  const rows = h("div", { class: "int-rows tight clip-list" });
  if (items.length === 0) {
    rows.append(h("div", { class: "int-empty", text: t("Copia un testo o un'immagine: lo ritrovi qui.") }));
  }
  for (const it of items) {
    if (it.kind === "image") {
      rows.append(h("div", { class: "clip-item" }, clipboardPictureRow(task, it, hooks)));
      continue;
    }
    const id = Number(it.id);
    const label = h("span", { class: "int-name", text: String(it.preview ?? "").replace(/\s+/g, " ") });
    const lines = Number(it.lines ?? 1);
    const meta = h("span", { class: "int-ago", text: lines > 1 ? `${lines} righe` : timeAgo(it.at) });
    const flash = (text: string) => {
      label.textContent = text;
      window.setTimeout(() => { label.textContent = String(it.preview ?? "").replace(/\s+/g, " "); }, 1400);
    };
    const use = async (transform: string, paste: boolean) => {
      try {
        await Bridge.clipboardUse(id, transform, paste);
        flash(paste ? "Incollato ✓" : "Copiato ✓");
      } catch (e) {
        flash(String(e));
      }
    };
    const chips = h("div", { class: "clip-chips" });
    chips.style.display = "none";
    for (const [key, name] of TRANSFORMS) {
      chips.append(h("button", { class: "clip-chip", text: name,
        onclick: (e: Event) => { e.stopPropagation(); void use(key, true); } }));
    }
    const row = h("div", { class: it.pinned ? "int-row clip-row pinned" : "int-row clip-row",
      title: t("Clic: incolla nell'app in primo piano"), onclick: () => void use("", true) },
      dot(it.pinned ? task.color : "#5b5f67", 5), label, meta,
      h("span", { class: "clip-tools" },
        iconButton(ICONS.copy, t("Copia senza incollare"), "#38BDF8", () => void use("", false)),
        iconButton(ICONS.ellipsis, t("Trasforma e incolla"), "#F5A524", () => {
          chips.style.display = chips.style.display === "none" ? "" : "none";
        }),
        iconButton(ICONS.pin, it.pinned ? t("Togli dai fissati") : t("Fissa in cima"), "#A78BFA",
          () => void Bridge.clipboardPin(id, !it.pinned), !!it.pinned),
        iconButton(ICONS.xmark, t("Elimina"), "#F4505E", () => void Bridge.clipboardRemove(id))));
    rows.append(h("div", { class: "clip-item" }, row, chips));
  }
  return h("div", { class: "int-card" }, header(task.color, t("Appunti"), t("Cronologia"), extra), rows);
}

// ── Musica ────────────────────────────────────────────────────────────────────

function mmss(s: number): string {
  const secs = Math.max(0, Math.floor(s));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function mediaCard(task: AgentTask): HTMLElement {
  ensureLoaded(task.id);
  const d = get(task.id);
  if (!d.active) {
    return h("div", { class: "int-card" }, header(task.color, t("Media"), t("In riproduzione")),
      h("div", { class: "int-status" }, dot("#5b5f67", 5),
        h("span", { text: State.integrations[task.id]?.loaded ? t("Niente in riproduzione") : t("Cerco un lettore…") })));
  }
  const playing = !!d.playing;
  const duration = Number(d.duration ?? 0);
  // The cover fills the card behind everything, clear at the top and fading
  // out towards the middle, where the song and the buttons are.
  const backdrop = h("div", { class: "media-backdrop" });
  if (typeof d.cover === "string" && d.cover) backdrop.style.backgroundImage = `url(${JSON.stringify(d.cover)})`;
  else backdrop.style.background = `radial-gradient(120% 90% at 50% 0%, ${task.color}55, transparent 70%)`;
  const sub = [d.artist, d.app].filter((x) => typeof x === "string" && x).join(" · ");

  // The position ticks on here between the (rare) updates from Rust.
  const fill = h("i", { class: "media-fill", style: `background:${task.color}` });
  const time = h("span", { class: "media-time", text: "" });
  const left = h("span", { class: "media-time", text: "" });
  const start = Number(d.position ?? 0);
  const t0 = performance.now();
  const tick = () => {
    const pos = Math.min(duration, start + (playing ? (performance.now() - t0) / 1000 : 0));
    fill.style.width = duration > 0 ? `${(pos / duration) * 100}%` : "0";
    left.textContent = duration > 0 ? mmss(pos) : "";
    time.textContent = duration > 0 ? mmss(duration) : "";
  };
  tick();
  if (playing && duration > 0) {
    const timer = window.setInterval(() => {
      if (!fill.isConnected) { window.clearInterval(timer); return; }
      tick();
    }, 1000);
  }

  const ctl = (icon: string, title: string, cmd: string, enabled = true, main = false) =>
    h("button", { class: main ? "media-btn main" : "media-btn", title, disabled: !enabled,
      onclick: () => void Bridge.mediaCommand(cmd), style: `--c:${task.color}` }, svg(icon, main ? 18 : 14));

  return h("div", { class: "int-card media-card" },
    backdrop,
    header(task.color, t("Media"), playing ? t("In riproduzione") : t("In pausa")),
    h("div", { class: "media-info" },
      h("b", { class: "media-title", text: String(d.title ?? "") }),
      h("span", { class: "media-sub", text: sub })),
    h("div", { class: "media-progress" }, left, h("div", { class: "media-bar" }, fill), time),
    h("div", { class: "media-ctl" },
      ctl(ICONS.prev, t("Precedente"), "prev", !!d.canPrev),
      ctl(playing ? ICONS.pause : ICONS.play, playing ? t("Pausa") : t("Riproduci"), "toggle", true, true),
      ctl(ICONS.next, t("Successivo"), "next", !!d.canNext)));
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export interface IntegrationCardHooks {
  detailOpen: boolean;
  openDetail(): void;
  closeDetail(): void;
  openSettings(): void;
  /** Appunti: open the chat with a picture of the history attached. */
  askAboutPicture(f: { name: string; path: string }): void;
  /** Notion: open the chat with a page's text attached, waiting for the question. */
  askAboutText(label: string, text: string): void;
}

/** True when this integration has data worth showing instead of the idle card. */
export function hasIntegrationData(id: string): boolean {
  const info = State.integrations[id];
  if (!info || info.error) return false;
  switch (id) {
    case "integration_vercel":
      return arr(id, "deployments").length > 0;
    case "integration_resend":
      return arr(id, "emails").length > 0;
    case "integration_github":
      return get(id).totalRepos != null;
    case "integration_stripe":
      return info.loaded;
    case "integration_notion":
      return info.loaded;
    case "integration_calcom":
      return info.loaded;
    default:
      return false;
  }
}

const WIDGET_KIND: Record<string, string> = {
  ping: "Ping", tcp: t("Porta"), http: t("Sito web"), tls: t("Certificato"), service: t("Servizio"), json: "API",
  calendar: t("Calendario"), domain: t("Domini"),
};

const LEVEL_COLOR = { ok: "#22C55E", warn: "#F5A524", error: "#F4505E" } as const;

function copyInfoButton(color: string): HTMLElement {
  const b = h("button", { class: "link-btn", style: `color:${color}d9`, text: t("Copia info PC") }) as HTMLButtonElement;
  b.addEventListener("click", async () => {
    b.disabled = true;
    b.textContent = t("Raccolgo…");
    try {
      await Bridge.copyPcInfo();
      b.textContent = t("Copiato ✓");
    } catch {
      b.textContent = t("Non riuscito");
    }
    window.setTimeout(() => { b.textContent = t("Copia info PC"); b.disabled = false; }, 2200);
  });
  return b;
}

/**
 * A configurable widget, or an integration run as a check (Stato del PC,
 * Outlook, Zammad…): status line, its fields, Aggiorna.
 */
function widgetCard(task: AgentTask, openSettings: () => void, openDetail?: () => void): HTMLElement {
  const isWidget = task.id.startsWith("widget:");
  const id = isWidget ? task.id.slice("widget:".length) : task.id;
  const kind = isWidget
    ? (State.settings.widgets ?? []).find((w) => w.id === id)?.kind ?? ""
    : PROBE_INTEGRATIONS[task.id] ?? "";
  const st = State.widgetStatus[id];
  const rows = h("div", { class: "int-rows tight" });
  // Every field, each value wrapping onto more lines when long: the island
  // grows to show them all (see the overview's fitHeight).
  for (const f of st?.fields ?? []) {
    rows.append(h("div", { class: "int-row w-field" },
      h("span", { class: "int-name", text: f.label }),
      h("span", { class: "w-value", text: f.value })));
  }
  const color = st ? LEVEL_COLOR[st.level] : "#8E939C";
  return h(
    "div",
    { class: "int-card" },
    header(task.color, task.name, isWidget ? WIDGET_KIND[kind] ?? "Widget" : t("Integrazione"),
      st ? h("span", { class: "int-ago", text: timeAgo(st.at * 1000) }) : undefined),
    h("div", { class: "int-status wrap" }, dot(color, 5),
      h("span", { text: st?.summary ?? t("In attesa del primo controllo…") })),
    rows,
    // Rete: a continuous ping in a terminal, and the adapter's settings.
    kind === "network" ? pingRow(task.color) : null,
    h("div", { class: "int-actions" },
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: t("Aggiorna"),
        onclick: () => void Bridge.widgetRefresh(id) }),
      kind === "network" && openDetail
        ? h("button", { class: "link-btn", style: `color:${task.color}d9`, text: t("Modifica rete…"),
          onclick: () => { resetNetConfig(); openDetail(); } })
        : null,
      // Everything a ticket asks for (name, serial, IP, Windows…), one click.
      kind === "system" || kind === "network" ? copyInfoButton(task.color) : null,
      kind === "zammad"
        ? h("button", { class: "link-btn", style: `color:${task.color}d9`, text: t("Apri Zammad"),
          onclick: () => void Bridge.openZammad() })
        : null,
      h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }),
    ),
  );
}

/** An agent (opencode, Codex…) between sessions: no keys, nothing to configure here. */
function agentIdleCard(task: AgentTask): HTMLElement {
  const name = task.agentName ?? task.name;
  const when = task.lastActive ? t("ultima attività {ago}", { ago: timeAgo(task.lastActive) }) : t("nessuna sessione da quando EasyIsland è aperto");
  return h("div", { class: "int-card" },
    header(task.color, name, t("In attesa")),
    h("div", { class: "int-rows" },
      h("div", { class: "int-empty", text: t("Nessuna sessione in corso: {when}.", { when }) })));
}

export function renderIntegrationCard(task: AgentTask, hooks: IntegrationCardHooks): HTMLElement {
  if (task.id.startsWith("agent:")) return agentIdleCard(task);
  if (task.id === "integration_clipboard") return clipboardCard(task, hooks);
  if (task.id === "integration_media") return mediaCard(task);
  if (task.id === THREECX) return threecxCard(task, hooks.openSettings);
  if (task.id === "integration_weather") {
    const card = weatherCard(task, hooks.openSettings);
    if (card) return card;
  }
  if (task.id === "integration_network" && hooks.detailOpen) return netConfigCard(task.color, hooks.closeDetail);
  if (task.id.startsWith("widget:") || PROBE_INTEGRATIONS[task.id]) {
    return widgetCard(task, hooks.openSettings, task.id === "integration_network" ? hooks.openDetail : undefined);
  }
  if (task.id === "integration_n8n") {
    const hasActivity = task.steps.length > 0 && (task.state === "finished" || task.state === "error");
    return hooks.detailOpen && hasActivity
      ? n8nDetail(task, hooks.closeDetail)
      : n8nCard(task, hooks.openDetail, hooks.openSettings);
  }
  if (task.id === "integration_vercel" && hasIntegrationData(task.id)) {
    return hooks.detailOpen ? vercelDetail(hooks.closeDetail) : vercelCard(hooks.openDetail);
  }
  if (!hasIntegrationData(task.id)) return idleCard(task, hooks.openSettings);

  switch (task.id) {
    case "integration_resend":
      return resendCard();
    case "integration_github":
      return githubCard();
    case "integration_stripe":
      return stripeCard();
    case "integration_notion":
      return notionCard(hooks);
    case "integration_calcom":
      return calcomCard();
    default:
      return idleCard(task, hooks.openSettings);
  }
}

export { clear };
