// Settings window — the place where anything that writes to disk is confirmed.
// Sections marked with the profile chip are saved into the active profile;
// the rest belongs to this PC.

import "./settings.css";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type QuickAction, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

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
          ? "Coucou è collegato alle tue sessioni di Claude Code. Strumenti usati, domande e richieste di permesso compaiono nell'isola, e puoi rispondere da lì."
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

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "coucou-hook.exe non è ancora al suo posto. Riavvia Coucou; se non basta, compilalo con `cargo build -p coucou-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? "Reinstalla hook…" : "Installa hook…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "Il relay non è ancora installato.";
    }
    actions.append(install);
    if (status.installed) {
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
          : "Vengono rimosse solo le voci di Coucou. I tuoi hook non vengono toccati.",
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
      text: "La chat usa Claude Code installato su questo PC e il tuo abbonamento Claude (Pro o Max): nessuna chiave e nessun costo extra, ma conta nei limiti d'uso del tuo piano. Claude Code gira nascosto, senza hook, e può solo cercare sul web e leggere i file che rilasci.",
    }),
    h("div", { class: "row" }, cliState, recheck),
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
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Scegli fino a ${MAX_ACTIVE} pillole da mostrare accanto a Mochi (${used}/${MAX_ACTIVE} in uso). Le chiavi restano in Gestione credenziali di Windows, mai su disco.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
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
    (v) => { settings.anchorV = v; commit(); },
  );
  const horizontal = select<Settings["anchorH"]>(
    [["left", "A sinistra"], ["center", "Al centro"], ["right", "A destra"]],
    settings.anchorH,
    (v) => { settings.anchorH = v; commit(); },
  );

  const iconSize = h("div", { class: "row" },
    h("label", { text: "Dimensione" }),
    slider(16, 48, 2, settings.iconSize, "px", (v) => { settings.iconSize = v; commit(); }),
  );
  const iconStyle = select<Settings["iconStyle"]>(
    [
      ["mochi", "Mochi"],
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
    [["icon", "Mochi più grande"], ["bar", "Barra compatta con le integrazioni"]],
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

  const reveal = h("input", {
    type: "number", min: "2", max: "120", step: "1",
    value: String(Math.round(settings.revealDuration)),
    style: "width:72px",
  }) as HTMLInputElement;
  reveal.addEventListener("change", () => {
    settings.revealDuration = Math.max(2, Math.min(120, Number(reveal.value) || 8));
    reveal.value = String(settings.revealDuration);
    commit();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Posizione e aspetto" }), profileChip()),
    h("div", {
      class: "hint",
      text: "Dove vive Mochi. Quando si apre, l'isola cresce dall'angolo scelto e il contenuto resta allineato a quel lato. In basso sta sopra la barra delle applicazioni.",
    }),
    h("div", { class: "row" }, h("label", { text: "Schermo" }), screen),
    h("div", { class: "row" }, h("label", { text: "Posizione" }), vertical, horizontal),
    h("div", { class: "row" }, h("label", { text: "Icona a riposo" }), iconStyle),
    iconSize,
    h("div", { class: "row" }, h("label", { text: "Al passaggio" }), hoverStyle),
    hoverSize,
    h("div", { class: "row" }, h("label", { text: "Apri dopo" }), openDelay),
    h("div", { class: "row" },
      h("label", { text: "Resta visibile" }),
      reveal,
      h("span", { class: "hint", text: "secondi dopo un evento o quando sposti il mouse" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Schermo intero" }),
      toggle(settings.quietFullscreen, (v) => { settings.quietFullscreen = v; commit(); }),
      h("span", { class: "hint", text: "nascondi durante video, giochi e presentazioni (i permessi compaiono comunque)" }),
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

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Generale" })),
    h("div", { class: "hint", text: "Suono e chiusura automatica valgono per il profilo attivo; l'avvio con Windows per questo PC." }),
    h("div", { class: "row" },
      h("label", { text: "Suono" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Chiusura automatica" }),
      autoClose,
      h("span", { class: "hint", text: "secondi dopo che lasci l'isola" }),
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
  "activeIntegrations", "anchorV", "anchorH", "iconStyle", "iconSize", "hoverStyle",
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
      h("span", { class: "hint", text: "attiva il primo profilo le cui regole corrispondono" }),
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
    id: newActionId(), name: "Nuova azione", icon: "⚡", color: "#8b5cf6", kind,
    target: "", args: "", script: "", shell: "powershell", prompt: "",
    input: "clipboard", confirm: true, hotkey: "",
  };
}

/** A starter set for an IT technician; every one can be edited or deleted. */
function exampleActions(): QuickAction[] {
  const a = (over: Partial<QuickAction>): QuickAction => ({ ...blankAction(), ...over, id: newActionId() });
  return [
    a({
      name: "Spiega errore", icon: "🩺", color: "#f4505e", kind: "prompt", input: "clipboard",
      prompt: "Spiega questo messaggio d'errore: cosa significa, le cause più probabili e i passi per risolverlo, dal più semplice al più invasivo.",
    }),
    a({
      name: "Script PowerShell", icon: "🧰", color: "#3b9eff", kind: "prompt", input: "clipboard",
      prompt: "Scrivi uno script PowerShell che faccia quanto descritto qui sotto. Commenta i passaggi, chiedi conferma prima di qualsiasi operazione distruttiva e indica se servono privilegi di amministratore.",
    }),
    a({
      name: "Rapportino", icon: "📝", color: "#22c55e", kind: "prompt", input: "clipboard",
      prompt: "Trasforma questi appunti in un rapportino d'intervento professionale: problema segnalato, attività svolte, esito, eventuali passi successivi e materiale usato.",
    }),
    a({
      name: "Rispondi al cliente", icon: "✉️", color: "#f5a524", kind: "prompt", input: "clipboard",
      prompt: "Scrivi una risposta professionale, chiara e cortese a questa mail di un cliente. Niente tecnicismi inutili.",
    }),
    a({
      name: "Analizza log", icon: "🔎", color: "#6366f1", kind: "prompt", input: "file",
      prompt: "Analizza questo log: errori principali, quando iniziano, causa probabile e cosa controllare per primo.",
    }),
    a({
      name: "Info rete", icon: "🌐", color: "#22d3ee", kind: "script", shell: "powershell", confirm: false,
      script: "Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv4DefaultGateway,DNSServer",
    }),
    a({
      name: "Desktop remoto", icon: "🖥️", color: "#8e939c", kind: "app", target: "mstsc", args: "",
    }),
  ];
}

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
      color.addEventListener("change", () => { a.color = color.value; commit(); });

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
          field(a.icon, "⚡", (v) => { a.icon = v.trim(); }, "width:48px;text-align:center"),
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
  const examples = h("button", { text: "Aggiungi esempi da tecnico IT" });
  examples.addEventListener("click", () => { settings.actions.push(...exampleActions()); commit(); draw(); });

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
    h("div", { class: "row" }, h("label", { text: "Apri Mochi" }),
      hotkeyField(settings.hotkeyOpen, (v) => { settings.hotkeyOpen = v; })),
    h("div", { class: "row" }, h("label", { text: "Chiedi sul testo copiato" }),
      hotkeyField(settings.hotkeyAsk, (v) => { settings.hotkeyAsk = v; }),
      h("span", { class: "hint", text: "scorciatoie di questo PC, valgono in ogni app" })),
    warn,
    list,
    h("div", { class: "row" }, add, examples),
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
      text: "Mochi può usare i server MCP che hai configurato in Claude Code (calendario, documenti, ticketing…). Funziona con il motore «Abbonamento Claude». Con la conferma attiva ogni operazione su quel connettore compare nell'isola con Consenti / Nega: disattivala solo per connettori di sola lettura. I connettori di claude.ai non sono disponibili in questa modalità di Claude Code.",
    }),
    list,
    h("div", { class: "row" }, refresh),
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

function notifySection(): HTMLElement {
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Notifiche" }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: "Mochi si fa vedere per" }),
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

function themeSection(): HTMLElement {
  const t = settings.theme;
  const commit = () => void save();
  const pct = (v: number) => Math.round(v * 100);
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Tema" }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: "Colore di Mochi" }),
      colorField(t.mochiColor, "#fffaf5", (v) => { t.mochiColor = v; commit(); }, "Originale"),
    ),
    h("div", { class: "row" },
      h("label", { text: "Colore dell'isola" }),
      colorField(t.islandColor, "#000000", (v) => { t.islandColor = v || "#000000"; commit(); }, "Nero"),
    ),
    h("div", { class: "row" },
      h("label", { text: "Opacità dell'isola" }),
      slider(50, 100, 5, pct(t.islandOpacity), "%", (v) => { t.islandOpacity = v / 100; commit(); }),
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
      text: "Esporta tutte le impostazioni, profili compresi, in un file JSON nella cartella Documenti; importalo su un altro PC per ritrovare lo stesso Mochi. Le chiavi API restano in Gestione credenziali e non vengono esportate.",
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
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  boot = { status, hasKey, present };
  render();

  void onEvent<Settings>("settings-changed", (s) => {
    // A profile switch (from here, the tray or the automatic rules) changes
    // most values at once: redraw. Ordinary saves only refresh the copy.
    const switched = s.activeProfile !== settings.activeProfile ||
      s.profiles.length !== settings.profiles.length;
    settings = { ...settings, ...s };
    if (switched) render();
  });
}

let boot: { status: HookStatus; hasKey: boolean; present: Record<string, boolean> } | null = null;

/** Builds the whole window from `settings`; safe to call again after a switch. */
function render() {
  if (!boot) return;
  const scrollY = window.scrollY;
  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    profilesSection(),
    claudeSection(boot.status),
    claudeChatSection(boot.hasKey),
    actionsSection(),
    connectorsSection(),
    integrationsSection(boot.present),
    placementSection(),
    notifySection(),
    themeSection(),
    generalSection(),
    backupSection(),
    h("div", {
      class: "hint",
      text: "Nessuna telemetria. Le richieste di rete vanno solo ai servizi che configuri tu.",
    }),
  );
  window.scrollTo(0, scrollY);
}

void main();
