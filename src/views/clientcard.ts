// Scheda cliente (src-tauri/src/clients.rs): Panoramica-styled sheet showing a
// customer's memory page (`tipo: cliente` + sections Contatti, Rete, Server e
// VM, Accessi, Procedure, Note), prefilled creation / legacy-page upgrade,
// live RDM/Zammad/3CX cross-actions, chat context handoff, and editable .md access.

import { h, clear, svg, dot } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, type ClientCard, type TicketHit } from "../core/bridge";
import { t } from "../core/i18n";
import { inline } from "../core/markdown";
import { Sound } from "../core/sound";

export interface ClientSeed {
  contactName?: string;
  email?: string;
  phone?: string;
  contacts?: string[];
  access?: string[];
  nodeId?: string;
  source?: "zammad" | "threecx" | "rdm" | "search";
}

export interface ClientSheetActions {
  openRdm(name: string, linked?: { vault: string; path: string } | null): void;
  openZammad(name: string, ticket?: { id: number; title: string }): void;
  open3cx(): void;
  askChat(label: string, text: string): void;
  onSync?: () => void;
}

const LEGAL_FORMS = new Set(["srl", "srls", "spa", "sas", "snc", "sa", "di", "e", "studio", "ditta"]);
const FIXED_SECTIONS = ["Contatti", "Rete", "Server e VM", "Accessi", "Procedure", "Note"];
const SECTION_ICONS: Record<string, string> = {
  Contatti: ICONS.people,
  Rete: ICONS.rdmVpn,
  "Server e VM": ICONS.rdmRdp,
  Accessi: ICONS.rdmKey,
  Procedure: ICONS.doc,
  Note: ICONS.pencil,
};

function foldWords(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_FORMS.has(w));
}

function memorySlug(title: string): string {
  let out = "";
  for (const ch of title.trim().toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
    else if (out && !out.endsWith("-")) out += "-";
  }
  out = out.replace(/-+$/, "").slice(0, 80);
  if (!out) return "pagina";
  return out;
}

function findRdmFolder(name: string, aliases: string[] = []): { customer: string; vault: string; path: string } | null {
  const ties = State.settings.integrationConfig.rdmFolders ?? {};
  const candidates = [name, ...aliases].map((x) => x.trim()).filter(Boolean);
  for (const c of candidates) {
    const exact = ties[c.toLowerCase()];
    if (exact) return { customer: c, vault: exact.vault, path: exact.path };
  }
  for (const c of candidates) {
    const cw = foldWords(c);
    if (!cw.length) continue;
    for (const [k, f] of Object.entries(ties)) {
      const kw = foldWords(k);
      if (kw.length && cw.every((w) => kw.includes(w))) {
        return { customer: k, vault: f.vault, path: f.path };
      }
    }
  }
  return null;
}

function rdmActiveNow(): boolean {
  return State.settings.activeIntegrations.includes("integration_rdm")
    || !!State.settings.integrationConfig.rdmDataSource
    || !!State.integrations.integration_rdm?.configured;
}

function zammadActiveNow(): boolean {
  return State.settings.activeIntegrations.includes("integration_zammad");
}

function threecxActiveNow(): boolean {
  return State.settings.activeIntegrations.includes("integration_3cx");
}

function extractPhone(card: ClientCard | null, seed: ClientSeed): string {
  if (seed.phone?.trim()) return seed.phone.trim();
  const re = /(\+?\d[\d\s.\-()]{5,}\d)/;
  for (const line of seed.contacts ?? []) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  const contacts = card?.sections.find((s) => s.name.toLowerCase() === "contatti")?.text ?? "";
  for (const line of contacts.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

function buildExtras(name: string, card: ClientCard | null, seed: ClientSeed): { contacts: string[]; access: string[] } {
  const contacts: string[] = [];
  const pushContact = (line: string) => {
    const clean = line.trim().replace(/^-\s*/, "");
    if (!clean) return;
    if (!contacts.some((x) => x.toLowerCase() === clean.toLowerCase())) contacts.push(clean);
  };
  for (const c of seed.contacts ?? []) pushContact(c);
  const parts = [
    seed.contactName && seed.contactName.trim().toLowerCase() !== name.trim().toLowerCase() ? seed.contactName.trim() : "",
    seed.email?.trim() ?? "",
    seed.phone?.trim() ?? "",
  ].filter(Boolean);
  if (parts.length) pushContact(parts.join(" · "));

  const access: string[] = [];
  const pushAccess = (line: string) => {
    const clean = line.trim().replace(/^-\s*/, "");
    if (!clean) return;
    if (!access.some((x) => x.toLowerCase() === clean.toLowerCase())) access.push(clean);
  };
  for (const a of seed.access ?? []) pushAccess(a);
  const rdm = findRdmFolder(card?.title ?? name, card?.aliases);
  if (rdm) pushAccess(t("Cartella RDM: {p}", { p: rdm.path }));

  return { contacts, access };
}

function missingExtras(card: ClientCard, extra: { contacts: string[]; access: string[] }): { contacts: string[]; access: string[] } {
  const secText = (sec: string) => (card.sections.find((s) => s.name.toLowerCase() === sec.toLowerCase())?.text ?? "").toLowerCase();
  const cText = secText("contatti");
  const aText = secText("accessi");
  return {
    contacts: extra.contacts.filter((c) => !cText.includes(c.toLowerCase())),
    access: extra.access.filter((a) => !aText.includes(a.toLowerCase())),
  };
}

function cardToContext(name: string, card: ClientCard | null, seed: ClientSeed): string {
  const out: string[] = [`# ${card?.title ?? name}`];
  if (card?.aliases.length) out.push(`Alias: ${card.aliases.join(", ")}`);
  if (card?.intro) out.push("", card.intro);
  if (card) {
    for (const s of card.sections) {
      if (!s.text.trim()) continue;
      out.push("", `## ${s.name}`, s.text);
    }
  } else {
    const extra = buildExtras(name, null, seed);
    if (extra.contacts.length) out.push("", "## Contatti", ...extra.contacts.map((c) => `- ${c}`));
    if (extra.access.length) out.push("", "## Accessi", ...extra.access.map((a) => `- ${a}`));
  }
  return out.join("\n").slice(0, 6000);
}

let activeOpener: ((name: string, seed?: ClientSeed) => void) | null = null;

/** Opens the Scheda cliente overlay in the island for `name` (with optional seed data). */
export function openClientCard(name: string, seed: ClientSeed = {}) {
  if (!name.trim()) return;
  activeOpener?.(name.trim(), seed);
}

export class ClientSheet {
  el: HTMLElement;
  private cardEl: HTMLElement;
  private bodyEl: HTMLElement;
  private shown = false;
  private stack: { name: string; seed: ClientSeed }[] = [];
  private name = "";
  private seed: ClientSeed = {};
  private loading = false;
  private saving = false;
  private card: ClientCard | null = null;
  private tickets: TicketHit[] | null = null;
  private note = "";
  private err = "";

  constructor(private actions: ClientSheetActions) {
    this.bodyEl = h("div", { class: "cli-body" });
    this.cardEl = h("div", {
      class: "cli-sheet-card",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("Scheda cliente"),
      onclick: (e: Event) => e.stopPropagation(),
    }, this.bodyEl);
    this.el = h("div", {
      class: "cli-sheet",
      onclick: () => this.hide(),
    }, this.cardEl);
    this.el.style.display = "none";
    activeOpener = (name, seed) => void this.open(name, seed);
  }

  get openState(): boolean {
    return this.shown;
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.stack = [];
    this.el.style.display = "none";
    this.actions.onSync?.();
  }

  async open(name: string, seed: ClientSeed = {}, pushHistory = false) {
    if (pushHistory && this.name && this.name.toLowerCase() !== name.toLowerCase()) {
      this.stack.push({ name: this.name, seed: this.seed });
    } else if (!pushHistory) {
      this.stack = [];
    }
    this.shown = true;
    this.el.style.display = "";
    this.name = name;
    this.seed = seed;
    this.loading = true;
    this.saving = false;
    this.card = null;
    this.tickets = null;
    this.note = "";
    this.err = "";
    this.draw();
    this.actions.onSync?.();

    const loaded = await Bridge.clientCard(name).catch(() => null);
    if (!this.shown || this.name !== name) return;
    this.card = loaded;
    this.loading = false;
    this.draw();

    const queryName = loaded?.title || name;
    if (zammadActiveNow()) {
      void Bridge.zammadSearch(queryName)
        .then((hits) => {
          if (!this.shown || this.name !== name) return;
          this.tickets = hits ?? [];
          this.draw();
        })
        .catch(() => {
          if (!this.shown || this.name !== name) return;
          this.tickets = [];
          this.draw();
        });
    }
  }

  private async makeClient(extra: { contacts: string[]; access: string[] }) {
    if (this.saving) return;
    this.saving = true;
    this.err = "";
    this.note = "";
    this.draw();
    try {
      const targetName = this.card?.title || this.name;
      const made = await Bridge.clientPageMake(targetName, {
        contacts: extra.contacts,
        access: extra.access,
      });
      this.card = made;
      this.note = t("Pagina cliente salvata nella memoria ✓");
      Sound.play("blip");
    } catch (e) {
      this.err = String(e).replace(/^Error:\s*/, "");
      Sound.play("error");
    }
    this.saving = false;
    this.draw();
  }

  private renderRichLine(line: string): HTMLElement {
    const wrap = h("div", { class: "cli-line md" });
    const parts = line.split(/(\[\[[^\]]+\]\])/g);
    for (const part of parts) {
      const m = part.match(/^\[\[([^\]]+)\]\]$/);
      if (m) {
        const target = m[1].trim();
        wrap.append(h("button", {
          class: "cli-wiki",
          text: target,
          title: t("Apri «{name}»", { name: target }),
          onclick: (e: Event) => {
            e.stopPropagation();
            void this.open(target, { source: "search" }, true);
          },
        }));
      } else if (part) {
        wrap.append(...inline(part, { openUrl: (url) => void Bridge.openUrl(url) }));
      }
    }
    return wrap;
  }

  private draw() {
    clear(this.bodyEl);
    const c = this.card;
    const displayName = c?.title || this.name;
    const nodeId = this.seed.nodeId || `p:${memorySlug(displayName)}`;
    const rdm = findRdmFolder(displayName, c?.aliases);
    const phone = extractPhone(c, this.seed);
    const extra = buildExtras(displayName, c, this.seed);
    const missing = c ? missingExtras(c, extra) : extra;

    // ── Header ──
    const statusPill = this.loading
      ? h("span", { class: "cli-status wait", text: t("Cerco in memoria…") })
      : !c
        ? h("span", { class: "cli-status none", text: t("Nessuna pagina in memoria") })
        : c.client
          ? h("span", { class: "cli-status ok", text: "tipo: cliente" })
          : h("span", { class: "cli-status warn", text: t("Pagina senza sezioni") });

    const head = h("div", { class: "cli-head" },
      h("div", { class: "cli-head-left" },
        this.stack.length
          ? h("button", {
            class: "rdm-back-btn cli-back",
            title: t("Torna indietro"),
            onclick: () => {
              const prev = this.stack.pop();
              if (prev) void this.open(prev.name, prev.seed, false);
            },
          }, svg(ICONS.chevronLeft, 12, { stroke: 2 }), h("span", { text: this.stack[this.stack.length - 1].name }))
          : null,
        h("span", { class: "rdm-kicker", text: t("SCHEDA CLIENTE · MEMORIA") }),
        h("div", { class: "cli-title-row" },
          h("span", { class: "cli-avatar", text: displayName.slice(0, 2).toUpperCase() }),
          h("b", { class: "cli-title", text: displayName }),
          statusPill),
        c?.aliases.length || c?.updated || rdm
          ? h("div", { class: "cli-subline" },
            ...c?.aliases.map((a) => h("span", { class: "cli-alias", text: a })) ?? [],
            rdm ? h("span", { class: "cli-rdm-tag" }, svg(ICONS.rdmFolder, 10, { stroke: 1.8 }), h("span", { text: rdm.path })) : null,
            c?.updated ? h("span", { class: "cli-updated", text: t("aggiornato {d}", { d: c.updated }) }) : null)
          : null),
      h("div", { class: "cli-head-acts" },
        c ? h("button", {
          class: "rdm-icon-act",
          title: t("Apri file .md nella cartella"),
          onclick: () => void Bridge.memoryNodeOpen(nodeId),
        }, svg(ICONS.pencil, 13)) : null,
        c ? h("button", {
          class: "rdm-icon-act",
          title: t("Apri nella Mappa della memoria"),
          onclick: () => void Bridge.memoryWindowSelect(nodeId),
        }, svg(ICONS.memory, 13, { stroke: 1.8 })) : null,
        h("button", {
          class: "kbd-close",
          title: t("Chiudi (Esc)"),
          "aria-label": t("Chiudi"),
          onclick: () => this.hide(),
        }, svg(ICONS.xmark, 13))));

    this.bodyEl.append(head);

    // ── Primary actions strip ──
    const actBtn = (icon: string, label: string, opts: { primary?: boolean; disabled?: boolean; title?: string; onclick: () => void }) =>
      h("button", {
        class: opts.primary ? "cli-act primary" : "cli-act",
        disabled: opts.disabled ? "true" : undefined,
        title: opts.title ?? label,
        onclick: (e: Event) => { e.stopPropagation(); opts.onclick(); },
      }, svg(icon, 13, { stroke: 1.8 }), h("span", { text: label }));

    const actions = h("div", { class: "cli-actions" },
      actBtn(ICONS.rdmRdp, rdm ? t("Connessioni RDM · {f}", { f: rdm.path.split("\\").pop() ?? rdm.path }) : t("Connessioni RDM"), {
        disabled: !rdmActiveNow(),
        title: rdmActiveNow() ? t("Apri connessioni di «{name}» in RDM", { name: displayName }) : t("Remote Desktop Manager non attivo"),
        onclick: () => {
          this.hide();
          this.actions.openRdm(displayName, rdm ? { vault: rdm.vault, path: rdm.path } : null);
        },
      }),
      actBtn(ICONS.mail, t("Ticket Zammad"), {
        disabled: !zammadActiveNow(),
        title: zammadActiveNow() ? t("Cerca ticket di «{name}» in Zammad", { name: displayName }) : t("Zammad non attivo"),
        onclick: () => {
          this.hide();
          this.actions.openZammad(displayName);
        },
      }),
      phone
        ? actBtn(ICONS.phone, threecxActiveNow() ? t("Chiama {n}", { n: phone }) : phone, {
          title: threecxActiveNow() ? t("Avvia chiamata 3CX verso {n}", { n: phone }) : t("Copia numero {n}", { n: phone }),
          onclick: () => {
            if (threecxActiveNow()) {
              void Bridge.threecxCall(phone, State.settings.integrationConfig?.threecxDevice || null)
                .then(() => { this.hide(); this.actions.open3cx(); })
                .catch((e) => { this.err = String(e).replace(/^Error:\s*/, ""); this.draw(); });
            } else {
              void navigator.clipboard.writeText(phone).then(() => {
                this.note = t("Numero copiato ✓");
                this.draw();
              });
            }
          },
        })
        : null,
      actBtn(ICONS.bubble, t("Chiedi alla chat"), {
        primary: !!c,
        title: t("Apri una chat con questa scheda cliente come contesto"),
        onclick: () => {
          const ctx = cardToContext(displayName, c, this.seed);
          this.hide();
          this.actions.askChat(t("Cliente · {name}", { name: displayName }), ctx);
        },
      }));

    if (c) {
      actions.append(actBtn(ICONS.memory, t("Apri nella Memoria"), {
        title: t("Mostra nella finestra Mappa della memoria"),
        onclick: () => void Bridge.memoryWindowSelect(nodeId),
      }));
    }

    this.bodyEl.append(actions);

    if (this.note) this.bodyEl.append(h("div", { class: "cli-feedback ok", text: this.note }));
    if (this.err) this.bodyEl.append(h("div", { class: "cli-feedback bad", text: this.err }));

    const scroll = h("div", { class: "cli-scroll" });

    if (this.loading) {
      scroll.append(h("div", { class: "cli-skel" },
        h("div", { class: "rdm-skel" }),
        h("div", { class: "rdm-skel" })));
      this.bodyEl.append(scroll);
      return;
    }

    // ── Missing page -> Prefilled creation card ──
    if (!c) {
      const prefillRows: HTMLElement[] = [];
      for (const line of extra.contacts) {
        prefillRows.push(h("div", { class: "cli-prefill-row" },
          h("span", { class: "cli-prefill-k", text: "Contatti" }),
          h("span", { class: "cli-prefill-v", text: line })));
      }
      for (const line of extra.access) {
        prefillRows.push(h("div", { class: "cli-prefill-row" },
          h("span", { class: "cli-prefill-k", text: "Accessi" }),
          h("span", { class: "cli-prefill-v", text: line })));
      }
      scroll.append(h("div", { class: "cli-callout create" },
        h("div", { class: "cli-callout-text" },
          h("b", { text: t("Crea la pagina cliente per «{name}»", { name: displayName }) }),
          h("span", { text: t("Salva una scheda Markdown nella Memoria con le 6 sezioni fisse (Contatti, Rete, Server e VM, Accessi, Procedure, Note), modificabile in qualsiasi momento.") })),
        prefillRows.length ? h("div", { class: "cli-prefill-box" },
          h("div", { class: "cli-prefill-title", text: t("Dati pronti da inserire:") }),
          ...prefillRows) : null,
        h("div", { class: "cli-callout-acts" },
          h("button", {
            class: "btn primary",
            disabled: this.saving ? "true" : undefined,
            text: this.saving ? t("Creo la pagina…") : t("Crea pagina cliente"),
            onclick: () => void this.makeClient(extra),
          }))));
      this.bodyEl.append(scroll);
      return;
    }

    // ── Legacy page without tipo: cliente ──
    if (!c.client) {
      scroll.append(h("div", { class: "cli-callout upgrade" },
        h("div", { class: "cli-callout-text" },
          h("b", { text: t("Pagina esistente senza struttura cliente") }),
          h("span", { text: t("Aggiunge «tipo: cliente» e le sezioni fisse in coda senza rimuovere o spostare il testo già presente.") })),
        h("div", { class: "cli-callout-acts" },
          h("button", {
            class: "btn primary",
            disabled: this.saving ? "true" : undefined,
            text: this.saving ? t("Aggiorno…") : t("Rendila pagina cliente"),
            onclick: () => void this.makeClient(extra),
          }))));
    } else if (missing.contacts.length || missing.access.length) {
      const summary = [...missing.contacts, ...missing.access].join(" · ");
      scroll.append(h("div", { class: "cli-callout sync" },
        h("div", { class: "cli-callout-text" },
          h("b", { text: t("Nuovi dati rilevati dalla scheda aperta") }),
          h("span", { text: summary })),
        h("button", {
          class: "ei-empty-btn primary",
          disabled: this.saving ? "true" : undefined,
          text: this.saving ? t("Salvo…") : t("Aggiungi alla pagina"),
          onclick: () => void this.makeClient(missing),
        })));
    }

    // ── Intro ──
    if (c.intro) {
      scroll.append(h("div", { class: "cli-intro" }, this.renderRichLine(c.intro)));
    }

    // ── Populated sections & empty fixed placeholders ──
    const filled = c.sections.filter((s) => s.text.trim().length > 0);
    const emptyFixed = c.sections.filter((s) => !s.text.trim() && FIXED_SECTIONS.includes(s.name));

    if (filled.length) {
      const grid = h("div", { class: "cli-sections" });
      for (const s of filled) {
        const icon = SECTION_ICONS[s.name] ?? ICONS.doc;
        const lines = s.text.split("\n").map((l) => l.trim()).filter(Boolean);
        const body = h("div", { class: "cli-sec-body" });
        for (const l of lines) {
          const clean = l.replace(/^-\s+/, "");
          const isBullet = l.startsWith("- ");
          const row = this.renderRichLine(clean);
          if (isBullet) row.classList.add("is-bullet");
          body.append(row);
        }
        grid.append(h("section", { class: "cli-sec" },
          h("header", { class: "cli-sec-head" },
            svg(icon, 12, { stroke: 1.8 }),
            h("span", { text: s.name }),
            s.name === "Accessi" && rdm
              ? h("button", {
                class: "link-btn cli-sec-act",
                text: t("Apri cartella →"),
                onclick: () => {
                  this.hide();
                  this.actions.openRdm(displayName, { vault: rdm.vault, path: rdm.path });
                },
              })
              : null),
          body));
      }
      scroll.append(grid);
    }

    if (emptyFixed.length) {
      scroll.append(h("div", { class: "cli-empty-secs" },
        h("span", { class: "rdm-kicker", text: t("Sezioni ancora vuote (modifica il .md)") }),
        h("div", { class: "cli-empty-chips" },
          ...emptyFixed.map((s) => h("button", {
            class: "cli-empty-chip",
            title: t("Apri file .md per compilare «{s}»", { s: s.name }),
            onclick: () => void Bridge.memoryNodeOpen(nodeId),
          }, svg(SECTION_ICONS[s.name] ?? ICONS.doc, 11, { stroke: 1.7 }), h("span", { text: s.name }))))));
    }

    // ── Live Zammad tickets preview ──
    if (zammadActiveNow() && this.tickets && this.tickets.length) {
      const tkList = h("div", { class: "cli-tickets" },
        h("div", { class: "cli-block-head" },
          h("span", { class: "rdm-kicker", text: t("Ticket Zammad recenti ({n})", { n: this.tickets.length }) }),
          h("button", {
            class: "link-btn",
            text: t("Vedi tutti in Zammad →"),
            onclick: () => { this.hide(); this.actions.openZammad(displayName); },
          })));
      for (const tk of this.tickets.slice(0, 4)) {
        const idMatch = Number(tk.url.match(/zoom\/(\d+)/)?.[1] ?? 0);
        tkList.append(h("button", {
          class: "cli-ticket-row",
          title: tk.url,
          onclick: () => {
            this.hide();
            if (idMatch > 0) this.actions.openZammad(displayName, { id: idMatch, title: tk.title });
            else void Bridge.openUrl(tk.url);
          },
        },
        dot("#F59E0B", 5),
        h("span", { class: "cli-tk-title", text: tk.title }),
        svg(ICONS.arrowUpRight, 11, { stroke: 1.8 })));
      }
      scroll.append(tkList);
    }

    // ── Links & Backlinks ──
    const refs = [...new Set([...c.links, ...c.cited_by])];
    if (refs.length) {
      scroll.append(h("div", { class: "cli-refs" },
        h("span", { class: "rdm-kicker", text: t("Pagine collegate") }),
        h("div", { class: "cli-ref-chips" },
          ...refs.map((r) => h("button", {
            class: "cli-ref-chip",
            text: r,
            onclick: () => void this.open(r, { source: "search" }, true),
          })))));
    }

    this.bodyEl.append(scroll);
  }
}
