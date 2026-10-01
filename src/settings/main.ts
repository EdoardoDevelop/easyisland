// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
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
  return h("section", {}, h("h2", {}, h("span", { text: "Integrazioni" })), note, list);
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

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Schermo principale" }),
    h("option", { value: "cursor", text: "Schermo sotto il cursore" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Generale" })),
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
      h("label", { text: "L'isola sta su" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Avvia con Windows" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
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

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    claudeSection(status),
    claudeChatSection(hasKey),
    integrationsSection(present),
    generalSection(),
    h("div", {
      class: "hint",
      text: "Nessuna telemetria. Le richieste di rete vanno solo ai servizi che configuri tu.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
