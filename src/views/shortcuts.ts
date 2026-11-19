// Contextual keyboard shortcuts overlay shown when pressing `?` inside the
// expanded island (outside text inputs). Reads the current open view/tab and
// live global hotkeys from State.settings; Esc or click outside dismisses it.

import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { t } from "../core/i18n";

interface ShortcutRow {
  keys: string;
  desc: string;
}

const RDM = "integration_rdm";
const ZAMMAD = "integration_zammad";
const THREECX = "integration_3cx";

function keycaps(combo: string): HTMLElement {
  const wrap = h("span", { class: "kbd-combo" });
  const alts = combo.split(" / ");
  alts.forEach((alt, idx) => {
    if (idx > 0) wrap.append(h("span", { class: "kbd-sep", text: "/" }));
    const parts = alt.split("+").map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, j) => {
      if (j > 0) wrap.append(h("span", { class: "kbd-plus", text: "+" }));
      wrap.append(h("kbd", { text: p }));
    });
  });
  return wrap;
}

function viewShortcuts(): { label: string; rows: ShortcutRow[] } {
  if (State.pendingApproval) {
    const isAsk = !!State.pendingApproval.questions?.length;
    return {
      label: isAsk ? t("Domanda") : t("Richiesta permesso"),
      rows: isAsk
        ? [
            { keys: "1–9", desc: t("Scegli un'opzione") },
            { keys: "Invio", desc: t("Conferma o passa alla prossima") },
            { keys: "Esc", desc: t("Ripiega l'isola lasciando la domanda in attesa") },
          ]
        : [
            { keys: "C / Y", desc: t("Consenti") },
            { keys: "N", desc: t("Nega") },
            { keys: "S", desc: t("Consenti sempre (se disponibile)") },
            { keys: "Esc", desc: t("Ripiega l'isola lasciando in attesa") },
          ],
    };
  }

  switch (State.view) {
    case "prompt":
      return {
        label: t("Chat"),
        rows: [
          { keys: "Invio", desc: t("Invia messaggio (o copia calcolo)") },
          { keys: "Shift+Invio", desc: t("Vai a capo senza inviare") },
          { keys: "↑", desc: t("Con campo vuoto: modifica l'ultimo messaggio") },
          { keys: "Ctrl+V", desc: t("Allega file o immagine dagli appunti") },
          { keys: "Ctrl+N", desc: t("Nuova conversazione") },
          { keys: "Esc", desc: t("Chiudi l'isola") },
        ],
      };
    case "actions":
      return {
        label: t("Azioni rapide"),
        rows: [
          { keys: "↑ / ↓", desc: t("Scorri la griglia delle azioni") },
          { keys: "Esc", desc: t("Svuota la ricerca o chiudi l'isola") },
        ],
      };
    case "files":
      return {
        label: t("File e schermo"),
        rows: [
          { keys: "↑ / ↓", desc: t("Scorri il Vassoio e la cartella") },
          { keys: "Ctrl+N", desc: t("Nuova chat") },
          { keys: "Esc", desc: t("Chiudi l'isola") },
        ],
      };
    case "news":
      return {
        label: t("Notizie"),
        rows: [
          { keys: "↑ / ↓", desc: t("Scorri gli articoli") },
          { keys: "Esc", desc: t("Chiudi l'isola") },
        ],
      };
    case "overview": {
      if (State.focusId === RDM && !State.showsSummary) {
        return {
          label: "Remote Desktop Manager",
          rows: [
            { keys: "Ctrl+F / /", desc: t("Cerca connessioni e credenziali") },
            { keys: "↑ / ↓", desc: t("Scorri le voci dell'elenco") },
            { keys: "Invio", desc: t("Apri dettaglio o cartella") },
            { keys: "Alt+O", desc: t("Apri connessione in RDM") },
            { keys: "Alt+P", desc: t("Copia password (30 s)") },
            { keys: "Alt+U", desc: t("Copia nome utente") },
            { keys: "Esc", desc: t("Chiudi dettaglio o ricerca") },
          ],
        };
      }
      if (State.focusId === ZAMMAD && !State.showsSummary) {
        return {
          label: "Zammad Ticket",
          rows: [
            { keys: "Ctrl+F / /", desc: t("Cerca tra i ticket") },
            { keys: "↑ / ↓", desc: t("Scorri l'elenco dei ticket") },
            { keys: "Invio", desc: t("Apri il ticket selezionato") },
            { keys: "Ctrl+Invio", desc: t("Invia risposta (o conferma email)") },
            { keys: "Esc", desc: t("Svuota filtro o chiudi dettaglio") },
          ],
        };
      }
      if (State.focusId === THREECX && !State.showsSummary) {
        return {
          label: "3CX",
          rows: [
            { keys: "0–9 * #", desc: t("Componi cifre o invia toni in chiamata") },
            { keys: "Invio", desc: t("Chiama il numero nel display") },
            { keys: "Backspace", desc: t("Cancella l'ultima cifra") },
            { keys: "← / →", desc: t("Cambia scheda nella barra in alto") },
            { keys: "Esc", desc: t("Svuota display o annulla trasferimento") },
          ],
        };
      }
      if (State.showsSummary) {
        return {
          label: t("Panoramica"),
          rows: [
            { keys: "← / →", desc: t("Scorri le schede attive") },
            { keys: "↑ / ↓", desc: t("Scorri la vista") },
            { keys: "Ctrl+N", desc: t("Nuova chat") },
            { keys: "Ctrl+P", desc: t("Tieni aperta o lascia chiudere") },
          ],
        };
      }
      const focusName = State.focusTask?.agentName || State.focusTask?.name || t("Scheda attiva");
      return {
        label: focusName,
        rows: [
          { keys: "← / →", desc: t("Passa alla scheda precedente o successiva") },
          { keys: "↑ / ↓", desc: t("Scorri la scheda") },
          { keys: "Ctrl+N", desc: t("Nuova chat") },
          { keys: "Ctrl+P", desc: t("Tieni aperta / sblocca") },
        ],
      };
    }
    default:
      return {
        label: t("Isola"),
        rows: [
          { keys: "↑ / ↓", desc: t("Scorri il contenuto") },
          { keys: "Ctrl+N", desc: t("Nuova chat") },
          { keys: "Ctrl+P", desc: t("Tieni aperta / sblocca") },
          { keys: "Esc", desc: t("Chiudi l'isola") },
        ],
      };
  }
}

function globalShortcuts(): ShortcutRow[] {
  const s = State.settings;
  const configured: [string | undefined, string][] = [
    [s.hotkeyOpen, t("Apri o chiudi l'isola")],
    [s.hotkeyAsk, t("Ricerca rapida")],
    [s.hotkeyClipboard, t("Cronologia appunti")],
    [s.hotkeyScreenshot, t("Riquadra e chiedi")],
    [s.hotkeyTalk, t("Dettatura vocale")],
    [s.hotkeyRemember, t("Ricorda selezione")],
    [s.hotkeySelectionMenu, t("Menu sulla selezione")],
    [s.hotkeyPending, t("Richiesta in attesa")],
    [s.hotkeySession, t("Sessione attiva")],
    [s.hotkeyCollect, t("Raccogli selezione")],
    [s.hotkeyNextPill, t("Scheda successiva")],
    [s.hotkeyMute, t("Silenzia suoni")],
  ];
  const rows: ShortcutRow[] = configured
    .filter(([keys]) => !!keys && keys.trim().length > 0)
    .map(([keys, desc]) => ({ keys: keys!.trim(), desc }));
  rows.push(
    { keys: "Ctrl+N", desc: t("Nuova chat (isola aperta)") },
    { keys: "Ctrl+P", desc: t("Tieni aperta (isola aperta)") },
    { keys: "?", desc: t("Mostra o chiudi queste scorciatoie") },
  );
  return rows;
}

export class ShortcutSheet {
  el: HTMLElement;
  private card: HTMLElement;
  private headLabel: HTMLElement;
  private localGrid: HTMLElement;
  private globalGrid: HTMLElement;
  private shown = false;

  constructor(private openSettings: () => void) {
    this.headLabel = h("span", { class: "kbd-sheet-badge" });
    this.localGrid = h("div", { class: "kbd-grid" });
    this.globalGrid = h("div", { class: "kbd-grid global" });

    const closeBtn = h("button", {
      class: "kbd-close",
      title: t("Chiudi (Esc)"),
      "aria-label": t("Chiudi"),
      onclick: () => this.hide(),
    }, svg(ICONS.xmark, 13));

    const header = h("div", { class: "kbd-sheet-head" },
      h("span", { class: "kbd-sheet-icon" }, svg(ICONS.keyboard, 15, { stroke: 1.7 })),
      h("b", { text: t("Scorciatoie da tastiera") }),
      this.headLabel,
      closeBtn);

    const body = h("div", { class: "kbd-sheet-body" },
      h("div", { class: "kbd-sec-title", text: t("In questa vista") }),
      this.localGrid,
      h("div", { class: "kbd-sec-title", text: t("Scorciatoie globali") }),
      this.globalGrid);

    const footer = h("div", { class: "kbd-sheet-foot" },
      h("span", { class: "kbd-foot-hint", text: t("Esc o clic fuori per chiudere") }),
      h("button", {
        class: "link-btn",
        text: t("Configura in Impostazioni…"),
        onclick: () => {
          this.hide();
          this.openSettings();
        },
      }));

    this.card = h("div", {
      class: "kbd-sheet-card",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("Scorciatoie da tastiera"),
      onclick: (e: Event) => e.stopPropagation(),
    }, header, body, footer);

    this.el = h("div", {
      class: "kbd-sheet",
      onclick: () => this.hide(),
    }, this.card);
    this.el.style.display = "none";
  }

  get open(): boolean {
    return this.shown;
  }

  toggle() {
    if (this.shown) this.hide();
    else this.show();
  }

  show() {
    this.shown = true;
    this.sync();
    this.el.style.display = "";
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.style.display = "none";
  }

  sync() {
    if (!this.shown) return;
    const ctx = viewShortcuts();
    this.headLabel.textContent = ctx.label;
    this.fill(this.localGrid, ctx.rows);
    this.fill(this.globalGrid, globalShortcuts());
  }

  private fill(host: HTMLElement, rows: ShortcutRow[]) {
    clear(host);
    for (const r of rows) {
      host.append(h("div", { class: "kbd-row" },
        keycaps(r.keys),
        h("span", { class: "kbd-desc", text: r.desc })));
    }
  }
}
