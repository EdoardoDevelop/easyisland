// Settings window — the place where anything that writes to disk is confirmed.
// Sections marked with the profile chip are saved into the active profile;
// the rest belongs to this PC.

import "./settings.css";
import "../character/roster";
import { characters, type RGB } from "../character/character";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { CHAT_ENGINES, DEFAULT_SETTINGS, PROBE_INTEGRATIONS, type Automation, type AutomationStep, type AutomationTrigger, type QuickAction, type IntegrationConfig, type Settings, type WidgetDef } from "../core/state";

const PROBE_INTEGRATION_IDS = Object.keys(PROBE_INTEGRATIONS);
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

/** The tools whose hooks EasyIsland can install (hooks.rs → Target). */
const HOOK_TOOLS = {
  claude: {
    name: "Claude Code", file: "settings.json",
    on: "EasyIsland è collegato alle tue sessioni di Claude Code. Strumenti usati, domande e richieste di permesso compaiono nell'isola, e puoi rispondere da lì.",
    off: "Installa gli hook per vedere le sessioni di Claude Code nell'isola e approvare i permessi senza interrompere quello che stai facendo.",
    done: "Apri una nuova sessione di Claude Code per attivare gli hook.",
  },
  codex: {
    name: "Codex", file: "hooks.json",
    on: "Le sessioni di Codex compaiono nell'isola con una pillola tutta loro: passi, modifiche ai file e richieste di permesso con Consenti / Nega.",
    off: "Se usi Codex (OpenAI), installa i suoi hook: sessioni, modifiche e richieste di permesso arrivano nell'isola come per Claude Code.",
    done: "In Codex apri /hooks e approva gli hook di EasyIsland (Codex chiede di fidarsi degli hook nuovi), poi apri una nuova sessione.",
  },
  gemini: {
    name: "Gemini CLI", file: "settings.json",
    on: "Le sessioni di Gemini CLI compaiono nell'isola: passi, modifiche ai file, ultimo messaggio, e un avviso quando chiede un permesso (a cui rispondi nel suo terminale: Gemini non lascia rispondere da fuori).",
    off: "Se usi Gemini CLI, installa i suoi hook per vedere le sue sessioni nell'isola. I permessi restano nel suo terminale, l'isola ti avvisa quando ne chiede uno.",
    done: "Apri una nuova sessione di Gemini CLI per attivare gli hook.",
  },
} as const;
type HookTool = keyof typeof HOOK_TOOLS;

/** Codex and Gemini CLI: the same section, filled in once their status is read. */
function agentHooksSection(tool: HookTool): HTMLElement {
  const status: HookStatus = { installed: false, legacy: false, settingsPath: "…", hookPath: "", hookReady: false };
  return claudeSection(status, tool, true);
}

function claudeSection(status: HookStatus, tool: HookTool = "claude", refreshFirst = false): HTMLElement {
  const T = HOOK_TOOLS[tool];
  const agent = tool === "claude" ? undefined : tool;
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: T.name })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus(agent);
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: T.name }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed ? T.on : T.off,
      }),
      h("div", { class: "row" },
        h("label", { text: T.file }),
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
      preview = await Bridge.hooksPreview(install, agent);
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
          ? `Ecco esattamente cosa cambierà nel tuo ${T.file}. I tuoi hook non vengono toccati.`
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
        const backup = await Bridge.hooksApply(install, preview.fingerprint, agent);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Fatto. Impostazioni precedenti salvate in ${backup}. ${install ? T.done : ""}`,
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

  if (refreshFirst) void rebuild();
  else draw();
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
  for (const e of CHAT_ENGINES) engine.append(h("option", { value: e.id, text: `${e.name} — ${e.hint}` }));
  engine.value = settings.chatEngine;
  // The model can also be changed from the chat itself (the name above it).
  const other = otherEngineBlock(() => paintDot());

  // ── Subscription block ──
  const cliState = h("span", { class: "hint", text: "Verifica di Claude Code…" });
  const recheck = h("button", { text: "Ricontrolla" });
  // Shown until Claude Code is ready: what to install and how, step by step.
  const INSTALL_CMD = "irm https://claude.ai/install.ps1 | iex";
  const copyCmd = h("button", { text: "Copia" }) as HTMLButtonElement;
  copyCmd.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      copyCmd.textContent = "Copiato ✓";
    } catch {
      copyCmd.textContent = "Non riuscito";
    }
    window.setTimeout(() => (copyCmd.textContent = "Copia"), 1800);
  });
  const howTo = h("div", { class: "notice warn", style: "display:none;flex-direction:column;gap:8px" },
    h("b", { text: "Come preparare Claude Code (una volta sola)" }),
    h("div", { text: "1. Apri PowerShell (tasto Windows, scrivi «PowerShell») e incolla questo comando, poi Invio:" }),
    h("div", { class: "row" }, h("code", { class: "path", text: INSTALL_CMD }), copyCmd),
    h("div", { text: "2. Chiudi e riapri PowerShell, scrivi «claude» e premi Invio: accedi con il tuo account Claude (Pro o Max) come ti chiede." }),
    h("div", { text: "3. Torna qui e premi Ricontrolla: il pallino diventa verde." }),
    h("div", { class: "hint", text: "Non vuoi installarlo? Scegli un altro motore qui sopra: chiave API Anthropic, OpenRouter, OpenAI, Gemini, oppure Ollama o LM Studio sul tuo PC." }));
  const cliBlock = h(
    "div",
    { style: "display:flex;flex-direction:column;gap:10px" },
    h("div", {
      class: "hint",
      text: "Usa il tuo abbonamento Claude (Pro o Max), senza chiavi né costi extra (conta nei limiti d'uso del piano). Serve Claude Code da riga di comando (la CLI) installato su questo PC e con il login fatto: l'app desktop di Claude da sola non basta, perché il suo Claude Code è chiuso dentro l'app e non si può usare da altri programmi. Claude Code gira nascosto, senza hook, e può cercare sul web, leggere i file che rilasci e, se lo permetti qui sotto, usare EasyIsland.",
    }),
    h("div", { class: "row" }, cliState, recheck),
    howTo,
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
      cliState.textContent = "Claude Code da riga di comando non è installato su questo PC: la chat con l'abbonamento non può funzionare.";
    } else if (!status.loggedIn && status.source === "vscode") {
      cliState.textContent = "Trovato solo il Claude Code dell'estensione di VS Code, che non ha il login per l'uso da solo: installa la CLI come spiegato qui sotto.";
    } else if (!status.loggedIn) {
      cliState.textContent = "Claude Code è installato ma senza login: fai solo i passi 2 e 3 qui sotto.";
    } else {
      const from = status.source === "vscode" ? " (quello dell'estensione di VS Code)" : "";
      cliState.textContent = `Pronto: ${status.path}${from}`;
    }
    howTo.style.display = cliReady ? "none" : "flex";
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
    const ready = settings.chatEngine === "api" ? keyPresent
      : settings.chatEngine === "subscription" ? cliReady : other.ready();
    dot.style.background = ready ? "#22c55e" : "#f4505e";
  }

  function showEngine() {
    const api = settings.chatEngine === "api";
    const cli = settings.chatEngine === "subscription";
    apiBlock.style.display = api ? "flex" : "none";
    cliBlock.style.display = cli ? "flex" : "none";
    other.show(settings.chatEngine);
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
    h("h2", {}, dot, h("span", { text: "Chat" })),
    h("div", { class: "row" }, h("label", { text: "Motore" }), engine),
    cliBlock,
    apiBlock,
    other.el,
  );
}

/**
 * OpenRouter, OpenAI, Gemini, Ollama, LM Studio (src-tauri/src/openai.rs): the
 * key (Gestione credenziali) or the local address, and the model, with the list
 * the engine offers ("Carica modelli"). Rebuilt for the engine shown.
 */
function otherEngineBlock(changed: () => void) {
  const el = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  let current = "";
  let keyPresent = false;

  async function draw(id: string) {
    current = id;
    clear(el);
    const e = CHAT_ENGINES.find((x) => x.id === id);
    if (!e || id === "subscription" || id === "api") return;
    settings.engineModels ??= {};
    settings.engineUrls ??= {};
    el.append(h("div", { class: "hint", text: e.key
      ? `La chat chiama ${e.name} con la tua chiave (${e.hint}): si paga a consumo da loro. Nessuno strumento: niente ricerche sul web né azioni sul PC.`
      : `La chat usa ${e.name} su questo PC o in rete (${e.hint}): nulla esce dalla tua rete. Avvialo e scarica almeno un modello.` }));
    const feedback = h("div", {});
    if (e.key) {
      const state = h("span", { class: "hint" });
      const field = h("input", { type: "password", style: "flex:1 1 auto;min-width:0", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
      const saveBtn = h("button", { class: "primary", text: "Salva chiave" });
      const clearBtn = h("button", { class: "danger", text: "Rimuovi" });
      const paint = () => {
        state.textContent = keyPresent ? "Chiave salvata in Gestione credenziali di Windows." : "Nessuna chiave: serve per usare questo motore.";
        field.placeholder = keyPresent ? "••••••••••••  (salvata)" : "incolla la chiave";
        clearBtn.style.display = keyPresent ? "" : "none";
        changed();
      };
      keyPresent = (await Bridge.secretPresent(e.key)) ?? false;
      if (current !== id) return;
      saveBtn.addEventListener("click", async () => {
        const value = field.value.trim();
        if (!value) return;
        clear(feedback);
        try {
          await Bridge.secretSet(e.key!, value);
          field.value = "";
          keyPresent = true;
          feedback.append(h("div", { class: "notice ok", text: "Salvata. Non viene mai scritta su disco." }));
        } catch (err) {
          feedback.append(h("div", { class: "notice err", text: `Salvataggio non riuscito: ${String(err)}` }));
        }
        paint();
      });
      clearBtn.addEventListener("click", async () => {
        clear(feedback);
        try {
          await Bridge.secretClear(e.key!);
          keyPresent = false;
        } catch (err) {
          feedback.append(h("div", { class: "notice err", text: `Rimozione non riuscita: ${String(err)}` }));
        }
        paint();
      });
      el.append(state, h("div", { class: "row" }, h("label", { text: "Chiave API" }), field, saveBtn, clearBtn));
      paint();
    } else {
      const url = h("input", { type: "text", value: settings.engineUrls[id] ?? "", placeholder: e.url ?? "", style: "flex:1 1 auto;min-width:0", spellcheck: "false" }) as HTMLInputElement;
      url.addEventListener("change", () => {
        settings.engineUrls![id] = url.value.trim();
        void save();
      });
      el.append(h("div", { class: "row" }, h("label", { text: "Indirizzo" }), url,
        h("span", { class: "hint note", text: "vuoto = quello predefinito; anche un altro PC della rete" })));
    }
    const listId = `models-${id}`;
    const model = h("input", { type: "text", value: settings.engineModels[id] ?? "", list: listId, placeholder: "nome del modello", style: "flex:1 1 auto;min-width:0", spellcheck: "false" }) as HTMLInputElement;
    const options = h("datalist", { id: listId });
    const load = h("button", { text: "Carica modelli" }) as HTMLButtonElement;
    const loaded = h("span", { class: "hint note" });
    model.addEventListener("change", () => {
      settings.engineModels![id] = model.value.trim();
      void save();
      changed();
    });
    load.addEventListener("click", async () => {
      load.disabled = true;
      loaded.textContent = "Chiedo l'elenco…";
      try {
        const ids = await Bridge.chatModels(id, settings.engineUrls?.[id] || null);
        clear(options);
        for (const m of ids) options.append(h("option", { value: m }));
        loaded.textContent = ids.length ? `${ids.length} modelli: scrivi per cercare` : "Nessun modello disponibile.";
        if (!model.value && ids.length) {
          model.value = ids[0];
          model.dispatchEvent(new Event("change"));
        }
      } catch (err) {
        loaded.textContent = String(err).replace(/^Error:\s*/, "");
      }
      load.disabled = false;
    });
    el.append(h("div", { class: "row" }, h("label", { text: "Modello" }), model, options, load), loaded, feedback);
    changed();
  }

  return {
    el,
    show(id: string) {
      const mine = id !== "subscription" && id !== "api";
      el.style.display = mine ? "flex" : "none";
      if (mine && id !== current) void draw(id);
      if (!mine) current = "";
    },
    ready(): boolean {
      const e = CHAT_ENGINES.find((x) => x.id === current);
      return !!e && !!settings.engineModels?.[current] && (!e.key || keyPresent);
    },
  };
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown; `when` hides a field that does not apply. */
  fields: { key: string; label: string; placeholder: string; secret: boolean; when?: (c: IntegrationConfig) => boolean }[];
  /** Options kept in settings.integrationConfig (the integrations run as checks). */
  options?: IntegrationOption[];
  /** What it shows and where the data comes from. */
  hint?: string;
}

interface IntegrationOption {
  label: string;
  type: "number" | "text" | "select";
  placeholder: string;
  /** For "select": value → label. */
  choices?: [string, string][];
  /** Shown only when this holds (it is checked again when an option changes). */
  when?: (c: IntegrationConfig) => boolean;
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
  { id: "integration_3cx", name: "3CX", color: "#0596D4",
    options: [
      { label: "Accesso", type: "select", placeholder: "",
        choices: [["user", "Interno e password (come l'app 3CX)"], ["api", "Client API (Admin Console, licenza 8SC+)"]],
        get: (c) => c.threecxMode ?? "user", set: (c, v) => { c.threecxMode = v === "api" ? "api" : "user"; } },
      { label: "Interno", type: "text", placeholder: "es. 101", when: (c) => c.threecxMode === "api",
        get: (c) => c.threecxExtension ?? "", set: (c, v) => { c.threecxExtension = v.trim(); } },
    ],
    fields: [
      { key: "3cx-url", label: "Indirizzo", placeholder: "https://azienda.my3cx.it:5001", secret: false },
      { key: "3cx-user", label: "Interno o e-mail", placeholder: "es. 101", secret: false, when: (c) => c.threecxMode !== "api" },
      { key: "3cx-password", label: "Password", placeholder: "la password del web client", secret: true, when: (c) => c.threecxMode !== "api" },
      { key: "3cx-client-id", label: "Client ID", placeholder: "il Client ID del client API", secret: false, when: (c) => c.threecxMode === "api" },
      { key: "3cx-client-secret", label: "Chiave API", placeholder: "mostrata una volta sola", secret: true, when: (c) => c.threecxMode === "api" },
    ],
    hint: "Chiamate, chiamate in arrivo con Rispondi / Rifiuta, rubrica, stato e chiamate perse, nella scheda 3CX dell'isola. Con interno e password funziona come l'app 3CX (accesso non documentato da 3CX: un aggiornamento del centralino potrebbe cambiarlo; la verifica in due passaggi non è ancora supportata). Con un client API: Admin Console → Integrazioni → API → Aggiungi, spunta \"3CX Call Control API Access\" (e \"Configuration API\" per la rubrica), aggiungi il tuo interno tra quelli monitorati; stato e cronologia non ci sono. Numeri e nomi restano in memoria." },
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
  integration_zammad: "🎫", integration_3cx: "📞", integration_system: "💻", integration_security: "🛡️", integration_network: "🌐",
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
    // Rows that apply only to some option values (3CX: login or API client).
    const conditional: [HTMLElement, (c: IntegrationConfig) => boolean][] = [];
    const syncVisible = () => {
      for (const [row, when] of conditional) row.style.display = when(settings.integrationConfig) ? "" : "none";
    };
    for (const opt of def.options ?? []) {
      let el: HTMLInputElement | HTMLSelectElement;
      if (opt.type === "select") {
        el = select(opt.choices ?? [], String(opt.get(settings.integrationConfig)), () => {});
      } else {
        el = h("input", {
          type: opt.type, value: String(opt.get(settings.integrationConfig)), placeholder: opt.placeholder,
          spellcheck: "false", style: opt.type === "number" ? "width:80px" : "flex:1 1 auto;min-width:0",
        }) as HTMLInputElement;
      }
      el.addEventListener("change", () => {
        opt.set(settings.integrationConfig, el.value);
        el.value = String(opt.get(settings.integrationConfig));
        syncVisible();
        void save();
      });
      const row = h("div", { class: "row" },
        h("label", { style: "min-width:104px", text: opt.label }),
        el,
        opt.unit ? h("span", { class: "hint note", text: opt.unit }) : null,
      );
      if (opt.when) conditional.push([row, opt.when]);
      rows.append(row);
    }
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
        } catch (e) {
          dotEl.style.background = "#f5a524";
          // Windows refuses new entries when its Credential Manager is nearly full.
          const full = /memoria|memory|\b8\b|1312/i.test(String(e));
          saveError.textContent = full
            ? "Non salvata: Gestione credenziali di Windows è piena. Elimina le voci che non servono (es. le centinaia di token di Xbox) e riprova."
            : `Non salvata: ${String(e).replace(/^Error:\s*/, "")}`;
          saveError.style.display = "";
        }
      });
      const saveError = h("div", { class: "notice warn", style: "display:none" });
      input.addEventListener("input", () => { saveError.style.display = "none"; });
      const row = h("div", { style: "display:flex;flex-direction:column;gap:4px" },
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
        saveError,
      );
      if (field.when) conditional.push([row, field.when]);
      rows.append(row);
    }
    syncVisible();
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
  // Pills and tabs are dragged into order right in the island.
  const resetOrder = h("button", { text: "Ripristina l'ordine", title: "Torna all'ordine predefinito" });
  resetOrder.addEventListener("click", () => { settings.pillOrder = []; settings.tabOrder = []; void save(); });
  const orderRow = h("div", { class: "row" },
    h("label", { text: "Blocca lo spostamento" }),
    toggle(!!settings.lockOrder, (v) => { settings.lockOrder = v; void save(); }),
    resetOrder,
    h("span", { class: "hint note", text: "nell'isola pillole e schede (anche ⌂ 💬 ⚡ +) si riordinano trascinandole; acceso, restano dove sono" }));
  return h("section", {}, h("h2", {}, h("span", { text: "Integrazioni" }), profileChip()), note, orderRow, list);
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

// ── Shortcut fields ───────────────────────────────────────────────────────────

/** KeyboardEvent.code → the key name hotkeys.rs understands (`parse`). */
function hotkeyKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return ({ Space: "Space", Enter: "Enter", NumpadEnter: "Enter", Tab: "Tab", Escape: "Esc" } as Record<string, string>)[code] ?? null;
}

function hotkeyModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");
  return mods;
}

/**
 * A shortcut field that listens: click it and press the keys. Global shortcuts
 * are suspended while it listens, so the keys land here instead of firing.
 * Esc gives up, Canc / Backspace empties it; a key needs Ctrl, Alt, Shift or Win.
 */
function hotkeyInput(value: string, apply: (v: string) => void): HTMLElement {
  let current = value.trim();
  const el = h("input", {
    type: "text", readonly: "true", class: "hotkey-input", spellcheck: "false",
    placeholder: "nessuna", title: "Clic, poi premi la combinazione di tasti",
  }) as HTMLInputElement;
  const hint = h("span", { class: "hint note hotkey-hint" });
  const clearBtn = h("button", { class: "hotkey-clear", title: "Nessuna scorciatoia", text: "✕" });
  const show = () => {
    el.value = current;
    clearBtn.style.visibility = current ? "" : "hidden";
  };
  const set = (v: string) => {
    if (v !== current) {
      current = v;
      apply(v);
    }
    show();
  };

  el.addEventListener("focus", () => {
    el.classList.add("listening");
    el.value = "";
    el.placeholder = "Premi i tasti…";
    hint.textContent = "Esc annulla · Canc toglie la scorciatoia";
    void Bridge.hotkeysSuspend(true);
  });
  el.addEventListener("blur", () => {
    el.classList.remove("listening");
    el.placeholder = "nessuna";
    hint.textContent = "";
    show();
    void Bridge.hotkeysSuspend(false);
  });
  el.addEventListener("keydown", (e) => {
    // Plain Tab still moves to the next field.
    if (e.code === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const mods = hotkeyModifiers(e);
    const bare = mods.length === 0 || (mods.length === 1 && mods[0] === "Shift");
    if (e.code === "Escape" && mods.length === 0) { el.blur(); return; }
    if ((e.code === "Backspace" || e.code === "Delete") && mods.length === 0) { set(""); el.blur(); return; }
    const key = hotkeyKeyName(e.code);
    if (!key) {
      // Only modifiers so far: show them while the user is still pressing.
      el.value = mods.length ? `${mods.join("+")}+…` : "";
      return;
    }
    if (bare) {
      hint.textContent = "Aggiungi Ctrl, Alt o Win: un tasto da solo varrebbe in ogni app";
      el.value = [...mods, key].join("+");
      return;
    }
    set([...mods, key].join("+"));
    el.blur();
  });
  el.addEventListener("keyup", () => {
    if (el.classList.contains("listening") && el.value.endsWith("+…")) el.value = "";
  });
  clearBtn.addEventListener("click", () => set(""));
  show();
  return h("span", { class: "hotkey-field" }, el, clearBtn, hint);
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
        hotkeyInput(a.hotkey, (v) => { a.hotkey = v; commit(); })));
      list.append(card);
    });
  }

  const hotkeyField = (value: string, apply: (v: string) => void) =>
    hotkeyInput(value, (v) => { apply(v); commit(); });

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
      hotkeyField(settings.hotkeyClipboard, (v) => { settings.hotkeyClipboard = v; })),
    h("div", { class: "row" }, h("label", { text: "Cattura una zona e chiedi" }),
      hotkeyField(settings.hotkeyScreenshot, (v) => { settings.hotkeyScreenshot = v; }),
      h("span", { class: "hint note", text: "scorciatoie di questo PC, valgono in ogni app" })),
    h("div", { class: "row" }, h("label", { text: "Vai alla richiesta in attesa" }),
      hotkeyField(settings.hotkeyPending, (v) => { settings.hotkeyPending = v; }),
      h("span", { class: "hint note", text: "poi N nega, Y consente, S sempre; 1–9 sceglie una risposta" })),
    h("div", { class: "row" }, h("label", { text: "Porta avanti la sessione" }),
      hotkeyField(settings.hotkeySession, (v) => { settings.hotkeySession = v; }),
      h("span", { class: "hint note", text: "l'app dove gira la sessione: terminale, VS Code, Cursor o Claude" })),
    h("div", { class: "row" }, h("label", { text: "Pillola successiva" }),
      hotkeyField(settings.hotkeyNextPill ?? "", (v) => { settings.hotkeyNextPill = v; })),
    h("div", { class: "row" }, h("label", { text: "Suoni sì / no" }),
      hotkeyField(settings.hotkeyMute ?? "", (v) => { settings.hotkeyMute = v; }),
      h("span", { class: "hint note", text: "Isola aperta: ← → pillole, ↑ ↓ scorre, Ctrl+N nuova chat, Ctrl+P tieni aperta, Esc chiude" })),
    h("div", { class: "row" }, h("label", { text: "Suggerimenti per l'app in uso" }),
      toggle(settings.contextActions !== false, (v) => { settings.contextActions = v; void save(); }),
      h("span", { class: "hint note", text: "in cima alla scheda ⚡: per Outlook, Excel, Word, il browser, il codice… usano il testo che hai selezionato" })),
    warn,
    list,
    h("div", { class: "row" }, add),
  );
}

// ── Automations ───────────────────────────────────────────────────────────────

const TRIGGER_KINDS: [AutomationTrigger["kind"], string][] = [
  ["time", "A un orario"],
  ["startup", "All'avvio (con il PC)"],
  ["unlock", "Quando sblocchi il PC"],
  ["wifi", "Quando ti colleghi a una rete Wi-Fi"],
  ["app", "Quando parte un programma"],
  ["drive", "Quando colleghi una chiavetta o un disco"],
  ["folder", "Quando arriva un file in una cartella"],
  ["integration", "Quando un'integrazione o un widget segnala…"],
];

const STEP_KINDS: [AutomationStep["kind"], string][] = [
  ["quick", "Esegui un'azione rapida"],
  ["notice", "Mostra un avviso nell'isola"],
  ["profile", "Passa a un profilo"],
  ["app", "Apri un programma o una cartella"],
  ["url", "Apri un link"],
];

function blankStep(kind: AutomationStep["kind"] = "notice"): AutomationStep {
  return { kind, id: "", title: "", text: "", level: "info", target: "", args: "", url: "" };
}

function blankAutomation(): Automation {
  return {
    id: `a${Date.now().toString(36)}`,
    name: "Nuova automazione",
    enabled: true,
    trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5], delay: 30, ssid: "", exe: "", folder: "", source: "", when: "problem" },
    profile: "",
    steps: [{ ...blankStep("notice"), title: "Buongiorno!", text: "Si comincia." }],
    notify: false,
  };
}

function automationsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const commit = () => void save();

  /** Quick actions of every profile, by id (an automation can use any of them). */
  function quickActions(): [string, string][] {
    const seen = new Map<string, string>();
    for (const a of settings.actions ?? []) seen.set(a.id, a.name || "Senza nome");
    for (const p of settings.profiles) {
      const acts = (p.values as Record<string, unknown>).actions;
      if (Array.isArray(acts)) {
        for (const a of acts as QuickAction[]) if (!seen.has(a.id)) seen.set(a.id, `${a.name || "Senza nome"} (${p.name})`);
      }
    }
    return [...seen.entries()];
  }

  /** Integrations run as checks and widgets: what "segnala" can listen to. */
  function sources(): [string, string][] {
    const out: [string, string][] = [];
    for (const def of INTEGRATIONS) {
      if (PROBE_INTEGRATION_IDS.includes(def.id) && settings.activeIntegrations.includes(def.id)) out.push([def.id, def.name]);
    }
    for (const w of settings.widgets ?? []) out.push([w.id, w.name || "Widget"]);
    return out;
  }

  function draw() {
    clear(list);
    if (settings.automations.length === 0) {
      list.append(h("div", { class: "hint", text: "Nessuna automazione. Esempi: alle 9 dei giorni feriali apri Outlook e il gestionale; quando colleghi una chiavetta mostra un avviso; quando il sito di un cliente va giù esegui lo script di controllo." }));
    }
    settings.automations.forEach((a, idx) => {
      const t = a.trigger;
      const field = (value: string, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0") => {
        const el = h("input", { type: "text", value, placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };
      const tested = h("span", { class: "hint note" });
      const test = h("button", { text: "Prova ora", title: "Esegue subito i passi (salva prima)" });
      test.addEventListener("click", async () => {
        await save();
        try {
          await Bridge.automationRunNow(a.id);
          tested.textContent = "eseguita: vedi il registro qui sotto";
        } catch (e) {
          tested.textContent = String(e).replace(/^Error:\s*/, "");
        }
      });
      const del = h("button", { class: "danger icon", text: "✕", title: "Elimina",
        onclick: () => { settings.automations.splice(idx, 1); commit(); draw(); } });

      const card = h("div", { class: "qa-edit" },
        h("div", { class: "row head" },
          toggle(a.enabled, (v) => { a.enabled = v; commit(); }),
          field(a.name, "Nome", (v) => { a.name = v.trim(); }),
          test, del),
      );

      // ── Quando ──
      const when = h("div", { class: "row" }, h("label", { text: "Quando" }),
        select<AutomationTrigger["kind"]>(TRIGGER_KINDS, t.kind, (v) => { t.kind = v; commit(); draw(); }));
      card.append(when);
      switch (t.kind) {
        case "time": {
          const time = h("input", { type: "time", value: t.time || "09:00" }) as HTMLInputElement;
          time.addEventListener("change", () => { t.time = time.value; commit(); });
          const days = h("div", { class: "days" });
          for (const [d, label] of DAYS) {
            const b = h("button", { class: t.days.includes(d) ? "day on" : "day", text: label, title: "Vuoto = tutti i giorni" });
            b.addEventListener("click", () => {
              t.days = t.days.includes(d) ? t.days.filter((x) => x !== d) : [...t.days, d].sort();
              b.classList.toggle("on");
              commit();
            });
            days.append(b);
          }
          card.append(h("div", { class: "row" }, h("label", { text: "Alle" }), time, days,
            h("span", { class: "hint note", text: "nessun giorno = tutti i giorni" })));
          break;
        }
        case "startup": {
          const delay = h("input", { type: "number", min: "5", value: String(t.delay || 30), style: "width:80px" }) as HTMLInputElement;
          delay.addEventListener("change", () => { t.delay = Math.max(5, Number(delay.value) || 30); commit(); });
          card.append(h("div", { class: "row" }, h("label", { text: "Dopo" }), delay,
            h("span", { class: "hint note", text: "secondi dall'avvio di EasyIsland (che parte con Windows, se attivo in Generale)" })));
          break;
        }
        case "wifi":
          card.append(h("div", { class: "row" }, h("label", { text: "Rete" }),
            field(t.ssid, "nome della rete Wi-Fi, es. Ufficio-5G", (v) => { t.ssid = v.trim(); })));
          break;
        case "app":
          card.append(h("div", { class: "row" }, h("label", { text: "Programma" }),
            field(t.exe, "nome dell'eseguibile, es. teams.exe, excel.exe", (v) => { t.exe = v.trim(); })));
          break;
        case "folder":
          card.append(h("div", { class: "row" }, h("label", { text: "Cartella" }),
            field(t.folder, "es. C:\\Users\\nome\\Downloads o \\\\server\\scansioni", (v) => { t.folder = v.trim(); })));
          break;
        case "integration": {
          const opts = sources();
          if (!t.source && opts[0]) t.source = opts[0][0];
          card.append(h("div", { class: "row" }, h("label", { text: "Da" }),
            opts.length
              ? select<string>(opts, t.source, (v) => { t.source = v; commit(); })
              : h("span", { class: "hint", text: "Accendi un'integrazione come Stato del PC, Rete, Outlook o Zammad, o crea un widget." }),
            select<AutomationTrigger["when"]>(
              [["problem", "un problema (diventa giallo o rosso)"], ["event", "una novità (es. nuovo ticket)"], ["any", "un problema o una novità"]],
              (t.when || "problem") as AutomationTrigger["when"], (v) => { t.when = v; commit(); })));
          break;
        }
      }

      // ── Se ──
      card.append(h("div", { class: "row" }, h("label", { text: "Solo nel profilo" }),
        select<string>([["", "Qualsiasi profilo"], ...settings.profiles.map((p): [string, string] => [p.id, p.name])],
          a.profile, (v) => { a.profile = v; commit(); })));

      // ── Allora ──
      a.steps.forEach((s, si) => {
        const remove = h("button", { class: "danger icon", text: "✕", title: "Togli questo passo",
          onclick: () => { a.steps.splice(si, 1); commit(); draw(); } });
        const row = h("div", { class: "row" }, h("label", { text: si === 0 ? "Allora" : "poi" }),
          select<AutomationStep["kind"]>(STEP_KINDS, s.kind, (v) => { a.steps[si] = { ...blankStep(v) }; commit(); draw(); }));
        switch (s.kind) {
          case "quick": {
            const opts = quickActions();
            if (!s.id && opts[0]) s.id = opts[0][0];
            row.append(opts.length
              ? select<string>(opts, s.id, (v) => { s.id = v; commit(); })
              : h("span", { class: "hint", text: "Crea prima un'azione rapida." }));
            break;
          }
          case "notice":
            row.append(
              field(s.title, "Titolo", (v) => { s.title = v; }, "width:160px"),
              field(s.text, "Testo", (v) => { s.text = v; }),
              select<string>([["info", "Info"], ["ok", "Ok"], ["warn", "Avviso"], ["error", "Errore"]], s.level || "info",
                (v) => { s.level = v; commit(); }));
            break;
          case "profile": {
            if (!s.id && settings.profiles[0]) s.id = settings.profiles[0].id;
            row.append(select<string>(settings.profiles.map((p): [string, string] => [p.id, p.name]), s.id,
              (v) => { s.id = v; commit(); }));
            break;
          }
          case "app":
            row.append(
              field(s.target, "es. outlook, C:\\Clienti, mstsc", (v) => { s.target = v.trim(); }),
              field(s.args, "argomenti (facoltativi)", (v) => { s.args = v; }, "width:160px"));
            break;
          case "url":
            row.append(field(s.url, "https://…", (v) => { s.url = v.trim(); }));
            break;
        }
        row.append(remove);
        card.append(row);
      });
      const addStep = h("button", { text: "+ Aggiungi un passo",
        onclick: () => { a.steps.push(blankStep("quick")); commit(); draw(); } });
      card.append(h("div", { class: "row" }, h("label", { text: "" }), addStep,
        h("span", { class: "hint", text: "Avvisami ogni volta" }),
        toggle(a.notify, (v) => { a.notify = v; commit(); }),
        tested));
      list.append(card);
    });
  }

  const add = h("button", { class: "primary", text: "Aggiungi automazione" });
  add.addEventListener("click", () => { settings.automations.push(blankAutomation()); commit(); draw(); });

  // ── Registro ──
  const logBox = h("div", { class: "auto-log" });
  async function drawLog() {
    const entries = (await Bridge.automationsLog()) ?? [];
    clear(logBox);
    if (entries.length === 0) {
      logBox.append(h("div", { class: "hint", text: "Ancora nessuna esecuzione da quando EasyIsland è partito." }));
      return;
    }
    for (const e of entries.slice(0, 30)) {
      const when = new Date(e.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      logBox.append(h("div", { class: "auto-log-row" },
        statusDot(e.ok),
        h("span", { class: "auto-log-when", text: when }),
        h("b", { text: e.name }),
        h("span", { class: "hint", text: e.cause }),
        h("span", { class: "auto-log-detail", text: e.detail })));
    }
  }
  void onEvent<null>("automations-log", () => void drawLog());

  draw();
  void drawLog();

  // ── Proposals from the habits ──
  const habitsBox = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  async function drawHabits() {
    clear(habitsBox);
    if (!settings.habitsEnabled) {
      habitsBox.append(h("div", { class: "hint", text: "Spento. Acceso, EasyIsland annota quando apri i programmi (solo il nome, mai titoli o contenuti), quando accendi o sblocchi il PC, la rete Wi-Fi, le chiavette collegate, le azioni rapide e i profili scelti a mano. Tutto resta su questo PC (45 giorni al massimo) e da lì propone automazioni: una al giorno al massimo, da accettare o rifiutare." }));
    } else {
      const st = await Bridge.habitsStats();
      const since = st?.since ? new Date(st.since).toLocaleDateString("it-IT") : "";
      habitsBox.append(h("div", { class: "row" },
        h("span", { class: "hint", text: st && st.events
          ? `${st.events} eventi in ${st.days} giorni${since ? `, dal ${since}` : ""}. Servono almeno 1–3 settimane per le prime proposte.`
          : "Nessun evento ancora: le prime proposte arrivano dopo qualche settimana di uso." }),
        h("button", { class: "danger", text: "Cancella lo storico", onclick: async () => {
          await Bridge.habitsClear();
          void drawHabits();
        } })));
      const list = (await Bridge.habitsSuggestions()) ?? [];
      habitsBox.append(h("h3", { text: "Proposte" }));
      if (list.length === 0) habitsBox.append(h("div", { class: "hint", text: "Nessuna proposta per ora." }));
      for (const g of list) {
        const answer = (choice: "create" | "snooze" | "dismiss") => async () => {
          try { await Bridge.habitAnswer(g.fp, choice); } catch { /* shown by the list refresh */ }
          void drawHabits();
        };
        habitsBox.append(h("div", { class: "qa-edit" },
          h("b", { text: g.title }), h("div", { class: "hint", text: g.text }),
          h("div", { class: "row" },
            h("button", { class: "primary", text: g.accept || "Crea", onclick: answer("create") }),
            h("button", { text: "Non ora", onclick: answer("snooze") }),
            h("button", { text: "No, mai", onclick: answer("dismiss") }))));
      }
    }
    const refused = settings.suggestionsDismissed ?? [];
    if (refused.length) {
      habitsBox.append(h("h3", { text: "Proposte rifiutate" }));
      for (const r of refused) {
        habitsBox.append(h("div", { class: "row" },
          h("span", { style: "flex:1 1 auto", text: r.title }),
          h("button", { text: (r as { accept?: string }).accept === "Spegni" ? "Spegni comunque" : "Crea comunque", onclick: async () => {
            try { await Bridge.habitAnswer(r.fp, "create"); } catch { /* the settings echo redraws */ }
          } }),
          h("button", { text: "Togli dai rifiutati", title: "Potrà essere riproposta", onclick: async () => {
            await Bridge.habitAnswer(r.fp, "restore");
          } })));
      }
    }
  }
  void onEvent<null>("habits-changed", () => void drawHabits());
  void drawHabits();

  return h("section", {},
    h("h2", {}, h("span", { text: "Automazioni" })),
    h("div", { class: "hint", text: "Quando succede qualcosa, EasyIsland esegue i passi che scegli, senza chiedere: le hai approvate creandole. Fanno eccezione gli script con \"Chiedi conferma\" e le domande a Claude, che si aprono nell'isola. In pausa non parte niente. Valgono per questo PC; ognuna si può limitare a un profilo." }),
    list,
    h("div", { class: "row" }, add),
    h("h3", { text: "Proposte dalle tue abitudini" }),
    h("div", { class: "row" }, h("label", { text: "Proponimi automazioni" }),
      toggle(settings.habitsEnabled === true, (v) => { settings.habitsEnabled = v; void save().then(() => drawHabits()); }),
      h("span", { class: "hint note", text: "da attivare a mano; tutto resta su questo PC" })),
    h("div", { class: "row" }, h("label", { text: "Programmi da non osservare" }),
      (() => {
        const el = h("input", { type: "text", value: (settings.habitsExcluded ?? []).join(", "),
          placeholder: "es. steam.exe, spotify", spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
        el.addEventListener("change", () => {
          settings.habitsExcluded = el.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
          void save();
        });
        return el;
      })()),
    habitsBox,
    h("h3", { text: "Registro" }),
    h("div", { class: "row" }, h("button", { text: "Aggiorna", onclick: () => void drawLog() }),
      h("span", { class: "hint note", text: "le ultime esecuzioni, solo in memoria" })),
    logBox,
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
      id: "claude", label: "Agenti e chat", icon: "sparkles", color: "#E07A5F", title: "Agenti e chat",
      intro: "Le sessioni di Claude Code, Codex e Gemini CLI nell'isola, la chat con il motore che preferisci e i connettori che può usare.",
      sections: () => [claudeSection(b.status), agentHooksSection("codex"), agentHooksSection("gemini"), claudeChatSection(b.hasKey), connectorsSection()],
    },
    {
      id: "azioni", label: "Azioni rapide", icon: "bolt", color: "#FACC15", title: "Azioni rapide",
      intro: "Pulsanti della scheda ⚡ e scorciatoie da tastiera.",
      sections: () => [actionsSection()],
    },
    {
      id: "automazioni", label: "Automazioni", icon: "rocket", color: "#22D3EE", title: "Automazioni",
      intro: "Quando succede qualcosa (un orario, l'avvio, una rete, un programma, una chiavetta, un file, un avviso), EasyIsland fa qualcosa per te.",
      sections: () => [automationsSection()],
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
