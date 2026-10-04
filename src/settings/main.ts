// Settings window — the place where anything that writes to disk is confirmed.
// Sections marked with the profile chip are saved into the active profile;
// the rest belongs to this PC.

import "./settings.css";
import "../character/roster";
import { characters, type RGB } from "../character/character";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type QuickAction, type IntegrationConfig, type Settings, type WidgetDef } from "../core/state";
import { h, clear } from "../views/dom";
import { ACTION_ICONS, actionIcon, actionIconSvg, renderActionIcon } from "../views/action-icons";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── Claude Code section ───────────────────────────────────────────────────────

function claudeSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: "Claude Code" })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: "Claude Code" }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? "EasyIsland è collegato alle tue sessioni di Claude Code. Strumenti usati, domande e richieste di permesso compaiono nell'isola, e puoi rispondere da lì."
          : "Installa gli hook per vedere le sessioni di Claude Code nell'isola e approvare i permessi senza interrompere quello che stai facendo.",
      }),
      h("div", { class: "row" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (status.legacy) {
      body.append(h("div", {
        class: "notice warn",
        text: "settings.json usa ancora gli hook della vecchia versione (Coucou), che non arrivano a EasyIsland. Reinstalla gli hook: le voci vecchie vengono sostituite.",
      }));
    }

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "easyisland-hook.exe non è ancora al suo posto. Riavvia EasyIsland; se non basta, compilalo con `cargo build -p easyisland-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed || status.legacy ? "Reinstalla hook…" : "Installa hook…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "Il relay non è ancora installato.";
    }
    actions.append(install);
    if (status.installed || status.legacy) {
      actions.append(h("button", {
        class: "danger",
        text: "Disinstalla hook…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.hooksPreview(install);
    } catch (err) {
      // An unreadable or invalid settings.json stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Indietro",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "Ecco esattamente cosa cambierà nel tuo settings.json. I tuoi hook non vengono toccati."
          : "Vengono rimosse solo le voci di EasyIsland. I tuoi hook non vengono toccati.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Copia di sicurezza → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Fai il backup e scrivi" : "Fai il backup e rimuovi",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Fatto. Impostazioni precedenti salvate in ${backup}. Apri una nuova sessione di Claude Code per attivare gli hook.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Scrittura non riuscita: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Annulla",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── Claude chat section ───────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
];

/** Claude Code takes aliases; "" leaves the choice to Claude Code. */
const CLI_MODELS: [string, string][] = [
  ["", "Predefinito di Claude Code"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
];

function modelSelect(
  options: [string, string][],
  current: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of options) select.append(h("option", { value: id, text: label }));
  if (!options.some(([id]) => id === current)) {
    select.append(h("option", { value: current, text: current }));
  }
  select.value = current;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function claudeChatSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(false);
  let keyPresent = hasKey;
  let cliReady = false;

  // ── Engine picker ──
  const engine = h("select", {}) as HTMLSelectElement;
  engine.append(
    h("option", { value: "subscription", text: "Abbonamento Claude (tramite Claude Code)" }),
    h("option", { value: "api", text: "Chiave API Anthropic (a consumo)" }),
  );
  engine.value = settings.chatEngine;

  // ── Subscription block ──
  const cliState = h("span", { class: "hint", text: "Verifica di Claude Code…" });
  const recheck = h("button", { text: "Ricontrolla" });
  const cliBlock = h(
    "div",
    { style: "display:flex;flex-direction:column;gap:10px" },
    h("div", {
      class: "hint",
      text: "La chat usa Claude Code installato su questo PC e il tuo abbonamento Claude (Pro o Max): nessuna chiave e nessun costo extra, ma conta nei limiti d'uso del tuo piano. Claude Code gira nascosto, senza hook, e può cercare sul web, leggere i file che rilasci e, se lo permetti qui sotto, usare EasyIsland.",
    }),
    h("div", { class: "row" }, cliState, recheck),
    h("div", { class: "row" },
      h("label", { text: "Claude può usare il PC" }),
      toggle(settings.agentTools !== false, (v) => { settings.agentTools = v; void save(); }),
      h("span", { class: "hint note", text: "aprire programmi, cartelle e link, eseguire le tue azioni rapide, leggere lo stato di PC, rete, meteo, posta e ticket, appunti e musica. Ogni azione che cambia qualcosa chiede Consenti / Nega nell'isola; nessun comando che non sia una tua azione rapida" })),
    h("div", { class: "row" },
      h("label", { text: "Modello" }),
      modelSelect(CLI_MODELS, settings.cliModel, (v) => {
        settings.cliModel = v;
        void save();
      }),
    ),
  );

  async function refreshCli() {
    cliState.textContent = "Verifica di Claude Code…";
    recheck.disabled = true;
    const status = await Bridge.claudeCliStatus();
    recheck.disabled = false;
    cliReady = !!status?.found && !!status.loggedIn;
    if (!status?.found) {
      cliState.textContent =
        "Claude Code non trovato. Installalo (code.claude.com), fai il login e premi Ricontrolla.";
    } else if (!status.loggedIn) {
      cliState.textContent =
        "Claude Code è installato ma non hai fatto il login: apri un terminale, scrivi «claude» e segui le istruzioni.";
    } else {
      cliState.textContent = `Pronto: ${status.path}`;
    }
    paintDot();
  }
  recheck.addEventListener("click", () => void refreshCli());

  // ── API block ──
  const state = h("span", { class: "hint" });
  const field = h("input", {
    type: "password",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const saveBtn = h("button", { class: "primary", text: "Salva chiave" });
  const clearBtn = h("button", { class: "danger", text: "Rimuovi" });
  const feedback = h("div", {});

  function paintKey() {
    state.textContent = keyPresent
      ? "Chiave salvata in Gestione credenziali di Windows."
      : "Nessuna chiave: in questa modalità la chat ne ha bisogno.";
    field.placeholder = keyPresent ? "••••••••••••  (salvata)" : "sk-ant-...";
    clearBtn.style.display = keyPresent ? "" : "none";
    paintDot();
  }

  async function refreshKey() {
    keyPresent = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    paintKey();
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Salvata. Non viene mai scritta su disco." }));
      await refreshKey();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Salvataggio non riuscito: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Chiave rimossa." }));
      await refreshKey();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Rimozione non riuscita: ${String(err)}` }));
    }
  });

  const apiBlock = h(
    "div",
    { style: "display:flex;flex-direction:column;gap:10px" },
    h("div", {
      class: "hint",
      text: "La chat chiama direttamente l'API di Anthropic con la tua chiave. Si paga a consumo dalla Console di Anthropic, separatamente da qualsiasi abbonamento.",
    }),
    state,
    h("div", { class: "row" }, h("label", { text: "Chiave API" }), field, saveBtn, clearBtn),
    h("div", { class: "row" },
      h("label", { text: "Modello" }),
      modelSelect(MODELS, settings.model, (v) => {
        settings.model = v;
        void save();
      }),
    ),
    feedback,
  );

  function paintDot() {
    const ready = settings.chatEngine === "api" ? keyPresent : cliReady;
    dot.style.background = ready ? "#22c55e" : "#f4505e";
  }

  function showEngine() {
    const api = settings.chatEngine === "api";
    apiBlock.style.display = api ? "flex" : "none";
    cliBlock.style.display = api ? "none" : "flex";
    paintDot();
  }

  engine.addEventListener("change", () => {
    settings.chatEngine = engine.value as Settings["chatEngine"];
    void save();
    showEngine();
  });

  paintKey();
  showEngine();
  void refreshCli();

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Chat con Claude" })),
    h("div", { class: "row" }, h("label", { text: "Motore" }), engine),
    cliBlock,
    apiBlock,
  );
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
  /** Options kept in settings.integrationConfig (the integrations run as checks). */
  options?: IntegrationOption[];
  /** What it shows and where the data comes from. */
  hint?: string;
}

interface IntegrationOption {
  label: string;
  type: "number" | "text";
  placeholder: string;
  /** Shown after the field. */
  unit?: string;
  get(c: IntegrationConfig): string | number;
  set(c: IntegrationConfig, v: string): void;
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Chiave segreta", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "URL istanza", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "Chiave API", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "Chiave API", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "Chiave API", placeholder: "cal_…", secret: true }] },
  { id: "integration_outlook", name: "Outlook", color: "#0A84D6", fields: [],
    options: [{
      label: "Avvisa", type: "number", placeholder: "10", unit: "minuti prima di una riunione",
      get: (c) => c.outlookWarn, set: (c, v) => { c.outlookWarn = Math.max(1, Number(v) || 10); },
    }],
    hint: "Mail non lette nella Posta in arrivo e appuntamenti di oggi e domani, letti da Outlook classico già aperto (non lo avvia mai). Il nuovo Outlook non è supportato: non permette ad altri programmi di leggerlo. Niente account né chiavi." },
  { id: "integration_zammad", name: "Zammad", color: "#F59E0B",
    fields: [
      { key: "zammad-url", label: "Indirizzo", placeholder: "https://helpdesk.azienda.it", secret: false },
      { key: "zammad-token", label: "Token", placeholder: "token di accesso", secret: true },
    ],
    hint: "In Zammad: avatar → Profilo → Token di accesso → Crea, con il permesso ticket.agent. Ticket assegnati a te, non assegnati e in escalation (avviso giallo); il personaggio ti avvisa quando arriva un nuovo ticket da assegnare." },
  { id: "integration_system", name: "Stato del PC", color: "#38BDF8", fields: [],
    options: [{
      label: "Avvisa sotto il", type: "number", placeholder: "10", unit: "% di spazio libero sul disco di sistema",
      get: (c) => c.systemWarn, set: (c, v) => { c.systemWarn = Math.min(50, Math.max(1, Number(v) || 10)); },
    }],
    hint: "Disco (in rosso sotto il 5%), batteria scarica, memoria quasi piena, riavvio richiesto da Windows." },
  { id: "integration_security", name: "Sicurezza", color: "#22C55E", fields: [],
    hint: "Antivirus (Defender o un altro, dal Centro sicurezza di Windows), età delle firme, ultima scansione, firewall, minacce rilevate e riavvio in sospeso. Nessuna chiave, nessuna connessione." },
  { id: "integration_network", name: "Rete", color: "#6366F1", fields: [],
    hint: "Wi-Fi o cavo, IP locale, VPN attive e latenza verso 1.1.1.1. L'IP pubblico viene chiesto ad api.ipify.org al massimo ogni 15 minuti. Avvisa se internet non risponde o è lento." },
  { id: "integration_weather", name: "Meteo", color: "#0EA5E9", fields: [],
    options: [{
      label: "Città", type: "text", placeholder: "es. Milano, Bologna, Lugano",
      get: (c) => c.weatherCity, set: (c, v) => { c.weatherCity = v.trim(); },
    }],
    hint: "Da Open-Meteo, gratuito e senza chiave. Avvisa quando è probabile la pioggia nelle prossime ore." },
  { id: "integration_clipboard", name: "Appunti", color: "#A78BFA", fields: [],
    hint: "Gli ultimi 30 testi copiati, più quelli fissati: clic per incollarli nell'app in primo piano, o trasformarli (maiuscole, una riga, JSON, URL). Si apre anche con la scorciatoia in Azioni rapide. Restano solo in memoria (mai su disco) e si svuotano alla chiusura; ciò che i gestori di password segnano come privato non viene registrato." },
  { id: "integration_media", name: "Musica", color: "#1ED760", fields: [],
    hint: "Cosa sta suonando (Spotify, una scheda del browser, Lettore multimediale… tutto ciò che compare nei controlli multimediali di Windows), con copertina, play/pausa, brano precedente e successivo. Tutto in locale, nessun account." },
];

/** Suggested icon for each integration when its tab shows an icon. */
const TAB_ICONS: Record<string, string> = {
  integration_stripe: "💳", integration_github: "🐙", integration_vercel: "▲", integration_n8n: "🔁",
  integration_resend: "✉️", integration_notion: "📝", integration_calcom: "📅", integration_outlook: "📧",
  integration_zammad: "🎫", integration_system: "💻", integration_security: "🛡️", integration_network: "🌐",
  integration_weather: "⛅", integration_clipboard: "📋", integration_media: "🎵",
};

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Scegli quali pillole mostrare accanto al personaggio (${used} attive): l'isola si allarga per mostrarle tutte. Le chiavi restano in Gestione credenziali di Windows, mai su disco.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (salvata)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Salva" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (salvata)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
      );
    }
    for (const opt of def.options ?? []) {
      const el = h("input", {
        type: opt.type, value: String(opt.get(settings.integrationConfig)), placeholder: opt.placeholder,
        spellcheck: "false", style: opt.type === "number" ? "width:80px" : "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      el.addEventListener("change", () => {
        opt.set(settings.integrationConfig, el.value);
        el.value = String(opt.get(settings.integrationConfig));
        void save();
      });
      rows.append(h("div", { class: "row" },
        h("label", { style: "min-width:104px", text: opt.label }),
        el,
        opt.unit ? h("span", { class: "hint note", text: opt.unit }) : null,
      ));
    }
    const place = h("select", {},
      h("option", { value: "pill", text: "Pillola nella panoramica" }),
      h("option", { value: "tab", text: "Scheda in alto, con il nome" }),
      h("option", { value: "icon", text: "Scheda in alto, con un'icona" })) as HTMLSelectElement;
    const iconInput = h("input", {
      type: "text", maxlength: "4", spellcheck: "false", style: "width:56px;text-align:center",
      title: "Un'emoji o una o due lettere", placeholder: TAB_ICONS[def.id] ?? "★",
    }) as HTMLInputElement;
    const icons = () => (settings.integrationTabIcons ??= {});
    iconInput.value = icons()[def.id] ?? "";
    const isTab = (settings.integrationTabs ?? []).includes(def.id);
    place.value = !isTab ? "pill" : icons()[def.id] ? "icon" : "tab";
    const syncIcon = () => { iconInput.style.display = place.value === "icon" ? "" : "none"; };
    syncIcon();
    place.addEventListener("change", () => {
      const rest = (settings.integrationTabs ?? []).filter((x) => x !== def.id);
      settings.integrationTabs = place.value === "pill" ? rest : [...rest, def.id];
      if (place.value === "icon") {
        if (!iconInput.value.trim()) iconInput.value = TAB_ICONS[def.id] ?? "★";
        icons()[def.id] = iconInput.value.trim();
      } else {
        delete icons()[def.id];
      }
      syncIcon();
      void save();
    });
    iconInput.addEventListener("change", () => {
      const v = iconInput.value.trim() || (TAB_ICONS[def.id] ?? "★");
      iconInput.value = v;
      icons()[def.id] = v;
      void save();
    });
    rows.append(h("div", { class: "row" },
      h("label", { style: "min-width:104px", text: "Mostra come" }), place, iconInput));
    if (def.hint) rows.append(h("div", { class: "hint", text: def.hint }));

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrazioni" }), profileChip()), note, list);
}

// ── Placement section ─────────────────────────────────────────────────────────

function select<T extends string>(
  options: [T, string][],
  current: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const el = h("select", {}) as HTMLSelectElement;
  for (const [value, label] of options) el.append(h("option", { value, text: label }));
  el.value = current;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

/** A range slider with its value shown next to it; saves when released. */
function slider(
  min: number,
  max: number,
  step: number,
  current: number,
  unit: string,
  onCommit: (v: number) => void,
): HTMLElement {
  const input = h("input", {
    type: "range", min: String(min), max: String(max), step: String(step),
    value: String(current),
  }) as HTMLInputElement;
  const label = h("span", { class: "hint", style: "min-width:44px", text: `${current} ${unit}` });
  input.addEventListener("input", () => {
    label.textContent = `${input.value} ${unit}`;
  });
  input.addEventListener("change", () => onCommit(Number(input.value)));
  return h("div", { style: "display:flex;align-items:center;gap:10px" }, input, label);
}

function placementSection(): HTMLElement {
  const commit = () => void save();

  const screen = select<Settings["screen"]>(
    [["primary", "Schermo principale"], ["cursor", "Schermo sotto il cursore"]],
    settings.screen,
    (v) => { settings.screen = v; commit(); },
  );

  const vertical = select<Settings["anchorV"]>(
    [["top", "In alto"], ["bottom", "In basso"]],
    settings.anchorV,
    (v) => { settings.anchorV = v; settings.offsetX = 0; settings.offsetY = 0; commit(); },
  );
  const horizontal = select<Settings["anchorH"]>(
    [["left", "A sinistra"], ["center", "Al centro"], ["right", "A destra"]],
    settings.anchorH,
    (v) => { settings.anchorH = v; settings.offsetX = 0; settings.offsetY = 0; commit(); },
  );

  const iconSize = h("div", { class: "row" },
    h("label", { text: "Dimensione" }),
    slider(16, 48, 2, settings.iconSize, "px", (v) => { settings.iconSize = v; commit(); }),
  );
  const iconStyle = select<Settings["iconStyle"]>(
    [
      ["character", "Il personaggio"],
      ["dot", "Pallino con il colore dello stato"],
      ["none", "Nessuna (striscia invisibile sul bordo)"],
    ],
    settings.iconStyle,
    (v) => {
      settings.iconStyle = v;
      iconSize.style.display = v === "none" ? "none" : "";
      commit();
    },
  );
  iconSize.style.display = settings.iconStyle === "none" ? "none" : "";

  const hoverSize = h("div", { class: "row" },
    h("label", { text: "Dimensione" }),
    slider(28, 64, 2, settings.hoverSize, "px", (v) => { settings.hoverSize = v; commit(); }),
  );
  const hoverStyle = select<Settings["hoverStyle"]>(
    [["icon", "Il personaggio più grande"], ["bar", "Barra compatta con le integrazioni"]],
    settings.hoverStyle,
    (v) => {
      settings.hoverStyle = v;
      hoverSize.style.display = v === "icon" ? "" : "none";
      commit();
    },
  );
  hoverSize.style.display = settings.hoverStyle === "icon" ? "" : "none";

  const delays: [string, string][] = [
    ["0", "Solo con un clic"], ["0.3", "0,3 s"], ["0.6", "0,6 s"], ["1", "1 s"], ["2", "2 s"], ["3", "3 s"],
  ];
  const openDelay = select<string>(
    delays.some(([v]) => Number(v) === settings.openDelay)
      ? delays
      : [...delays, [String(settings.openDelay), `${settings.openDelay} s`]],
    String(delays.find(([v]) => Number(v) === settings.openDelay)?.[0] ?? settings.openDelay),
    (v) => { settings.openDelay = Number(v); commit(); },
  );

  // revealDuration 0 = the compact view never goes back to the rest icon.
  const reveal = h("input", {
    type: "number", min: "2", max: "120", step: "1",
    value: String(Math.round(settings.revealDuration > 0 ? settings.revealDuration : 8)),
    style: "width:72px",
  }) as HTMLInputElement;
  reveal.addEventListener("change", () => {
    settings.revealDuration = Math.max(2, Math.min(120, Number(reveal.value) || 8));
    reveal.value = String(settings.revealDuration);
    commit();
  });
  const revealRow = h("div", { class: "row" },
    h("label", { text: "Torna a riposo dopo" }),
    reveal,
    h("span", { class: "hint note", text: "secondi dopo un evento o dopo che sposti via il mouse" }),
  );
  const restRows = h("div", { style: "display:contents" },
    h("div", { class: "row" }, h("label", { text: "Icona a riposo" }), iconStyle),
    iconSize,
    revealRow,
  );
  const alwaysOn = (on: boolean) => { restRows.style.display = on ? "none" : "contents"; };
  alwaysOn(settings.revealDuration <= 0);
  const always = toggle(settings.revealDuration <= 0, (v) => {
    settings.revealDuration = v ? 0 : Math.max(2, Number(reveal.value) || 8);
    alwaysOn(v);
    commit();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    commit();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Posizione e aspetto" }), profileChip()),
    h("div", {
      class: "hint",
      text: "Dove vive il personaggio. Quando si apre, l'isola cresce dall'angolo scelto e il contenuto resta allineato a quel lato. In basso sta sopra la barra delle applicazioni. Puoi anche trascinare il personaggio con il mouse: la posizione resta salvata; sceglierne una qui la riporta al bordo.",
    }),
    h("div", { class: "row" }, h("label", { text: "Schermo" }), screen),
    h("div", { class: "row" }, h("label", { text: "Posizione" }), vertical, horizontal),
    h("div", { class: "row" },
      h("label", { text: "Sopra la barra" }),
      toggle(settings.overTaskbar, (v) => { settings.overTaskbar = v; commit(); }),
      h("span", { class: "hint note", text: "il personaggio può stare anche sopra la barra delle applicazioni" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Aggancia ai bordi" }),
      toggle(settings.glueEdges, (v) => { settings.glueEdges = v; commit(); }),
      h("span", { class: "hint note", text: "lasciato a pochi pixel da un bordo, lo sfondo si attacca al bordo; altrimenti resta solo intorno all'icona" }),
    ),
    h("div", { class: "row" }, h("label", { text: "Vista compatta" }), hoverStyle),
    hoverSize,
    h("div", { class: "row" },
      h("label", { text: "Segue il mouse" }),
      toggle(settings.followCursorCompact, (v) => { settings.followCursorCompact = v; commit(); }),
      h("span", { class: "hint note", text: "anche nella vista compatta. Spento: si guarda intorno da solo, sbatte le palpebre e fa qualche smorfia (consuma meno). A isola aperta segue sempre il mouse." }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Sempre visibile" }),
      always,
      h("span", { class: "hint note", text: "la vista compatta resta sullo schermo e non torna mai all'icona a riposo" }),
    ),
    restRows,
    h("div", { class: "row" },
      h("label", { text: "Apri dopo" }),
      openDelay,
      h("span", { class: "hint note", text: "trascinare un file sopra il personaggio lo apre sempre" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Pannello aperto" }),
      autoClose,
      h("span", { class: "hint note", text: "secondi dopo che sposti via il mouse, poi si riduce alla vista compatta" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Pulsante chiudi" }),
      toggle(settings.closeButton, (v) => { settings.closeButton = v; commit(); }),
      h("span", { class: "hint note", text: "✕ in alto a destra per chiudere subito il pannello (anche Esc)" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Schermo intero" }),
      toggle(settings.quietFullscreen, (v) => { settings.quietFullscreen = v; commit(); }),
      h("span", { class: "hint note", text: "nascondi durante video, giochi e presentazioni (i permessi compaiono comunque)" }),
    ),
  );
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Generale" })),
    h("div", { class: "hint", text: "Il suono vale per il profilo attivo, l'avvio con Windows per questo PC. I tempi di chiusura sono in Posizione e aspetto." }),
    h("div", { class: "row" },
      h("label", { text: "Suono" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Avvia con Windows" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/** Chip shown on sections whose values belong to the active profile. */
function profileChip(): HTMLElement {
  const name = settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "";
  return h("span", { class: "chip", title: "Questi valori valgono per il profilo attivo", text: name });
}

/** Fields a profile carries — mirrors PROFILE_KEYS in src-tauri/src/settings.rs. */
const PROFILE_KEYS = [
  "activeIntegrations", "anchorV", "anchorH", "offsetX", "offsetY", "glueEdges", "overTaskbar",
  "closeButton", "followCursorCompact", "presenceMeeting", "presenceRemote", "presenceApps", "presenceMode", "iconStyle", "iconSize", "hoverStyle",
  "hoverSize", "openDelay", "revealDuration", "quietFullscreen", "soundEnabled",
  "soundVolume", "autoCloseInterval", "theme", "notify", "actions", "widgets", "mcpServers",
] as const;

function snapshot(): Record<string, unknown> {
  const all = settings as unknown as Record<string, unknown>;
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, structuredClone(all[k])]));
}

const DAYS: [number, string][] = [[1, "L"], [2, "M"], [3, "M"], [4, "G"], [5, "V"], [6, "S"], [7, "D"]];

function profilesSection(): HTMLElement {
  const active = () => settings.profiles.find((p) => p.id === settings.activeProfile);
  const feedback = h("div", {});

  const picker = select<string>(
    settings.profiles.map((p) => [p.id, p.name]),
    settings.activeProfile,
    (id) => void Bridge.switchProfile(id),
  );

  const name = h("input", { type: "text", value: active()?.name ?? "", style: "width:160px" }) as HTMLInputElement;
  name.addEventListener("change", () => {
    const p = active();
    if (!p || !name.value.trim()) return;
    p.name = name.value.trim();
    void save().then(render);
  });

  const add = h("button", { text: "Nuovo profilo" });
  add.addEventListener("click", async () => {
    const id = `p${Date.now().toString(36)}`;
    settings.profiles.push({
      id, name: `Profilo ${settings.profiles.length + 1}`,
      values: snapshot(), rules: { ssids: [], days: [], from: "", to: "" },
    });
    await save();
    await Bridge.switchProfile(id);
  });

  const remove = h("button", { class: "danger", text: "Elimina" });
  remove.disabled = settings.profiles.length < 2;
  remove.addEventListener("click", async () => {
    const id = settings.activeProfile;
    const next = settings.profiles.find((p) => p.id !== id);
    if (!next) return;
    await Bridge.switchProfile(next.id);
    settings.profiles = settings.profiles.filter((p) => p.id !== id);
    await save();
    render();
  });

  // ── Automatic switching rules for the active profile ──
  const p = active();
  const rules = p?.rules ?? { ssids: [], days: [], from: "", to: "" };
  const commitRules = () => {
    if (!p) return;
    p.rules = rules;
    void save();
  };

  const ssids = h("input", {
    type: "text", value: rules.ssids.join(", "), placeholder: "es. Ufficio-WiFi, Cliente-Ospiti",
    style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  ssids.addEventListener("change", () => {
    rules.ssids = ssids.value.split(",").map((x) => x.trim()).filter(Boolean);
    commitRules();
  });
  const here = h("button", { text: "Rete attuale" });
  here.addEventListener("click", async () => {
    const ssid = await Bridge.currentNetwork();
    clear(feedback);
    if (!ssid) {
      feedback.append(h("div", { class: "notice warn", text: "Nessuna rete Wi-Fi collegata." }));
      return;
    }
    if (!rules.ssids.includes(ssid)) rules.ssids.push(ssid);
    ssids.value = rules.ssids.join(", ");
    commitRules();
  });

  const dayRow = h("div", { class: "days" });
  for (const [d, label] of DAYS) {
    const b = h("button", { class: rules.days.includes(d) ? "day on" : "day", text: label });
    b.addEventListener("click", () => {
      rules.days = rules.days.includes(d) ? rules.days.filter((x) => x !== d) : [...rules.days, d].sort();
      b.classList.toggle("on", rules.days.includes(d));
      commitRules();
    });
    dayRow.append(b);
  }

  const from = h("input", { type: "time", value: rules.from }) as HTMLInputElement;
  const to = h("input", { type: "time", value: rules.to }) as HTMLInputElement;
  from.addEventListener("change", () => { rules.from = from.value; commitRules(); });
  to.addEventListener("change", () => { rules.to = to.value; commitRules(); });

  const auto = toggle(settings.autoProfile, (v) => { settings.autoProfile = v; void save(); });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Profilo" })),
    h("div", {
      class: "hint",
      text: "Ogni profilo ha le sue integrazioni, posizione, aspetto, suoni, tema, notifiche e azioni. Le sezioni con l'etichetta del profilo si salvano nel profilo attivo. Si cambia anche dal menu dell'icona nell'area di notifica.",
    }),
    h("div", { class: "row" }, h("label", { text: "Profilo attivo" }), picker, add),
    h("div", { class: "row" }, h("label", { text: "Nome" }), name, remove),
    h("div", { class: "row" },
      h("label", { text: "Cambio automatico" }),
      auto,
      h("span", { class: "hint note", text: "attiva il primo profilo le cui regole corrispondono" }),
    ),
    h("div", { class: "hint", text: "Regole di questo profilo (vuote = solo a mano):" }),
    h("div", { class: "row" }, h("label", { text: "Reti Wi-Fi" }), ssids, here),
    h("div", { class: "row" }, h("label", { text: "Giorni" }), dayRow),
    h("div", { class: "row" },
      h("label", { text: "Orario" }),
      h("span", { class: "hint", text: "dalle" }), from,
      h("span", { class: "hint", text: "alle" }), to,
    ),
    feedback,
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

function newActionId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blankAction(kind: QuickAction["kind"] = "prompt"): QuickAction {
  return {
    id: newActionId(), name: "Nuova azione", icon: "i:bolt", color: "#8b5cf6", kind,
    target: "", args: "", script: "", shell: "powershell", prompt: "",
    input: "clipboard", confirm: true, hotkey: "",
  };
}

/**
 * The action's icon as a button; clicking it opens a grid of the icons drawn in
 * code (no emoji to type on Windows). An old emoji icon is kept until replaced.
 */
function iconPicker(value: string, color: string, onPick: (v: string) => void): HTMLElement {
  const current = actionIcon(value)?.name;
  const pop = h("div", { class: "icon-pop", role: "listbox" });
  for (const ic of ACTION_ICONS) {
    const b = h("button", { class: ic.name === current ? "on" : "", title: ic.label }, actionIconSvg(ic, 18));
    b.addEventListener("click", () => {
      pop.classList.remove("open");
      onPick(`i:${ic.name}`);
    });
    pop.append(b);
  }
  const button = h("button", { class: "icon-pick-btn", title: "Scegli l'icona" }, renderActionIcon(value, 18));
  if (/^#[0-9a-f]{6}$/i.test(color)) button.style.color = color;
  button.addEventListener("click", () => {
    const open = !pop.classList.contains("open");
    document.querySelectorAll(".icon-pop.open").forEach((p) => p.classList.remove("open"));
    pop.classList.toggle("open", open);
  });
  return h("div", { class: "icon-pick" }, button, pop);
}

// A click anywhere else closes an open icon grid.
document.addEventListener("click", (e) => {
  document.querySelectorAll(".icon-pop.open").forEach((p) => {
    if (!p.parentElement?.contains(e.target as Node)) p.classList.remove("open");
  });
});

function actionsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const warn = h("div", {});
  const commit = () => {
    void save().then(() => window.setTimeout(checkHotkeys, 600));
  };

  async function checkHotkeys() {
    const failed = (await Bridge.hotkeyFailures()) ?? [];
    clear(warn);
    if (failed.length) {
      warn.append(h("div", {
        class: "notice warn",
        text: `Scorciatoie non disponibili (già usate da un'altra app o scritte male): ${failed.join(", ")}.`,
      }));
    }
  }

  function draw() {
    clear(list);
    const actions = settings.actions;
    actions.forEach((a, idx) => {
      const field = (value: string, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0") => {
        const el = h("input", { type: "text", value, placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };
      const area = (value: string, placeholder: string, apply: (v: string) => void, mono = false) => {
        const el = h("textarea", { placeholder, rows: "3", spellcheck: "false", class: mono ? "mono" : "" }) as HTMLTextAreaElement;
        el.value = value;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };

      const color = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#8b5cf6" }) as HTMLInputElement;
      color.addEventListener("change", () => { a.color = color.value; commit(); draw(); });

      const kind = select<QuickAction["kind"]>(
        [["prompt", "Chiedi a Claude"], ["script", "Script"], ["app", "Programma / cartella"], ["url", "Link"]],
        a.kind,
        (v) => { a.kind = v; commit(); draw(); },
      );

      const move = (delta: number) => {
        const j = idx + delta;
        if (j < 0 || j >= actions.length) return;
        [actions[idx], actions[j]] = [actions[j], actions[idx]];
        commit();
        draw();
      };
      const up = h("button", { class: "icon", text: "↑", title: "Sposta su", onclick: () => move(-1) });
      const down = h("button", { class: "icon", text: "↓", title: "Sposta giù", onclick: () => move(1) });
      const del = h("button", {
        class: "danger icon", text: "✕", title: "Elimina",
        onclick: () => { actions.splice(idx, 1); commit(); draw(); },
      });

      const card = h("div", { class: "qa-edit" },
        h("div", { class: "row head" },
          iconPicker(a.icon, a.color, (v) => { a.icon = v; commit(); draw(); }),
          field(a.name, "Nome", (v) => { a.name = v.trim(); }),
          color, kind, up, down, del,
        ),
      );

      switch (a.kind) {
        case "url":
          card.append(h("div", { class: "row" }, h("label", { text: "Link" }),
            field(a.target, "https://…", (v) => { a.target = v.trim(); })));
          break;
        case "app":
          card.append(
            h("div", { class: "row" }, h("label", { text: "Programma o cartella" }),
              field(a.target, "es. mstsc, C:\\Strumenti\\app.exe, C:\\Clienti", (v) => { a.target = v.trim(); })),
            h("div", { class: "row" }, h("label", { text: "Argomenti" }),
              field(a.args, "es. /v:server01 — le virgolette raggruppano", (v) => { a.args = v; })),
          );
          break;
        case "script":
          card.append(
            h("div", { class: "row" }, h("label", { text: "Shell" }),
              select<QuickAction["shell"]>([["powershell", "PowerShell"], ["cmd", "Prompt dei comandi"]], a.shell,
                (v) => { a.shell = v; commit(); }),
              h("span", { class: "hint", text: "Chiedi conferma" }),
              toggle(a.confirm, (v) => { a.confirm = v; commit(); }),
            ),
            area(a.script, "I comandi da eseguire. Partono solo dopo un clic nell'isola.", (v) => { a.script = v; }, true),
          );
          break;
        case "prompt":
          card.append(
            h("div", { class: "row" }, h("label", { text: "Applicata a" }),
              select<QuickAction["input"]>(
                [["clipboard", "Testo copiato negli appunti"], ["file", "File rilasciato sull'isola"], ["none", "Niente (solo la domanda)"]],
                a.input,
                (v) => { a.input = v; commit(); },
              )),
            area(a.prompt, "Cosa chiedere a Claude", (v) => { a.prompt = v; }),
          );
          break;
      }
      card.append(h("div", { class: "row" }, h("label", { text: "Scorciatoia" }),
        field(a.hotkey, "facoltativa, es. Ctrl+Alt+E", (v) => { a.hotkey = v.trim(); }, "width:200px")));
      list.append(card);
    });
  }

  const hotkeyField = (value: string, apply: (v: string) => void) => {
    const el = h("input", { type: "text", value, placeholder: "nessuna", style: "width:200px", spellcheck: "false" }) as HTMLInputElement;
    el.addEventListener("change", () => { apply(el.value.trim()); commit(); });
    return el;
  };

  const add = h("button", { class: "primary", text: "Aggiungi azione" });
  add.addEventListener("click", () => { settings.actions.push(blankAction()); commit(); draw(); });

  draw();
  void checkHotkeys();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Azioni rapide" }), profileChip()),
    h("div", {
      class: "hint",
      text: "Pulsanti nella scheda ⚡ dell'isola: link, programmi, script (partono solo dopo un clic) e domande a Claude sul testo copiato o sul file rilasciato. Nessuna chiave o password qui dentro.",
    }),
    h("div", { class: "row" }, h("label", { text: "Apri l'isola" }),
      hotkeyField(settings.hotkeyOpen, (v) => { settings.hotkeyOpen = v; })),
    h("div", { class: "row" }, h("label", { text: "Chiedi sul testo copiato" }),
      hotkeyField(settings.hotkeyAsk, (v) => { settings.hotkeyAsk = v; })),
    h("div", { class: "row" }, h("label", { text: "Cronologia appunti" }),
      hotkeyField(settings.hotkeyClipboard, (v) => { settings.hotkeyClipboard = v; }),
      h("span", { class: "hint note", text: "scorciatoie di questo PC, valgono in ogni app" })),
    h("div", { class: "row" }, h("label", { text: "Suggerimenti per l'app in uso" }),
      toggle(settings.contextActions !== false, (v) => { settings.contextActions = v; void save(); }),
      h("span", { class: "hint note", text: "in cima alla scheda ⚡: per Outlook, Excel, Word, il browser, il codice… usano il testo che hai selezionato" })),
    warn,
    list,
    h("div", { class: "row" }, add),
  );
}

// ── Connectors (MCP) ──────────────────────────────────────────────────────────

function connectorsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const refresh = h("button", { text: "Ricarica elenco" });

  async function draw() {
    clear(list);
    const names = (await Bridge.mcpServersConfigured()) ?? [];
    // Keep choices for servers that are gone out of the list, but show them.
    const all = [...new Set([...names, ...settings.mcpServers.map((m) => m.name)])];
    if (all.length === 0) {
      list.append(h("div", {
        class: "hint",
        text: "Nessun server MCP configurato in Claude Code. Aggiungine uno da un terminale con «claude mcp add --scope user …», poi premi Ricarica elenco.",
      }));
      return;
    }
    for (const name of all) {
      const missing = !names.includes(name);
      const choice = () => settings.mcpServers.find((m) => m.name === name);
      const use = toggle(!!choice(), (on) => {
        if (on && !choice()) settings.mcpServers.push({ name, confirm: true });
        if (!on) settings.mcpServers = settings.mcpServers.filter((m) => m.name !== name);
        void save();
        void draw();
      });
      const row = h("div", { class: "row" }, use, h("span", { style: "min-width:160px", text: name }));
      if (missing) row.append(h("span", { class: "hint", text: "non più configurato in Claude Code" }));
      const c = choice();
      if (c) {
        row.append(
          h("span", { class: "hint", text: "chiedi conferma per ogni operazione" }),
          toggle(c.confirm, (v) => { c.confirm = v; void save(); }),
        );
      }
      list.append(row);
    }
  }
  refresh.addEventListener("click", () => void draw());
  void draw();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Connettori in chat" }), profileChip()),
    h("div", {
      class: "hint",
      text: "La chat può usare i server MCP che hai configurato in Claude Code (calendario, documenti, ticketing…). Funziona con il motore «Abbonamento Claude». Con la conferma attiva ogni operazione su quel connettore compare nell'isola con Consenti / Nega: disattivala solo per connettori di sola lettura. I connettori di claude.ai non sono disponibili in questa modalità di Claude Code.",
    }),
    list,
    h("div", { class: "row" }, refresh),
  );
}

// ── Widgets ───────────────────────────────────────────────────────────────────

const WIDGET_KINDS: [WidgetDef["kind"], string][] = [
  ["calendar", "Calendario (link ICS)"],
  ["domain", "Scadenza domini"],
  ["http", "Sito web (HTTP)"],
  ["tls", "Certificato HTTPS"],
  ["ping", "Ping"],
  ["tcp", "Porta TCP"],
  ["service", "Servizio Windows"],
  ["json", "API JSON"],
];

/** Mirrors default_every / min_every in src-tauri/src/widgets.rs. */
const EVERY_HINT: Partial<Record<WidgetDef["kind"], string>> = {
  tls: "predefinito 6 ore, minimo 1 ora",
  json: "predefinito 120, minimo 15",
  calendar: "predefinito 5 minuti, minimo 1",
  domain: "predefinito 12 ore, minimo 1 ora",
};

/**
 * A secret kept in the Credential Manager: the field never shows it back, it
 * only says whether one is saved. `what` names it in the "saved" hint.
 */
function secretInput(key: string, placeholder: string, what: string): HTMLInputElement {
  const el = h("input", {
    type: "password", value: "", placeholder,
    style: "flex:1 1 auto;min-width:0", spellcheck: "false",
  }) as HTMLInputElement;
  void Bridge.secretPresent(key).then((has) => { if (has) el.placeholder = `••••••••  (salvato) — incolla un altro ${what} per cambiarlo`; });
  el.addEventListener("change", async () => {
    const v = el.value.trim();
    if (!v) return;
    try {
      await Bridge.secretSet(key, v);
      el.value = "";
      el.placeholder = "••••••••  (salvato)";
    } catch (err) {
      el.placeholder = String(err).replace(/^Error:\s*/, "");
    }
  });
  return el;
}

function blankWidget(kind: WidgetDef["kind"], over: Partial<WidgetDef> = {}): WidgetDef {
  return {
    id: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: WIDGET_KINDS.find(([k]) => k === kind)?.[1] ?? "Widget",
    color: "#38bdf8", kind, every: 0, url: "", method: "GET", headers: [], fields: [],
    alert: null, host: "", port: kind === "tls" ? 443 : 0, expectStatus: 0,
    warnDays: kind === "calendar" ? 10 : 30, service: "",
    ...over,
  };
}

const WIDGET_TEMPLATES: [string, () => WidgetDef][] = [
  ["Calendario", () => blankWidget("calendar", { name: "Calendario", color: "#f97316" })],
  ["Scadenza domini", () => blankWidget("domain", { name: "Domini", color: "#a855f7" })],
  ["Sito cliente", () => blankWidget("http", { name: "Sito cliente", url: "https://", color: "#22c55e" })],
  ["Certificato", () => blankWidget("tls", { name: "Certificato", color: "#f5a524" })],
  ["Server (ping)", () => blankWidget("ping", { name: "Server", color: "#38bdf8" })],
  ["Desktop remoto (3389)", () => blankWidget("tcp", { name: "RDP", port: 3389, color: "#8b5cf6" })],
  ["Spooler di stampa", () => blankWidget("service", { name: "Stampa", service: "Spooler", color: "#8e939c" })],
  ["API JSON", () => blankWidget("json", { name: "API", url: "https://", color: "#6366f1" })],
];

function widgetsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const commit = () => void save();

  function draw() {
    clear(list);
    settings.widgets.forEach((w, idx) => {
      const input = (value: string | number, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0", type = "text") => {
        const el = h("input", { type, value: String(value), placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };
      const row = (label: string, ...children: Node[]) => h("div", { class: "row" }, h("label", { text: label }), ...children);

      const color = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : "#38bdf8" }) as HTMLInputElement;
      color.addEventListener("change", () => { w.color = color.value; commit(); });
      const kind = select<WidgetDef["kind"]>(WIDGET_KINDS, w.kind, (v) => {
        w.kind = v;
        if (v === "tls" && !w.port) w.port = 443;
        commit();
        draw();
      });
      const result = h("div", {});
      const test = h("button", { class: "icon", text: "▶", title: "Prova ora" });
      test.addEventListener("click", async () => {
        clear(result);
        result.append(h("div", { class: "hint", text: "Controllo in corso…" }));
        try {
          const r = await Bridge.widgetTest(w);
          clear(result);
          const cls = r.level === "ok" ? "notice ok" : r.level === "warn" ? "notice warn" : "notice err";
          const detail = r.fields.map((f) => `${f.label}: ${f.value}`).join(" · ");
          result.append(h("div", { class: cls, text: detail ? `${r.summary} — ${detail}` : r.summary }));
        } catch (err) {
          clear(result);
          result.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
        }
      });
      const del = h("button", {
        class: "danger icon", text: "✕", title: "Elimina",
        onclick: () => {
          // Its secrets go with it.
          for (const hd of w.headers) if (hd.secret) void Bridge.secretClear(`widget:${w.id}:${hd.name}`).catch(() => undefined);
          if (w.kind === "calendar") void Bridge.secretClear(`widget:${w.id}:ics`).catch(() => undefined);
          settings.widgets.splice(idx, 1);
          commit();
          draw();
        },
      });

      const card = h("div", { class: "qa-edit" },
        h("div", { class: "row head" },
          input(w.name, "Nome", (v) => { w.name = v.trim(); }),
          color, kind, test, del,
        ),
      );

      switch (w.kind) {
        case "calendar": {
          card.append(
            row("Link ICS", secretInput(`widget:${w.id}:ics`, "https://… o webcal://… (salvato in Gestione credenziali)", "link")),
            h("div", { class: "hint", text: "Google Calendar: Impostazioni → il calendario → «Indirizzo segreto in formato iCal». Outlook.com: Impostazioni → Calendario → Calendari condivisi → Pubblica un calendario → link ICS. iCloud: condividi il calendario come pubblico. Il link è come una password: resta in Gestione credenziali." }),
            row("Avvisa", input(w.warnDays || 10, "10", (v) => { w.warnDays = Math.max(1, Number(v) || 10); }, "width:80px", "number"),
              h("span", { class: "hint note", text: "minuti prima dell'inizio" })),
          );
          break;
        }
        case "domain":
          card.append(
            row("Domini", input(w.host, "es. cliente.it, altrocliente.com", (v) => { w.host = v.trim(); })),
            row("Avvisa da", input(w.warnDays || 30, "30", (v) => { w.warnDays = Number(v) || 30; }, "width:80px", "number"),
              h("span", { class: "hint note", text: "giorni prima della scadenza (in rosso sotto i 7). Fino a 10 domini, separati da virgole; dati da RDAP o WHOIS del registro." })),
          );
          break;
        case "http":
          card.append(
            row("Indirizzo", input(w.url, "https://www.cliente.it", (v) => { w.url = v.trim(); })),
            row("Stato atteso", input(w.expectStatus || "", "vuoto = qualsiasi 2xx/3xx", (v) => { w.expectStatus = Number(v) || 0; }, "width:200px", "number")),
          );
          break;
        case "tls":
          card.append(
            row("Dominio", input(w.host, "www.cliente.it", (v) => { w.host = v.trim(); }),
              input(w.port || 443, "443", (v) => { w.port = Number(v) || 443; }, "width:80px", "number")),
            row("Avvisa da", input(w.warnDays || 30, "30", (v) => { w.warnDays = Number(v) || 30; }, "width:80px", "number"),
              h("span", { class: "hint note", text: "giorni prima della scadenza (in rosso sotto i 7)" })),
          );
          break;
        case "ping":
          card.append(row("Host", input(w.host, "nome o indirizzo IP, es. 192.168.1.10", (v) => { w.host = v.trim(); })));
          break;
        case "tcp":
          card.append(row("Host e porta",
            input(w.host, "server01.cliente.local", (v) => { w.host = v.trim(); }),
            input(w.port || "", "3389", (v) => { w.port = Number(v) || 0; }, "width:90px", "number")));
          break;
        case "service":
          card.append(row("Nome servizio", input(w.service, "es. Spooler, wuauserv", (v) => { w.service = v.trim(); })));
          break;
        case "json": {
          card.append(
            row("Indirizzo",
              select<WidgetDef["method"]>([["GET", "GET"], ["POST", "POST"]], w.method, (v) => { w.method = v; commit(); }),
              input(w.url, "https://api.servizio.it/stato", (v) => { w.url = v.trim(); })),
          );
          // Headers: a secret one goes to the Credential Manager, never here.
          w.headers.forEach((hd, hi) => {
            const key = `widget:${w.id}:${hd.name}`;
            const value = h("input", {
              type: hd.secret ? "password" : "text", value: hd.secret ? "" : hd.value,
              placeholder: hd.secret ? "valore segreto (salvato in Gestione credenziali)" : "valore",
              style: "flex:1 1 auto;min-width:0", spellcheck: "false",
            }) as HTMLInputElement;
            value.addEventListener("change", async () => {
              if (hd.secret) {
                try {
                  await Bridge.secretSet(key, value.value);
                  value.value = "";
                  value.placeholder = "••••••••  (salvato)";
                } catch {
                  value.placeholder = "Nome intestazione non valido per un segreto";
                }
              } else {
                hd.value = value.value;
                commit();
              }
            });
            card.append(row(hi === 0 ? "Intestazioni" : "",
              input(hd.name, "es. Authorization", (v) => { hd.name = v.trim(); }, "width:160px"),
              value,
              h("span", { class: "hint", text: "segreto" }),
              toggle(hd.secret, (v) => { hd.secret = v; if (v) hd.value = ""; commit(); draw(); }),
              h("button", { class: "icon", text: "✕", title: "Rimuovi", onclick: () => { w.headers.splice(hi, 1); commit(); draw(); } }),
            ));
          });
          w.fields.forEach((f, fi) => {
            card.append(row(fi === 0 ? "Campi da mostrare" : "",
              input(f.label, "Etichetta", (v) => { f.label = v; }, "width:160px"),
              input(f.path, "percorso, es. data.tickets.open", (v) => { f.path = v.trim(); }),
              h("button", { class: "icon", text: "✕", title: "Rimuovi", onclick: () => { w.fields.splice(fi, 1); commit(); draw(); } }),
            ));
          });
          const alert = w.alert ?? { path: "", op: ">", value: "" };
          card.append(
            h("div", { class: "row" },
              h("button", { text: "+ Intestazione", onclick: () => { w.headers.push({ name: "", value: "", secret: false }); commit(); draw(); } }),
              h("button", { text: "+ Campo", onclick: () => { w.fields.push({ label: "", path: "" }); commit(); draw(); } }),
            ),
            row("Avvisa se",
              input(alert.path, "percorso", (v) => { alert.path = v.trim(); w.alert = alert.path ? alert : null; }, "width:180px"),
              select<string>(
                [["==", "="], ["!=", "≠"], [">", ">"], ["<", "<"], [">=", "≥"], ["<=", "≤"], ["contains", "contiene"], ["missing", "manca"]],
                alert.op,
                (v) => { alert.op = v; w.alert = alert.path ? alert : null; commit(); },
              ),
              input(alert.value, "valore", (v) => { alert.value = v; w.alert = alert.path ? alert : null; }, "width:120px"),
            ),
          );
          break;
        }
      }
      card.append(row("Ogni",
        input(w.every || "", "predefinito", (v) => { w.every = Math.max(0, Number(v) || 0); }, "width:110px", "number"),
        h("span", { class: "hint", text: `secondi (${EVERY_HINT[w.kind] ?? "predefinito 60, minimo 15"}; ×3 a batteria)` })),
        result);
      list.append(card);
    });
  }

  const templates = h("div", { class: "row" });
  for (const [label, make] of WIDGET_TEMPLATES) {
    templates.append(h("button", { text: `+ ${label}`, onclick: () => { settings.widgets.push(make()); commit(); draw(); } }));
  }
  draw();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Widget" }), profileChip()),
    h("div", {
      class: "hint",
      text: "Controlli che compaiono come pillole accanto al personaggio: il calendario (link ICS), la scadenza dei domini, siti, certificati, server, porte, servizi Windows o qualsiasi API JSON; se ne possono creare quanti servono. Stato del PC, sicurezza, rete, meteo, Outlook e Zammad sono in Integrazioni. Quando un controllo passa da OK a problema, il personaggio ti avvisa. Si fermano quando EasyIsland è in pausa.",
    }),
    list,
    templates,
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

function notifySection(): HTMLElement {
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Notifiche" }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: "Il personaggio si fa vedere per" }),
      select<Settings["notify"]>(
        [
          ["all", "Tutto (attività, fine sessione, integrazioni, avvisi)"],
          ["alerts", "Solo avvisi (permessi, domande, errori, fine)"],
          ["permissions", "Solo richieste di permesso"],
        ],
        settings.notify,
        (v) => { settings.notify = v; void save(); },
      ),
    ),
  );
}

// ── Davanti al cliente ────────────────────────────────────────────────────────

function presenceSection(): HTMLElement {
  const commit = () => void save();
  const apps = h("input", {
    type: "text", value: settings.presenceApps.join(", "), placeholder: "es. AnyDesk, RustDesk", spellcheck: "false",
    style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  apps.addEventListener("change", () => {
    settings.presenceApps = apps.value.split(",").map((s) => s.trim()).filter(Boolean);
    commit();
  });
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Davanti al cliente" }), profileChip()),
    h("div", { class: "hint", text: "Il personaggio si fa da parte quando qualcuno potrebbe vedere il tuo schermo. Si attiva anche a mano: icona nell'area di notifica → Davanti al cliente." }),
    h("div", { class: "row" },
      h("label", { text: "Durante le chiamate" }),
      toggle(settings.presenceMeeting, (v) => { settings.presenceMeeting = v; commit(); }),
      h("span", { class: "hint note", text: "microfono o webcam in uso da qualsiasi app: Teams, Zoom, Meet nel browser, Webex…" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Durante l'assistenza" }),
      toggle(settings.presenceRemote, (v) => { settings.presenceRemote = v; commit(); }),
      h("span", { class: "hint note", text: "qualcuno è collegato a questo PC: Desktop remoto, Assistenza rapida, TeamViewer" }),
    ),
    h("div", { class: "row" }, h("label", { text: "Altri programmi" }), apps),
    h("div", { class: "row" },
      h("label", { text: "Cosa fa" }),
      select<Settings["presenceMode"]>(
        [["hide", "Nasconde il personaggio e silenzia (le richieste di permesso compaiono comunque)"], ["silent", "Solo silenzio, il personaggio resta"]],
        settings.presenceMode,
        (v) => { settings.presenceMode = v; commit(); },
      ),
    ),
  );
}

// ── Messages from scripts ─────────────────────────────────────────────────────

function scriptsSection(hookPath: string): HTMLElement {
  const command = `"${hookPath}" notify "Backup" "Completato in 4 minuti" --stato ok`;
  const feedback = h("div", {});
  const copy = h("button", { text: "Copia comando" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = "Copiato ✓";
    } catch {
      copy.textContent = "Copia non riuscita";
    }
    window.setTimeout(() => { copy.textContent = "Copia comando"; }, 2000);
  });
  const test = h("button", { text: "Prova" });
  test.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.notifyTest();
      feedback.append(h("div", { class: "notice ok", text: "Inviato: guarda l'isola." }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Messaggi dagli script" })),
    h("div", { class: "hint", text: "Qualsiasi script, attività pianificata, n8n o programma può mostrare un messaggio sull'isola. Stato: ok, avviso, errore o info; --apri aggiunge un pulsante con un link. Valgono le regole di questa pagina: in «solo avvisi» passano solo avvisi ed errori." }),
    h("code", { class: "path", style: "display:block;white-space:pre-wrap;word-break:break-all", text: command }),
    h("div", { class: "row" }, copy, test),
    feedback,
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function colorField(current: string, fallback: string, onCommit: (v: string) => void, resetLabel?: string) {
  const input = h("input", { type: "color", value: current || fallback }) as HTMLInputElement;
  input.addEventListener("change", () => onCommit(input.value));
  const row = h("div", { style: "display:flex;align-items:center;gap:10px" }, input);
  if (resetLabel) {
    const reset = h("button", { text: resetLabel });
    reset.addEventListener("click", () => { input.value = fallback; onCommit(""); });
    row.append(reset);
  }
  return row;
}

/** "#rrggbb" for a 0…1 colour. */
function rgbHex(c: RGB): string {
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

function themeSection(): HTMLElement {
  const t = settings.theme;
  const commit = () => void save();
  const pct = (v: number) => Math.round(v * 100);
  // The colour row follows the character: its own colour is the default, and
  // the cube has none to change (it keeps the logo's).
  const colorRow = h("div", { class: "row" });
  const drawColorRow = () => {
    clear(colorRow);
    const c = characters().find((x) => x.id === t.character) ?? characters()[0];
    if (c.kind === "cube") {
      colorRow.append(h("label", { text: "Colore" }),
        h("span", { class: "hint note", text: "EasyTech a riposo ha i colori del logo; negli altri stati prende il colore dello stato" }));
      return;
    }
    colorRow.append(
      h("label", { text: `Colore di ${c.name}` }),
      colorField(t.slimeColor, rgbHex(c.color), (v) => { t.slimeColor = v; commit(); }, "Il suo"),
      h("span", { class: "hint note", text: `negli altri stati ${c.name} prende il colore dello stato` }),
    );
  };
  drawColorRow();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Tema" }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: "Personaggio" }),
      select<string>(
        characters().map((c) => [c.id, c.name] as [string, string]),
        t.character ?? characters()[0].id,
        (v) => { t.character = v; commit(); drawColorRow(); },
      ),
    ),
    colorRow,
    h("div", { class: "row" },
      h("label", { text: "Colore dell'isola" }),
      colorField(t.islandColor, "#000000", (v) => { t.islandColor = v || "#000000"; commit(); }, "Nero"),
    ),
    h("div", { class: "row" },
      h("label", { text: "Opacità dell'isola" }),
      slider(50, 100, 5, pct(t.islandOpacity), "%", (v) => { t.islandOpacity = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Sfondo a isola chiusa" }),
      toggle(t.compactBackground ?? true, (v) => { t.compactBackground = v; commit(); }),
      h("span", { class: "hint note", text: "spento, a isola chiusa resta solo il personaggio, senza il cerchio o la barra dell'isola; aprendola lo sfondo torna. Con la barra al passaggio del mouse le pillole restano senza sfondo" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Volume avvisi" }),
      slider(0, 100, 10, pct(t.volumeAlerts), "%", (v) => { t.volumeAlerts = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Volume interfaccia" }),
      slider(0, 100, 10, pct(t.volumeUi), "%", (v) => { t.volumeUi = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Volume emozioni" }),
      slider(0, 100, 10, pct(t.volumeEmotes), "%", (v) => { t.volumeEmotes = v / 100; commit(); }),
    ),
  );
}

// ── Backup ────────────────────────────────────────────────────────────────────

/** Impostazioni → Generale → Aggiornamenti: the version, the daily check, "Controlla ora". */
function updatesSection(): HTMLElement {
  const status = h("div", {});
  const check = h("button", { text: "Controlla ora" }) as HTMLButtonElement;

  const show = (cls: string, text: string, ...extra: Node[]) => {
    clear(status);
    status.append(h("div", { class: `notice ${cls}` }, h("span", { text }), ...extra));
  };

  check.addEventListener("click", async () => {
    check.disabled = true;
    clear(status);
    status.append(h("div", { class: "hint", text: "Controllo su GitHub…" }));
    try {
      const u = await Bridge.updateCheck();
      if (!u) {
        show("ok", `Hai già l'ultima versione (${version}).`);
      } else {
        const install = h("button", { class: "primary", text: `Installa ${u.version}`, style: "margin-left:10px" }) as HTMLButtonElement;
        install.addEventListener("click", async () => {
          install.disabled = true;
          install.textContent = "Scarico…";
          try {
            await Bridge.updateInstall();
          } catch (err) {
            show("err", String(err).replace(/^Error:\s*/, ""));
          }
        });
        show("warn", `È disponibile EasyIsland ${u.version}. Installando, l'app si chiude e si riapre da sola.`, install);
      }
    } catch (err) {
      show("err", `Controllo non riuscito: ${String(err).replace(/^Error:\s*/, "")}`);
    } finally {
      check.disabled = false;
    }
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Aggiornamenti" })),
    h("div", {
      class: "hint",
      text: "Le nuove versioni arrivano dalle release di GitHub (EdoardoDevelop/easyisland), firmate: l'app verifica la firma prima di installare e installa solo dopo un tuo clic. È l'unica richiesta di rete che non configuri tu, e si può spegnere.",
    }),
    h("div", { class: "row" },
      h("label", { text: "Versione" }),
      h("span", { text: version || "—" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Controllo automatico" }),
      toggle(settings.updateCheck ?? true, (v) => { settings.updateCheck = v; void save(); }),
      h("span", { class: "hint note", text: "all'avvio e una volta al giorno; se c'è una versione nuova te lo dice l'isola" }),
    ),
    h("div", { class: "row" }, check),
    status,
  );
}

function backupSection(): HTMLElement {
  const feedback = h("div", {});
  const exportBtn = h("button", { text: "Esporta…" });
  exportBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      const path = await Bridge.settingsExport();
      feedback.append(h("div", { class: "notice ok", text: `Salvato in ${path}` }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });

  const file = h("input", { type: "file", accept: ".json,application/json", style: "display:none" }) as HTMLInputElement;
  const importBtn = h("button", { text: "Importa…" });
  importBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    clear(feedback);
    try {
      const next = await Bridge.settingsImport(await f.text());
      settings = { ...settings, ...next };
      render();
      // render() replaced this section; report in the new one.
      document.getElementById("backup-feedback")?.append(h("div", {
        class: "notice ok",
        text: "Impostazioni importate. Le chiavi API non sono nel file: reinseriscile qui sopra se servono.",
      }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });
  feedback.id = "backup-feedback";

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Backup e trasferimento" })),
    h("div", {
      class: "hint",
      text: "Esporta tutte le impostazioni, profili compresi, in un file JSON nella cartella Documenti; importalo su un altro PC per ritrovare la stessa isola. Le chiavi API restano in Gestione credenziali e non vengono esportate.",
    }),
    h("div", { class: "row" }, exportBtn, importBtn, file),
    feedback,
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const info = await Bridge.boot();
  if (info) {
    settings = { ...settings, ...info.settings };
    version = info.version;
  } else if (settings.profiles.length === 0) {
    // Plain browser preview (npm run ui): the profiles Rust would have created.
    const rules = () => ({ ssids: [], days: [], from: "", to: "" });
    settings.profiles = [
      { id: "lavoro", name: "Lavoro", values: snapshot(), rules: rules() },
      { id: "casa", name: "Casa", values: snapshot(), rules: rules() },
      { id: "concentrazione", name: "Concentrazione", values: snapshot(), rules: rules() },
    ];
    settings.activeProfile = "lavoro";
  }
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, legacy: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = INTEGRATIONS.flatMap((d) => d.fields.map((f) => f.key));
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  boot = { status, hasKey, present };
  render();

  void onEvent<Settings>("settings-changed", (s) => {
    // Every save comes back here. Only values that really changed are taken:
    // the controls on screen keep editing the very objects they were built
    // from (replacing them made every edit after the first one go nowhere —
    // an action could not be deleted twice).
    const mine = settings as unknown as Record<string, unknown>;
    let redraw = false;
    for (const [k, v] of Object.entries(s)) {
      if (JSON.stringify(mine[k]) === JSON.stringify(v)) continue;
      if (k === "profiles" && sameProfiles(settings.profiles, s.profiles)) {
        // Rust writes the active values into the profile: refresh those in place.
        s.profiles.forEach((p, i) => { settings.profiles[i].values = p.values; });
        continue;
      }
      mine[k] = v;
      redraw = true; // changed elsewhere: a profile switch, a drag, the island
    }
    if (redraw) render();
  });
}

/** Same profiles, same order, same names and rules: only their values may differ. */
function sameProfiles(a: Settings["profiles"], b: Settings["profiles"]): boolean {
  return a.length === b.length && a.every((p, i) =>
    p.id === b[i].id && p.name === b[i].name && JSON.stringify(p.rules) === JSON.stringify(b[i].rules));
}

let boot: { status: HookStatus; hasKey: boolean; present: Record<string, boolean> } | null = null;

interface Page {
  id: string;
  label: string;
  /** An icon of action-icons.ts, drawn in `color`. */
  icon: string;
  color: string;
  title: string;
  intro: string;
  sections: () => HTMLElement[];
}

/** The settings, one page at a time: the window used to be one very long column. */
function pages(b: NonNullable<typeof boot>): Page[] {
  return [
    {
      id: "generale", label: "Generale", icon: "wrench", color: "#94A3B8", title: "Generale",
      intro: "Suono, avvio con Windows e i profili (lavoro, casa…): ogni profilo ha le sue impostazioni.",
      sections: () => [generalSection(), updatesSection(), profilesSection()],
    },
    {
      id: "aspetto", label: "Aspetto", icon: "image", color: "#F472B6", title: "Aspetto",
      intro: "Dove sta l'isola, come si mostra, il personaggio e i colori.",
      sections: () => [placementSection(), themeSection()],
    },
    {
      id: "notifiche", label: "Notifiche", icon: "alert", color: "#F5A524", title: "Notifiche",
      intro: "Quando il personaggio si fa vedere, quando si fa da parte e i messaggi dagli script.",
      sections: () => [notifySection(), presenceSection(), scriptsSection(b.status.hookPath)],
    },
    {
      id: "claude", label: "Claude", icon: "sparkles", color: "#E07A5F", title: "Claude",
      intro: "Le sessioni di Claude Code nell'isola, la chat e i connettori che può usare.",
      sections: () => [claudeSection(b.status), claudeChatSection(b.hasKey), connectorsSection()],
    },
    {
      id: "azioni", label: "Azioni rapide", icon: "bolt", color: "#FACC15", title: "Azioni rapide",
      intro: "Pulsanti della scheda ⚡ e scorciatoie da tastiera.",
      sections: () => [actionsSection()],
    },
    {
      id: "integrazioni", label: "Integrazioni", icon: "network", color: "#38BDF8", title: "Integrazioni",
      intro: "Servizi e programmi, uno per tipo: GitHub, Vercel, n8n, Stripe, Zammad, Outlook, stato del PC, sicurezza, rete, meteo…",
      sections: () => [integrationsSection(b.present)],
    },
    {
      id: "widget", label: "Widget", icon: "chart", color: "#22C55E", title: "Widget",
      intro: "Controlli ripetibili senza codice: calendari, domini, siti, certificati, server, porte, servizi Windows e API.",
      sections: () => [widgetsSection()],
    },
    {
      id: "backup", label: "Backup", icon: "cloud", color: "#A78BFA", title: "Backup e trasferimento",
      intro: "Porta le impostazioni su un altro PC. Le chiavi restano in Gestione credenziali e vanno reinserite.",
      sections: () => [backupSection()],
    },
  ];
}

const PAGE_KEY = "easyisland.settings.page";

function currentPage(list: Page[]): Page {
  // ?page=aspetto opens a given page (handy for screenshots in the browser preview).
  let id = new URLSearchParams(location.search).get("page") ?? "";
  try {
    id ||= localStorage.getItem(PAGE_KEY) ?? "";
  } catch {
    // Storage can be unavailable: the first page then.
  }
  return list.find((p) => p.id === id) ?? list[0];
}

/** Builds the whole window from `settings`; safe to call again after a switch. */
function render() {
  if (!boot) return;
  const list = pages(boot);
  const page = currentPage(list);
  const scroller = root.querySelector(".page");
  const scrollTop = scroller?.getAttribute("data-page") === page.id ? scroller.scrollTop : 0;
  clear(root);

  const nav = h("nav", { class: "nav" },
    h("div", { class: "brand" }, h("span", { text: "EasyIsland" }), h("span", { class: "version", text: version })),
  );
  for (const p of list) {
    const item = h("button", { class: p.id === page.id ? "nav-item on" : "nav-item" },
      h("span", { class: "nav-icon", style: `--c:${p.color}` }, actionIconSvg(actionIcon(`i:${p.icon}`)!, 16)), h("span", { text: p.label }));
    item.addEventListener("click", () => {
      try {
        localStorage.setItem(PAGE_KEY, p.id);
      } catch {
        // Not remembered, that is all.
      }
      render();
    });
    nav.append(item);
  }
  nav.append(h("div", { class: "nav-foot", text: "Nessuna telemetria. Le richieste di rete vanno solo ai servizi che configuri tu." }));

  const body = h("div", { class: "page-inner" },
    h("header", { class: "page-head" }, h("h1", { text: page.title }), h("div", { class: "hint", text: page.intro })),
    ...page.sections(),
  );
  const main = h("main", { class: "page", "data-page": page.id }, body);
  root.append(nav, main);
  main.scrollTop = scrollTop;
}

void main();
