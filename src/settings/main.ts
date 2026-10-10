// Settings window — the place where anything that writes to disk is confirmed.
// Sections marked with the profile chip are saved into the active profile;
// the rest belongs to this PC.

import "./settings.css";
import "../character/roster";
import { characters, type RGB } from "../character/character";
import { Bridge, onEvent, type HookStatus, type ModelOption } from "../core/bridge";
import { folderLook, folderValue, CHAT_ENGINES, DEFAULT_SETTINGS, PROBE_INTEGRATIONS, type Automation, type AutomationStep, type AutomationTrigger, type QuickAction, type IntegrationConfig, type Settings, type WidgetDef } from "../core/state";

const PROBE_INTEGRATION_IDS = Object.keys(PROBE_INTEGRATIONS);
import { h, clear, TAB_ICONS } from "../views/dom";
import { BRAND_SVG } from "../views/brands";
import { ISLAND_MIN_W, PANEL_H, PANEL_W, islandMax } from "../core/layout";
import { ACTION_ICONS, actionIcon, actionIconSvg, renderActionIcon } from "../views/action-icons";
import { language, locale, resolveLanguage, syncLanguage, t } from "../core/i18n";

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

// ── Agents (Agenti page) ──────────────────────────────────────────────────────

/** The tools whose hooks EasyIsland can install (hooks.rs → Target). */
const HOOK_TOOLS = {
  claude: {
    name: "Claude Code", file: "settings.json",
    what: t("Sessioni, domande, diff ed esito dei test; permessi con Consenti / Nega / Sempre dall'isola. Prende anche la status line, per leggere i limiti del piano (Pro / Max) nella card Consumo: se ne avevi una, continua a comparire uguale."),
    done: t("Apri una nuova sessione di Claude Code per attivare gli hook."),
  },
  codex: {
    name: "Codex", file: "hooks.json",
    what: t("Sessioni e diff; permessi con Consenti / Nega. Dopo l'installazione approva gli hook in Codex con /hooks."),
    done: t("In Codex apri /hooks e approva gli hook di EasyIsland, poi apri una nuova sessione."),
  },
  gemini: {
    name: "Gemini CLI", file: "settings.json",
    what: t("Sessioni, diff e ultimo messaggio. I permessi restano nel suo terminale: l'isola ti avvisa."),
    done: t("Apri una nuova sessione di Gemini CLI per attivare gli hook."),
  },
  cursor: {
    name: "Cursor", file: "hooks.json",
    what: t("Solo da guardare: comandi con l'esito dei test, diff, connettori e fine del lavoro."),
    done: t("Riapri Cursor (o una nuova chat dell'agente) per attivare gli hook."),
  },
  copilot: {
    name: t("GitHub Copilot CLI"), file: "easyisland.json",
    what: t("Solo da guardare: strumenti, esito dei test, diff e fine del lavoro."),
    done: t("Apri una nuova sessione di Copilot CLI per attivare gli hook."),
  },
  opencode: {
    name: "opencode", file: "easyisland.js",
    what: t("opencode 2: accendi l'interruttore, EasyIsland segue il suo servizio in background senza installare nulla; i permessi arrivano con Consenti / Nega / Sempre. Il plugin serve solo a opencode 1.x."),
    done: t("Riavvia opencode per caricare il plugin."),
  },
} as const;
type HookTool = keyof typeof HOOK_TOOLS;

const AGENT_ORDER: HookTool[] = ["claude", "codex", "opencode", "gemini", "cursor", "copilot"];

/**
 * Every coding agent on one card: a row each with its state and one button,
 * the relay once at the top. Installing opens the diff under the row; nothing
 * is written before "Fai il backup e scrivi".
 */
function agentsSection(claudeStatus: HookStatus): HTMLElement {
  const relay = h("div", { class: "row" });
  const relayWarn = h("div", {});
  const paintRelay = (s: HookStatus) => {
    clear(relay);
    clear(relayWarn);
    relay.append(h("label", { text: t("Relay") }), h("span", { class: "path", text: s.hookPath || "…" }), statusDot(s.hookReady));
    if (!s.hookReady) {
      relayWarn.append(h("div", {
        class: "notice warn",
        text: t("easyisland-hook.exe non è ancora al suo posto: gli hook non si possono installare. Riavvia EasyIsland; se non basta, compilalo con `cargo build -p easyisland-hook`."),
      }));
    }
  };
  paintRelay(claudeStatus);
  const rows = h("div", { class: "agents" });
  for (const tool of AGENT_ORDER) rows.append(agentRow(tool, tool === "claude" ? claudeStatus : null));
  return h("section", {},
    h("h2", {}, h("span", { text: t("Collegati all'isola") })),
    h("div", { class: "hint", text: t("Ogni agente ha la sua pillola nell'isola. «Installa» mostra prima cosa cambia nel suo file, ne fa una copia e scrive solo dopo la tua conferma; i tuoi hook restano.") }),
    relay,
    relayWarn,
    rows,
  );
}

function agentRow(tool: HookTool, initial: HookStatus | null): HTMLElement {
  const T = HOOK_TOOLS[tool];
  const agent = tool === "claude" ? undefined : tool;
  const status: HookStatus = initial ?? { installed: false, legacy: false, settingsPath: "", hookPath: "", hookReady: false };
  let known = initial != null;
  const head = h("div", { class: "agent-head" });
  const detail = h("div", { class: "agent-detail" });
  const el = h("div", { class: "agent" }, head, h("div", { class: "hint", text: T.what }), detail);

  function badge(): HTMLElement {
    if (!known) return h("span", { class: "agent-state", text: "…" });
    if (status.legacy) return h("span", { class: "agent-state warn", text: t("Hook vecchi (Coucou)") });
    if (status.installed && status.outdated) return h("span", { class: "agent-state warn", text: t("Da aggiornare") });
    if (status.installed) return h("span", { class: "agent-state ok", text: tool === "opencode" ? t("Plugin 1.x installato") : t("Collegato") });
    return h("span", { class: "agent-state", text: tool === "opencode" ? "" : t("Non collegato") });
  }

  function draw() {
    clear(head);
    const on = status.installed || (tool === "opencode" && settings.opencodeWatch === true);
    const actions = h("div", { class: "agent-actions" });
    if (tool === "opencode") {
      actions.append(
        h("span", { class: "hint", text: t("Collega opencode") }),
        toggle(settings.opencodeWatch === true, (v) => { settings.opencodeWatch = v; void save(); draw(); }),
      );
    }
    const label = (verb: string) => (tool === "opencode" ? `${verb} plugin 1.x…` : `${verb}…`);
    if (status.installed || status.legacy) {
      if (status.outdated || status.legacy) actions.append(installButton(label(t("Aggiorna")), true));
      actions.append(h("button", { class: "danger", text: label(t("Disinstalla")), onclick: () => void showPreview(false) }));
    } else {
      actions.append(installButton(label(t("Installa")), tool !== "opencode"));
    }
    head.append(statusDot(on), h("span", { class: "agent-name", text: T.name, title: status.settingsPath }), badge(), actions);
  }

  function installButton(text: string, primary: boolean): HTMLButtonElement {
    const b = h("button", { class: primary ? "primary" : "", text, onclick: () => void showPreview(true) }) as HTMLButtonElement;
    // A hook pointing at a relay that is not there would break every session.
    if (known && !status.hookReady) {
      b.disabled = true;
      b.title = t("Il relay non è ancora installato.");
    }
    return b;
  }

  async function refresh() {
    const fresh = await Bridge.hooksStatus(agent);
    if (fresh) Object.assign(status, fresh);
    known = true;
    draw();
  }

  async function showPreview(install: boolean) {
    clear(detail);
    let preview;
    try {
      preview = await Bridge.hooksPreview(install, agent);
    } catch (err) {
      // An unreadable or invalid file stops here rather than being written over.
      detail.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", { text: t("Chiudi"), onclick: () => clear(detail) })),
      );
      return;
    }
    if (!preview) return;
    detail.append(
      h("div", { class: "hint", text: install
        ? t("Cosa cambia in {path}:", { path: preview.settingsPath })
        : t("Vengono tolte solo le voci di EasyIsland da {path}:", { path: preview.settingsPath }) }),
      renderDiff(preview.diff),
      h("span", { class: "path", text: t("Copia di sicurezza → {path}", { path: preview.backup }) }),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? t("Fai il backup e scrivi") : t("Fai il backup e rimuovi"),
    }) as HTMLButtonElement;
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint, agent);
        clear(detail);
        detail.append(h("div", { class: "notice ok", text: `${t("Fatto. Copia di prima in {path}.", { path: backup })} ${install ? T.done : ""}` }));
        window.setTimeout(() => clear(detail), 6000);
        await refresh();
      } catch (err) {
        confirm.disabled = false;
        detail.append(h("div", { class: "notice err", text: t("Scrittura non riuscita: {err}", { err: String(err) }) }));
      }
    });
    detail.append(h("div", { class: "row" }, confirm, h("button", { text: t("Annulla"), onclick: () => clear(detail) })));
  }

  draw();
  if (!known) void refresh();
  return el;
}

/**
 * How the Agenti tab looks in the island's header: the terminal icon (the
 * default), Claude's logo, its name or an emoji. Kept in integrationTabIcons
 * like the other tabs: missing = the icon, "@logo", "@name", anything else = that emoji.
 */
/** The weekly recap (recap.rs): on or off, show it now, forget it. */
function recapSection(): HTMLElement {
  const done = h("span", { class: "hint note" });
  const clearBtn = h("button", { class: "danger", text: t("Cancella la cronologia"), onclick: async () => {
    await Bridge.recapClear();
    done.textContent = t("Cronologia cancellata.");
  } });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Riepilogo settimanale") })),
    h("div", { class: "hint", text: t("Il lunedì dalle 8 l'isola mostra la settimana prima: tempo, sessioni, file e righe cambiate, comandi, permessi. Si contano solo i numeri e il nome della cartella del progetto, mai comandi, file o richieste; restano su questo PC (12 settimane).") }),
    h("div", { class: "row" },
      h("label", { text: t("Riepilogo") }),
      toggle(settings.weeklyRecap !== false, (v) => { settings.weeklyRecap = v; void save(); }),
      h("button", { text: t("Mostra ora"), onclick: () => void Bridge.recapShow() }),
      clearBtn,
      done));
}

function agentsTabSection(): HTMLElement {
  const id = "integration_claude";
  const icons = () => (settings.integrationTabIcons ??= {});
  const cur = icons()[id];
  const place = h("select", {},
    h("option", { value: "icon", text: t("Icona del terminale") }),
    h("option", { value: "logo", text: t("Logo di Claude") }),
    h("option", { value: "name", text: t("Nome (Agenti)") }),
    h("option", { value: "emoji", text: t("Emoji o lettere") })) as HTMLSelectElement;
  place.value = !cur ? "icon" : cur === "@name" ? "name" : cur === "@logo" ? "logo" : "emoji";
  const emoji = h("input", {
    type: "text", maxlength: "4", spellcheck: "false", style: "width:56px;text-align:center",
    title: t("Un'emoji o una o due lettere"), placeholder: "✳",
    value: cur && !cur.startsWith("@") ? cur : "",
  }) as HTMLInputElement;
  const apply = () => {
    emoji.style.display = place.value === "emoji" ? "" : "none";
    if (place.value === "icon") delete icons()[id];
    else if (place.value === "name") icons()[id] = "@name";
    else if (place.value === "logo") icons()[id] = "@logo";
    else icons()[id] = emoji.value.trim() || (emoji.value = "✳");
  };
  emoji.style.display = place.value === "emoji" ? "" : "none";
  place.addEventListener("change", () => { apply(); void save(); });
  emoji.addEventListener("change", () => { apply(); void save(); });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Scheda nell'isola") })),
    h("div", { class: "row" },
      h("label", { text: t("Aspetto") }), place, emoji,
      h("span", { class: "hint note", text: t("la scheda in alto con le sessioni degli agenti") })));
}

// ── Claude chat section ───────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["claude-opus-5-5", t("Claude Opus 5.5")],
  ["claude-sonnet-5-5", t("Claude Sonnet 5.5")],
  ["claude-haiku-4-5", t("Claude Haiku 4.5")],
  ["claude-opus-5", t("Claude Opus 5")],
  ["claude-sonnet-5", t("Claude Sonnet 5")],
];

/** Claude Code takes aliases; "" leaves the choice to Claude Code. */
const CLI_MODELS: [string, string][] = [
  ["", t("Predefinito di Claude Code")],
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

  // ── Engine picker: names only; what the chosen one is, on the line below ──
  const engine = h("select", {}) as HTMLSelectElement;
  for (const e of CHAT_ENGINES) engine.append(h("option", { value: e.id, text: e.name }));
  engine.value = settings.chatEngine;
  const engineHint = h("div", { class: "hint" });
  const other = otherEngineBlock(() => paintDot());

  // ── Subscription block ──
  const cliDot = statusDot(false);
  const cliState = h("span", { class: "hint", text: t("Verifica di Claude Code…") });
  const recheck = h("button", { text: t("Ricontrolla") });
  // Shown only until Claude Code is ready: what to install and how.
  const INSTALL_CMD = "irm https://claude.ai/install.ps1 | iex";
  const copyCmd = h("button", { text: t("Copia") }) as HTMLButtonElement;
  copyCmd.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      copyCmd.textContent = t("Copiato ✓");
    } catch {
      copyCmd.textContent = t("Non riuscito");
    }
    window.setTimeout(() => (copyCmd.textContent = t("Copia")), 1800);
  });
  const howTo = h("div", { class: "notice warn", style: "display:none;flex-direction:column;gap:8px" },
    h("b", { text: t("Come preparare Claude Code (una volta sola)") }),
    h("div", { text: t("1. In PowerShell incolla questo comando e premi Invio:") }),
    h("div", { class: "row" }, h("code", { class: "path", text: INSTALL_CMD }), copyCmd),
    h("div", { text: t("2. Chiudi e riapri PowerShell, scrivi «claude» e accedi con il tuo account Claude (Pro o Max).") }),
    h("div", { text: t("3. Torna qui e premi Ricontrolla.") }),
    h("div", { class: "hint", text: t("L'app desktop di Claude da sola non basta: il suo Claude Code non si può usare da altri programmi.") }));
  const cliBlock = h(
    "div",
    { class: "engine-block" },
    h("div", { class: "row" }, cliDot, cliState, recheck),
    howTo,
    h("div", { class: "row" },
      h("label", { text: t("Modello") }),
      modelSelect(CLI_MODELS, settings.cliModel, (v) => {
        settings.cliModel = v;
        void save();
      }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Può usare il PC") }),
      toggle(settings.agentTools !== false, (v) => { settings.agentTools = v; void save(); }),
      h("span", { class: "hint note", text: t("programmi, cartelle, link, le tue azioni rapide, lo stato di PC, rete, posta e ticket. Ogni azione che cambia qualcosa chiede Consenti / Nega nell'isola") })),
    connectorsBlock(),
  );

  async function refreshCli() {
    cliState.textContent = t("Verifica di Claude Code…");
    recheck.disabled = true;
    const status = await Bridge.claudeCliStatus();
    recheck.disabled = false;
    cliReady = !!status?.found && !!status.loggedIn;
    if (!status?.found) {
      cliState.textContent = t("Claude Code da riga di comando non è installato su questo PC.");
    } else if (!status.loggedIn && status.source === "vscode") {
      cliState.textContent = t("C'è solo il Claude Code dell'estensione di VS Code, senza login proprio: installa la CLI.");
    } else if (!status.loggedIn) {
      cliState.textContent = t("Claude Code è installato ma senza login: fai i passi 2 e 3.");
    } else {
      const from = status.source === "vscode" ? t(" (estensione di VS Code)") : "";
      cliState.textContent = t("Pronto: {path}", { path: status.path }) + from;
    }
    cliDot.style.background = cliReady ? "#22c55e" : "#f4505e";
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
  const saveBtn = h("button", { class: "primary", text: t("Salva chiave") });
  const clearBtn = h("button", { class: "danger", text: t("Rimuovi") });
  const feedback = h("div", {});

  function paintKey() {
    state.textContent = keyPresent
      ? t("Chiave salvata in Gestione credenziali di Windows.")
      : t("Nessuna chiave: serve per usare questo motore.");
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
      feedback.append(h("div", { class: "notice ok", text: t("Salvata. Non viene mai scritta su disco.") }));
      await refreshKey();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: t("Salvataggio non riuscito: {err}", { err: String(err) }) }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: t("Chiave rimossa.") }));
      await refreshKey();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: t("Rimozione non riuscita: {err}", { err: String(err) }) }));
    }
  });

  const apiBlock = h(
    "div",
    { class: "engine-block" },
    state,
    h("div", { class: "row" }, h("label", { text: t("Chiave API") }), field, saveBtn, clearBtn),
    h("div", { class: "row" },
      h("label", { text: t("Modello") }),
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
    engineHint.textContent = ENGINE_HINTS[settings.chatEngine] ?? "";
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
    h("h2", {}, dot, h("span", { text: t("Motore della chat") })),
    h("div", { class: "row" }, h("label", { text: t("Predefinito") }), engine,
      h("span", { class: "hint note", text: t("nella chat, dal nome del motore in alto, ne scegli un altro solo per quella conversazione") })),
    engineHint,
    cliBlock,
    apiBlock,
    other.el,
    historyRow(),
  );
}

/** Impostazioni → Chat → Cronologia: on, off (which empties it), or emptied now. */
function historyRow(): HTMLElement {
  const clearBtn = h("button", { text: t("Cancella la cronologia") }) as HTMLButtonElement;
  clearBtn.addEventListener("click", async () => {
    await Bridge.chatHistoryClear();
    clearBtn.textContent = t("Cancellata ✓");
    window.setTimeout(() => { clearBtn.textContent = t("Cancella la cronologia"); }, 1800);
  });
  return h("div", { class: "row" },
    h("label", { text: t("Cronologia") }),
    toggle(settings.chatHistory !== false, (v) => {
      settings.chatHistory = v;
      void save();
      if (!v) void Bridge.chatHistoryClear();
    }),
    clearBtn,
    h("span", { class: "hint note", text: t("le conversazioni restano su questo PC (fino a 100) e si riaprono dall'orologio in alto nella chat. Spegnendola si cancellano") }));
}

/** What each engine is, in one line under the picker. */
const ENGINE_HINTS: Record<string, string> = {
  subscription: t("Il tuo abbonamento Claude Pro o Max, tramite Claude Code da riga di comando (gira nascosto). Nessun costo extra: conta nei limiti del piano. Cerca sul web e legge i file che rilasci."),
  api: t("L'API di Anthropic con la tua chiave, a consumo dalla Console di Anthropic."),
  opencode: t("opencode 2 su questo PC: modelli gratuiti, locali o dei tuoi fornitori, con strumenti (comandi, file, web). Ogni comando o modifica chiede Consenti / Nega nell'isola; senza risposta è un no."),
  openrouter: t("Una chiave per centinaia di modelli (openrouter.ai), a consumo. Solo chat: niente web né azioni sul PC."),
  openai: t("L'API di OpenAI con la tua chiave, a consumo. Solo chat: niente web né azioni sul PC."),
  gemini: t("Google AI Studio con la tua chiave. Solo chat: niente web né azioni sul PC."),
  ollama: t("Modelli locali con Ollama, su questo PC o in rete: nulla esce dalla tua rete. Solo chat."),
  lmstudio: t("Modelli locali con LM Studio, su questo PC o in rete: nulla esce dalla tua rete. Solo chat."),
};

/**
 * OpenRouter, OpenAI, Gemini, Ollama, LM Studio (src-tauri/src/openai.rs): the
 * key (Gestione credenziali) or the local address, and the model, with the list
 * the engine offers ("Carica modelli"). Rebuilt for the engine shown.
 */
/** "Gratuito", "Locale" or "A pagamento · 2 $ / 10 $" (the list and the line under the field). */
function priceLabel(m: ModelOption): string {
  if (m.price === "free") return t("Gratuito");
  if (m.price === "local") return t("Locale, sul tuo PC");
  if (m.price === "paid") return m.cost ? t("A pagamento · {cost}", { cost: m.cost }) : t("A pagamento");
  return "";
}

function otherEngineBlock(changed: () => void) {
  const el = h("div", { class: "engine-block" });
  let current = "";
  let keyPresent = false;

  async function draw(id: string) {
    current = id;
    clear(el);
    const e = CHAT_ENGINES.find((x) => x.id === id);
    if (!e || id === "subscription" || id === "api") return;
    settings.engineModels ??= {};
    settings.engineUrls ??= {};
    const opencode = id === "opencode";
    if (opencode) {
      el.append(h("div", { class: "hint", text: t("EasyIsland avvia un opencode tutto suo solo mentre chatti (cartella %LOCALAPPDATA%\\EasyIsland\\opencode). Le chiavi dei fornitori restano in opencode («opencode auth login»), mai qui.") }));
    }
    const feedback = h("div", {});
    if (e.key) {
      const state = h("span", { class: "hint" });
      const field = h("input", { type: "password", style: "flex:1 1 auto;min-width:0", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
      const saveBtn = h("button", { class: "primary", text: t("Salva chiave") });
      const clearBtn = h("button", { class: "danger", text: t("Rimuovi") });
      const paint = () => {
        state.textContent = keyPresent ? t("Chiave salvata in Gestione credenziali di Windows.") : t("Nessuna chiave: serve per usare questo motore.");
        field.placeholder = keyPresent ? "••••••••••••  (salvata)" : t("incolla la chiave");
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
          feedback.append(h("div", { class: "notice ok", text: t("Salvata. Non viene mai scritta su disco.") }));
        } catch (err) {
          feedback.append(h("div", { class: "notice err", text: t("Salvataggio non riuscito: {err}", { err: String(err) }) }));
        }
        paint();
      });
      clearBtn.addEventListener("click", async () => {
        clear(feedback);
        try {
          await Bridge.secretClear(e.key!);
          keyPresent = false;
        } catch (err) {
          feedback.append(h("div", { class: "notice err", text: t("Rimozione non riuscita: {err}", { err: String(err) }) }));
        }
        paint();
      });
      el.append(state, h("div", { class: "row" }, h("label", { text: t("Chiave API") }), field, saveBtn, clearBtn));
      paint();
    } else if (!opencode) {
      const url = h("input", { type: "text", value: settings.engineUrls[id] ?? "", placeholder: e.url ?? "", style: "flex:1 1 auto;min-width:0", spellcheck: "false" }) as HTMLInputElement;
      url.addEventListener("change", () => {
        settings.engineUrls![id] = url.value.trim();
        void save();
      });
      el.append(h("div", { class: "row" }, h("label", { text: t("Indirizzo") }), url,
        h("span", { class: "hint note", text: t("vuoto = quello predefinito; anche un altro PC della rete") })));
    }
    const listId = `models-${id}`;
    const model = h("input", { type: "text", value: settings.engineModels[id] ?? "", list: listId, placeholder: opencode ? t("fornitore/modello, es. ollama/qwen3:8b") : t("nome del modello"), style: "flex:1 1 auto;min-width:0", spellcheck: "false" }) as HTMLInputElement;
    // opencode Zen's free models may keep what you send: never customer data there.
    const privacy = h("div", { class: "notice warn", style: "display:none",
      text: t("Modello online di opencode Zen: per quasi tutti i modelli gratuiti i dati possono essere usati per migliorare il modello (per alcuni: «non inviare dati personali o riservati»). Non usarlo con dati dei clienti: per quelli scegli un modello locale (ollama/…, lmstudio/…) o uno a pagamento a ritenzione zero.") });
    // Without a model the chat cannot start: say so where the model goes.
    const missing = h("div", { class: "notice err", text: opencode
      ? t("Nessun modello scelto: la chat non può partire. Premi «Carica modelli» e scegline uno.")
      : t("Nessun modello scelto: la chat non può partire.") });
    // What the chosen model costs, once the list is loaded.
    const known = new Map<string, ModelOption>();
    const priceEl = h("div", { class: "hint model-price" });
    const paintPrice = () => {
      const m = known.get(model.value.trim());
      priceEl.textContent = m?.price ? `${priceLabel(m)}${m.price === "paid" ? t(" per milione di token (ingresso / uscita)") : ""}` : "";
      priceEl.className = `hint model-price ${m?.price ?? ""}`;
      priceEl.style.display = m?.price ? "" : "none";
    };
    const paintPrivacy = () => {
      privacy.style.display = opencode && model.value.trim().startsWith("opencode/") ? "" : "none";
      missing.style.display = model.value.trim() ? "none" : "";
      paintPrice();
    };
    paintPrivacy();
    // Saved while typing too (a pause of half a second), not only on leaving the field.
    let typing: number | undefined;
    model.addEventListener("input", () => {
      paintPrivacy();
      window.clearTimeout(typing);
      typing = window.setTimeout(() => model.dispatchEvent(new Event("change")), 500);
    });
    const options = h("datalist", { id: listId });
    const load = h("button", { text: t("Carica modelli") }) as HTMLButtonElement;
    const loaded = h("span", { class: "hint note" });
    // Only the free (and local) models in the list.
    const onlyFree = h("input", { type: "checkbox" }) as HTMLInputElement;
    const onlyFreeRow = h("label", { class: "hint only-free", style: "display:none" }, onlyFree, h("span", { text: t("solo gratuiti") }));
    const fillOptions = () => {
      clear(options);
      for (const m of known.values()) {
        if (onlyFree.checked && m.price === "paid") continue;
        options.append(h("option", { value: m.id, label: priceLabel(m) }));
      }
    };
    onlyFree.addEventListener("change", fillOptions);
    model.addEventListener("change", () => {
      window.clearTimeout(typing);
      if ((settings.engineModels![id] ?? "") === model.value.trim()) return;
      settings.engineModels![id] = model.value.trim();
      paintPrivacy();
      void save();
      changed();
    });
    /** `pick`: take the first model when none is set (only on a click: never a model chosen behind your back). */
    const loadModels = async (pick: boolean) => {
      load.disabled = true;
      loaded.textContent = t("Chiedo l'elenco…");
      try {
        const list = await Bridge.chatModels(id, settings.engineUrls?.[id] || null);
        known.clear();
        for (const m of list) known.set(m.id, m);
        fillOptions();
        paintPrice();
        const ids = list.map((m) => m.id);
        const free = list.filter((m) => m.price === "free" || m.price === "local").length;
        const priced = list.some((m) => m.price);
        onlyFreeRow.style.display = priced && free > 0 && free < list.length ? "" : "none";
        loaded.textContent = ids.length
          ? (priced ? t("{n} modelli, {free} gratuiti: scrivi per cercare", { n: ids.length, free }) : t("{n} modelli: scrivi per cercare", { n: ids.length }))
          : opencode
          ? t("Nessun modello: collega un fornitore in opencode («opencode auth login») o avvia Ollama.")
          : t("Nessun modello disponibile.");
        if (pick && !model.value && ids.length) {
          model.value = ids[0];
          model.dispatchEvent(new Event("change"));
        }
      } catch (err) {
        loaded.textContent = String(err).replace(/^Error:\s*/, "");
      }
      load.disabled = false;
    };
    load.addEventListener("click", () => void loadModels(true));
    el.append(h("div", { class: "row" }, h("label", { text: t("Modello") }), model, options, load),
      h("div", { class: "row" }, loaded, onlyFreeRow), priceEl, missing, privacy, feedback);
    // opencode with no model yet: the list straight away, so a model is one click.
    if (opencode && !model.value.trim()) void loadModels(false);
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
    fields: [{ key: "stripe-api-key", label: t("Chiave segreta"), placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: t("Token"), placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: t("Token"), placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: t("URL istanza"), placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: t("Chiave API"), placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: t("Chiave API"), placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: t("Token"), placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: t("Chiave API"), placeholder: "cal_…", secret: true }] },
  { id: "integration_outlook", name: "Outlook", color: "#0A84D6", fields: [],
    options: [{
      label: t("Avvisa"), type: "number", placeholder: "10", unit: t("minuti prima di una riunione"),
      get: (c) => c.outlookWarn, set: (c, v) => { c.outlookWarn = Math.max(1, Number(v) || 10); },
    }],
    hint: t("Mail non lette nella Posta in arrivo e appuntamenti di oggi e domani, letti da Outlook classico già aperto (non lo avvia mai). Il nuovo Outlook non è supportato: non permette ad altri programmi di leggerlo. Niente account né chiavi.") },
  { id: "integration_zammad", name: "Zammad", color: "#F59E0B",
    fields: [
      { key: "zammad-url", label: t("Indirizzo"), placeholder: "https://helpdesk.azienda.it", secret: false },
      { key: "zammad-token", label: t("Token"), placeholder: t("token di accesso"), secret: true },
    ],
    hint: t("In Zammad: avatar → Profilo → Token di accesso → Crea, con il permesso ticket.agent. Ticket assegnati a te, non assegnati e in escalation (avviso giallo); il personaggio ti avvisa quando arriva un nuovo ticket da assegnare.") },
  { id: "integration_3cx", name: "3CX", color: "#0596D4",
    options: [
      { label: t("Accesso"), type: "select", placeholder: "",
        choices: [["user", t("Interno e password (come l'app 3CX)")], ["api", t("Client API (Admin Console, licenza 8SC+)")]],
        get: (c) => c.threecxMode ?? "user", set: (c, v) => { c.threecxMode = v === "api" ? "api" : "user"; } },
      { label: t("Interno"), type: "text", placeholder: "es. 101", when: (c) => c.threecxMode === "api",
        get: (c) => c.threecxExtension ?? "", set: (c, v) => { c.threecxExtension = v.trim(); } },
    ],
    fields: [
      { key: "3cx-url", label: t("Indirizzo"), placeholder: "https://azienda.my3cx.it:5001", secret: false },
      { key: "3cx-user", label: t("Interno o e-mail"), placeholder: "es. 101", secret: false, when: (c) => c.threecxMode !== "api" },
      { key: "3cx-password", label: t("Password"), placeholder: t("la password del web client"), secret: true, when: (c) => c.threecxMode !== "api" },
      { key: "3cx-client-id", label: t("Client ID"), placeholder: t("il Client ID del client API"), secret: false, when: (c) => c.threecxMode === "api" },
      { key: "3cx-client-secret", label: t("Chiave API"), placeholder: t("mostrata una volta sola"), secret: true, when: (c) => c.threecxMode === "api" },
    ],
    hint: t("Chiamate, chiamate in arrivo con Rispondi / Rifiuta, rubrica, stato e chiamate perse, nella scheda 3CX dell'isola. Con interno e password funziona come l'app 3CX (accesso non documentato da 3CX: un aggiornamento del centralino potrebbe cambiarlo; la verifica in due passaggi non è ancora supportata). Con un client API: Admin Console → Integrazioni → API → Aggiungi, spunta \"3CX Call Control API Access\" (e \"Configuration API\" per la rubrica), aggiungi il tuo interno tra quelli monitorati; stato e cronologia non ci sono. Numeri e nomi restano in memoria.") },
  { id: "integration_system", name: t("Stato del PC"), color: "#38BDF8", fields: [],
    options: [{
      label: t("Avvisa sotto il"), type: "number", placeholder: "10", unit: t("% di spazio libero sul disco di sistema"),
      get: (c) => c.systemWarn, set: (c, v) => { c.systemWarn = Math.min(50, Math.max(1, Number(v) || 10)); },
    }],
    hint: t("Disco (in rosso sotto il 5%), batteria scarica, memoria quasi piena, riavvio richiesto da Windows.") },
  { id: "integration_security", name: t("Sicurezza"), color: "#22C55E", fields: [],
    hint: t("Antivirus (Defender o un altro, dal Centro sicurezza di Windows), età delle firme, ultima scansione, firewall, minacce rilevate e riavvio in sospeso. Nessuna chiave, nessuna connessione.") },
  { id: "integration_network", name: t("Rete"), color: "#6366F1", fields: [],
    hint: t("Wi-Fi o cavo, IP locale, VPN attive e latenza verso 1.1.1.1. L'IP pubblico viene chiesto ad api.ipify.org al massimo ogni 15 minuti. Avvisa se internet non risponde o è lento.") },
  { id: "integration_weather", name: t("Meteo"), color: "#0EA5E9", fields: [],
    options: [{
      label: t("Città"), type: "text", placeholder: "es. Milano, Bologna, Lugano",
      get: (c) => c.weatherCity, set: (c, v) => { c.weatherCity = v.trim(); },
    }, {
      label: t("Cielo sul personaggio"), type: "select", placeholder: "",
      choices: [["pill", t("Solo sulla pillola Meteo")], ["idle", t("Anche quando è inattivo")]],
      get: (c) => (c.weatherOnCharacter ? "idle" : "pill"), set: (c, v) => { c.weatherOnCharacter = v === "idle"; },
    }],
    hint: t("Da Open-Meteo, gratuito e senza chiave. Il personaggio mostra il cielo (sole, luna, nuvole, nebbia, pioggia, neve, temporale) sulla pillola Meteo e, se scegli «Anche quando è inattivo», ogni volta che non c'è altro da fare. Avvisa quando è probabile la pioggia nelle prossime ore.") },
  { id: "integration_claude_usage", name: t("Consumo Claude"), color: "#D97757", fields: [],
    hint: t("Quanti token hanno usato le sessioni di Claude Code (terminale, VS Code e app desktop di Claude) nelle ultime 5 ore, oggi e negli ultimi 7 giorni, per progetto e per modello. Letti dalle trascrizioni che Claude Code salva già in %USERPROFILE%\\.claude\\projects: solo i conteggi, mai il testo, e niente esce dal PC. In cima, le percentuali del piano Pro o Max (5 ore e settimana) che Claude Code passa alla sua status line: servono gli hook di Claude Code installati, e arrivano solo dalle sessioni nel terminale o in VS Code.") },
  { id: "integration_clipboard", name: t("Appunti"), color: "#A78BFA", fields: [],
    hint: t("Gli ultimi 30 testi copiati, più quelli fissati: clic per incollarli nell'app in primo piano, o trasformarli (maiuscole, una riga, JSON, URL). Si apre anche con la scorciatoia in Azioni rapide. Restano solo in memoria (mai su disco) e si svuotano alla chiusura; ciò che i gestori di password segnano come privato non viene registrato.") },
  { id: "integration_media", name: t("Musica"), color: "#1ED760", fields: [],
    hint: t("Cosa sta suonando (Spotify, una scheda del browser, Lettore multimediale… tutto ciò che compare nei controlli multimediali di Windows), con copertina, play/pausa, brano precedente e successivo. Tutto in locale, nessun account.") },
];

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = t("Scegli quali pillole mostrare accanto al personaggio ({n} attive): l'isola si allarga per mostrarle tutte. Le chiavi restano in Gestione credenziali di Windows, mai su disco.", { n: used });
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
      const saveBtn = h("button", { text: t("Salva") });
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
            ? t("Non salvata: Gestione credenziali di Windows è piena. Elimina le voci che non servono (es. le centinaia di token di Xbox) e riprova.")
            : t("Non salvata: {err}", { err: String(e).replace(/^Error:\s*/, "") });
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
      h("option", { value: "pill", text: t("Pillola nella panoramica") }),
      h("option", { value: "tab", text: t("Scheda in alto, con il nome") }),
      h("option", { value: "icon", text: t("Scheda in alto, con un'icona") })) as HTMLSelectElement;
    // Integrations with a brand logo can show just that in their tab.
    if (BRAND_SVG[def.id]) place.insertBefore(h("option", { value: "logo", text: t("Scheda in alto, con il logo") }), place.lastChild);
    const iconInput = h("input", {
      type: "text", maxlength: "4", spellcheck: "false", style: "width:56px;text-align:center",
      title: t("Un'emoji o una o due lettere"), placeholder: TAB_ICONS[def.id] ?? "★",
    }) as HTMLInputElement;
    const icons = () => (settings.integrationTabIcons ??= {});
    iconInput.value = icons()[def.id] === "@logo" ? "" : icons()[def.id] ?? "";
    const isTab = (settings.integrationTabs ?? []).includes(def.id);
    place.value = !isTab ? "pill" : icons()[def.id] === "@logo" ? "logo" : icons()[def.id] ? "icon" : "tab";
    const syncIcon = () => { iconInput.style.display = place.value === "icon" ? "" : "none"; };
    syncIcon();
    place.addEventListener("change", () => {
      const rest = (settings.integrationTabs ?? []).filter((x) => x !== def.id);
      settings.integrationTabs = place.value === "pill" ? rest : [...rest, def.id];
      if (place.value === "logo") {
        icons()[def.id] = "@logo";
      } else if (place.value === "icon") {
        if (!iconInput.value.trim() || iconInput.value === "@logo") iconInput.value = TAB_ICONS[def.id] ?? "★";
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
      h("label", { style: "min-width:104px", text: t("Mostra come") }), place, iconInput));
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
  const resetOrder = h("button", { text: t("Ripristina l'ordine"), title: t("Torna all'ordine predefinito") });
  resetOrder.addEventListener("click", () => { settings.pillOrder = []; settings.tabOrder = []; void save(); });
  const orderRow = h("div", { class: "row" },
    h("label", { text: t("Blocca lo spostamento") }),
    toggle(!!settings.lockOrder, (v) => { settings.lockOrder = v; void save(); }),
    resetOrder,
    h("span", { class: "hint note", text: t("nell'isola pillole e schede (anche ⌂ 💬 ⚡ +) si riordinano trascinandole; acceso, restano dove sono") }));
  return h("section", {}, h("h2", {}, h("span", { text: t("Integrazioni") }), profileChip()), note, orderRow, list);
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

  const screens: [string, string][] = [["primary", t("Schermo principale")], ["cursor", t("Schermo sotto il cursore")]];
  // Dragging the character to another display picks that one.
  if (settings.screen.startsWith("monitor:")) screens.push([settings.screen, `Dove l'hai trascinato (${settings.screen.slice(8).replace(/^\\\\\.\\/, "")})`]);
  const screen = select<Settings["screen"]>(
    screens,
    settings.screen,
    (v) => { settings.screen = v; commit(); },
  );

  const vertical = select<Settings["anchorV"]>(
    [["top", t("In alto")], ["bottom", t("In basso")]],
    settings.anchorV,
    (v) => { settings.anchorV = v; settings.offsetX = 0; settings.offsetY = 0; commit(); },
  );
  const horizontal = select<Settings["anchorH"]>(
    [["left", t("A sinistra")], ["center", t("Al centro")], ["right", t("A destra")]],
    settings.anchorH,
    (v) => { settings.anchorH = v; settings.offsetX = 0; settings.offsetY = 0; commit(); },
  );

  // Where the island opens: the character's place, or a fixed spot on the screen.
  const place = select<Settings["islandPlace"]>(
    [
      ["character", t("Dove sta il personaggio")],
      ["top", t("In alto al centro")],
      ["center", t("Al centro dello schermo")],
      ["bottom", t("In basso al centro")],
    ],
    settings.islandPlace ?? "character",
    (v) => { settings.islandPlace = v; commit(); },
  );

  // The launch greeting: on or off, and where it plays.
  const greetingPlace = select<Settings["greetingPlace"]>(
    [["center", t("Al centro dello schermo")], ["character", t("Dove sta il personaggio")]],
    settings.greetingPlace ?? "center",
    (v) => { settings.greetingPlace = v; commit(); },
  );
  greetingPlace.style.display = settings.greeting === false ? "none" : "";
  const greeting = toggle(settings.greeting !== false, (v) => {
    settings.greeting = v;
    greetingPlace.style.display = v ? "" : "none";
    commit();
  });

  // As big as the screen allows: the limits come from the island's display.
  const defaults = islandMax({ w: PANEL_W, h: PANEL_H });
  const widthSlider = slider(ISLAND_MIN_W, defaults.w, 8, Math.round(settings.islandWidth ?? 640), "px", (v) => { settings.islandWidth = v; commit(); });
  const heightSlider = slider(0, defaults.h, 8, Math.round(settings.islandHeight ?? 0), "px", (v) => { settings.islandHeight = v; commit(); });
  void Bridge.panelLimits().then((l) => {
    if (!l) return;
    const max = islandMax({ w: l[0], h: l[1] });
    widthSlider.querySelector("input")!.max = String(max.w);
    heightSlider.querySelector("input")!.max = String(max.h);
  });

  const iconSize = h("div", { class: "row" },
    h("label", { text: t("Dimensione") }),
    slider(16, 48, 2, settings.iconSize, "px", (v) => { settings.iconSize = v; commit(); }),
  );
  const iconStyle = select<Settings["iconStyle"]>(
    [
      ["character", t("Il personaggio")],
      ["dot", t("Pallino con il colore dello stato")],
      ["none", t("Nessuna (striscia invisibile sul bordo)")],
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
    h("label", { text: t("Dimensione") }),
    slider(28, 64, 2, settings.hoverSize, "px", (v) => { settings.hoverSize = v; commit(); }),
  );
  const hoverStyle = select<Settings["hoverStyle"]>(
    [["icon", t("Il personaggio più grande")], ["bar", t("Barra compatta con le integrazioni")]],
    settings.hoverStyle,
    (v) => {
      settings.hoverStyle = v;
      hoverSize.style.display = v === "icon" ? "" : "none";
      commit();
    },
  );
  hoverSize.style.display = settings.hoverStyle === "icon" ? "" : "none";

  const delays: [string, string][] = [
    ["0", t("Solo con un clic")], ["0.3", "0,3 s"], ["0.6", "0,6 s"], ["1", "1 s"], ["2", "2 s"], ["3", "3 s"],
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
    h("label", { text: t("Torna a riposo dopo") }),
    reveal,
    h("span", { class: "hint note", text: t("secondi dopo un evento o dopo che sposti via il mouse") }),
  );
  const restRows = h("div", { style: "display:contents" },
    h("div", { class: "row" }, h("label", { text: t("Icona a riposo") }), iconStyle),
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
    h("h2", {}, h("span", { text: t("Posizione e aspetto") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("Dove vive il personaggio. Quando si apre, l'isola cresce dall'angolo scelto e il contenuto resta allineato a quel lato. In basso sta sopra la barra delle applicazioni. Puoi anche trascinare il personaggio con il mouse: la posizione resta salvata; sceglierne una qui la riporta al bordo."),
    }),
    h("div", { class: "row" }, h("label", { text: t("Schermo") }), screen),
    h("div", { class: "row" }, h("label", { text: t("Posizione") }), vertical, horizontal),
    h("div", { class: "row" },
      h("label", { text: t("L'isola si apre") }),
      place,
      h("span", { class: "hint note", text: t("vicino al personaggio, oppure sempre nello stesso punto dello schermo; il personaggio resta dov'è") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Saluto all'avvio") }),
      greeting,
      greetingPlace,
      h("span", { class: "hint note", text: t("l'animazione del personaggio quando parte l'app; spento, compare subito al suo posto") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Larghezza") }),
      widthSlider,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Altezza minima") }),
      heightSlider,
      h("button", { text: t("Predefinite"), onclick: () => { settings.islandWidth = 640; settings.islandHeight = 0; commit(); render(); } }),
      h("span", { class: "hint note", text: t("0 = l'altezza di ogni vista; fino alla grandezza dello schermo, anche trascinando l'angolo dell'isola aperta") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Barra di ricerca") }),
      toggle(settings.searchBar !== false, (v) => { settings.searchBar = v; commit(); }),
      h("span", { class: "hint note", text: t("in fondo all'isola aperta: cerca integrazioni, azioni e programmi installati") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Sopra la barra") }),
      toggle(settings.overTaskbar, (v) => { settings.overTaskbar = v; commit(); }),
      h("span", { class: "hint note", text: t("il personaggio può stare anche sopra la barra delle applicazioni") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Aggancia ai bordi") }),
      toggle(settings.glueEdges, (v) => { settings.glueEdges = v; commit(); }),
      h("span", { class: "hint note", text: t("lasciato a pochi pixel da un bordo, lo sfondo si attacca al bordo; altrimenti resta solo intorno all'icona") }),
    ),
    h("div", { class: "row" }, h("label", { text: t("Vista compatta") }), hoverStyle),
    hoverSize,
    h("div", { class: "row" },
      h("label", { text: t("Segue il mouse") }),
      toggle(settings.followCursorCompact, (v) => { settings.followCursorCompact = v; commit(); }),
      h("span", { class: "hint note", text: t("anche nella vista compatta. Spento: si guarda intorno da solo, sbatte le palpebre e fa qualche smorfia (consuma meno). A isola aperta segue sempre il mouse.") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Sempre visibile") }),
      always,
      h("span", { class: "hint note", text: t("la vista compatta resta sullo schermo e non torna mai all'icona a riposo") }),
    ),
    restRows,
    h("div", { class: "row" },
      h("label", { text: t("Apri dopo") }),
      openDelay,
      h("span", { class: "hint note", text: t("trascinare un file sopra il personaggio lo apre sempre") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Pannello aperto") }),
      autoClose,
      h("span", { class: "hint note", text: t("secondi dopo che sposti via il mouse, poi si riduce alla vista compatta") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Pulsante chiudi") }),
      toggle(settings.closeButton, (v) => { settings.closeButton = v; commit(); }),
      h("span", { class: "hint note", text: t("✕ in alto a destra per chiudere subito il pannello (anche Esc)") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Schermo intero") }),
      toggle(settings.quietFullscreen, (v) => { settings.quietFullscreen = v; commit(); }),
      h("span", { class: "hint note", text: t("nascondi durante video, giochi e presentazioni (i permessi compaiono comunque)") }),
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
    h("h2", {}, h("span", { text: t("Generale") })),
    h("div", { class: "hint", text: t("Il suono vale per il profilo attivo, l'avvio con Windows per questo PC. I tempi di chiusura sono in Posizione e aspetto.") }),
    h("div", { class: "row" },
      h("label", { text: t("Suono") }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Avvia con Windows") }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    languageRow(),
  );
}

/**
 * Lingua / Language. The windows are built in one language (src/core/i18n.ts):
 * a change applies when EasyIsland starts again, offered right here.
 */
function languageRow(): HTMLElement {
  const restart = h("button", { class: "primary", text: t("Riavvia ora"), onclick: () => void Bridge.restartApp() });
  const note = h("span", { class: "hint note" });
  const paint = () => {
    const changed = resolveLanguage(settings.language) !== language();
    restart.style.display = changed ? "" : "none";
    note.textContent = changed ? t("la nuova lingua vale dal prossimo avvio") : "";
  };
  const row = h("div", { class: "row" },
    h("label", { text: t("Lingua") }),
    select<string>([["", t("Come Windows")], ["it", "Italiano"], ["en", "English"]], settings.language ?? "",
      (v) => { settings.language = v; void save(); paint(); }),
    restart, note);
  paint();
  return row;
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/** Chip shown on sections whose values belong to the active profile. */
function profileChip(): HTMLElement {
  const name = settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "";
  return h("span", { class: "chip", title: t("Questi valori valgono per il profilo attivo"), text: name });
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

  const add = h("button", { text: t("Nuovo profilo") });
  add.addEventListener("click", async () => {
    const id = `p${Date.now().toString(36)}`;
    settings.profiles.push({
      id, name: `Profilo ${settings.profiles.length + 1}`,
      values: snapshot(), rules: { ssids: [], days: [], from: "", to: "" },
    });
    await save();
    await Bridge.switchProfile(id);
  });

  const remove = h("button", { class: "danger", text: t("Elimina") });
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
    type: "text", value: rules.ssids.join(", "), placeholder: t("es. Ufficio-WiFi, Cliente-Ospiti"),
    style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  ssids.addEventListener("change", () => {
    rules.ssids = ssids.value.split(",").map((x) => x.trim()).filter(Boolean);
    commitRules();
  });
  const here = h("button", { text: t("Rete attuale") });
  here.addEventListener("click", async () => {
    const ssid = await Bridge.currentNetwork();
    clear(feedback);
    if (!ssid) {
      feedback.append(h("div", { class: "notice warn", text: t("Nessuna rete Wi-Fi collegata.") }));
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
    h("h2", {}, h("span", { text: t("Profilo") })),
    h("div", {
      class: "hint",
      text: t("Ogni profilo ha le sue integrazioni, posizione, aspetto, suoni, tema, notifiche e azioni. Le sezioni con l'etichetta del profilo si salvano nel profilo attivo. Si cambia anche dal menu dell'icona nell'area di notifica."),
    }),
    h("div", { class: "row" }, h("label", { text: t("Profilo attivo") }), picker, add),
    h("div", { class: "row" }, h("label", { text: t("Nome") }), name, remove),
    h("div", { class: "row" },
      h("label", { text: t("Cambio automatico") }),
      auto,
      h("span", { class: "hint note", text: t("attiva il primo profilo le cui regole corrispondono") }),
    ),
    h("div", { class: "hint", text: t("Regole di questo profilo (vuote = solo a mano):") }),
    h("div", { class: "row" }, h("label", { text: t("Reti Wi-Fi") }), ssids, here),
    h("div", { class: "row" }, h("label", { text: t("Giorni") }), dayRow),
    h("div", { class: "row" },
      h("label", { text: t("Orario") }),
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
    id: newActionId(), name: t("Nuova azione"), icon: "i:bolt", color: "#8b5cf6", kind,
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
  const button = h("button", { class: "icon-pick-btn", title: t("Scegli l'icona") }, renderActionIcon(value, 18));
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
    placeholder: t("nessuna"), title: t("Clic, poi premi la combinazione di tasti"),
  }) as HTMLInputElement;
  const hint = h("span", { class: "hint note hotkey-hint" });
  const clearBtn = h("button", { class: "hotkey-clear", title: t("Nessuna scorciatoia"), text: "✕" });
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
    el.placeholder = t("Premi i tasti…");
    hint.textContent = t("Esc annulla · Canc toglie la scorciatoia");
    void Bridge.hotkeysSuspend(true);
  });
  el.addEventListener("blur", () => {
    el.classList.remove("listening");
    el.placeholder = t("nessuna");
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
      hint.textContent = t("Aggiungi Ctrl, Alt o Win: un tasto da solo varrebbe in ogni app");
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
  const folders = h("div", { class: "row qa-folders" });
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
        text: t("Scorciatoie non disponibili (già usate da un'altra app o scritte male): {keys}.", { keys: failed.join(", ") }),
      }));
    }
  }

  /** Edited copies not saved yet, by action id. A new action lives only here until saved. */
  const drafts = new Map<string, QuickAction>();
  /** Ids of the new actions never saved, in the order they were added. */
  const fresh: string[] = [];

  function forget(id: string) {
    drafts.delete(id);
    const i = fresh.indexOf(id);
    if (i >= 0) fresh.splice(i, 1);
  }

  function saveAction(a: QuickAction) {
    const i = settings.actions.findIndex((x) => x.id === a.id);
    if (i >= 0) settings.actions[i] = a;
    else settings.actions.push(a);
    forget(a.id);
    commit();
    draw();
  }

  /** Folder names of the ⚡ tab, in the order the tab shows them (first action first). */
  function folderNames(): string[] {
    return [...new Set(settings.actions.filter((a) => !(a.kind === "prompt" && a.input === "file"))
      .map((a) => folderLook(a.folder).name).filter(Boolean))];
  }

  /**
   * Moves a folder before or after its neighbour: the two folders' actions swap
   * places in the list, everything else stays where it is.
   */
  function moveFolder(name: string, delta: number) {
    const names = folderNames();
    const other = names[names.indexOf(name) + delta];
    if (!other) return;
    const [first, second] = delta < 0 ? [name, other] : [other, name];
    const pair = [first, second];
    const of = (n: string) => settings.actions.filter((a) => folderLook(a.folder).name === n);
    const moved = [...of(first), ...of(second)];
    const slots = settings.actions.map((a, i) => (pair.includes(folderLook(a.folder).name) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, k) => { settings.actions[slot] = moved[k]; });
    commit();
    draw();
  }

  function drawFolders() {
    clear(folders);
    const names = folderNames();
    folders.style.display = names.length < 2 ? "none" : "";
    if (names.length < 2) return;
    const chips = names.map((n, i) => {
      const look = folderLook(settings.actions.find((a) => folderLook(a.folder).name === n)?.folder);
      return h("span", { class: "qa-folder-chip" },
        h("button", { class: "icon", text: "‹", title: t("Prima"), disabled: i === 0, onclick: () => moveFolder(n, -1) }),
        renderActionIcon(look.icon, 14),
        h("span", { text: n }),
        h("button", { class: "icon", text: "›", title: t("Dopo"), disabled: i === names.length - 1, onclick: () => moveFolder(n, 1) }));
    });
    folders.append(h("label", { text: t("Ordine delle cartelle") }), ...chips);
  }

  function draw() {
    clear(list);
    drawFolders();
    const actions = settings.actions;
    // What each card edits: its unsaved draft, or a copy of the saved action.
    const rows = [
      ...actions.map((x) => drafts.get(x.id) ?? (structuredClone(x) as QuickAction)),
      ...fresh.map((id) => drafts.get(id)).filter((x): x is QuickAction => !!x),
    ];
    // Folder names already in use, offered while typing a new one.
    const names = [...new Set(rows.map((a) => folderLook(a.folder).name).filter(Boolean))];
    list.append(h("datalist", { id: "qa-folders" }, ...names.map((n) => h("option", { value: n }))));
    rows.forEach((a) => {
      const isNew = fresh.includes(a.id);
      const idx = actions.findIndex((x) => x.id === a.id);
      const bar = h("div", { class: "row qa-save" },
        h("span", { class: "hint", text: isNew ? t("Nuova azione, non ancora salvata") : t("Modifiche non salvate") }),
        h("button", { text: isNew ? t("Scarta") : t("Annulla"), onclick: () => { forget(a.id); draw(); } }),
        h("button", { class: "primary", text: t("Salva"), onclick: () => saveAction(a) }));
      // Any edit keeps the draft and shows Salva / Annulla.
      const touch = () => {
        drafts.set(a.id, a);
        bar.style.display = "";
        card.classList.add("dirty");
      };
      const field = (value: string, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0") => {
        const el = h("input", { type: "text", value, placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("input", () => { apply(el.value); touch(); });
        return el;
      };
      const area = (value: string, placeholder: string, apply: (v: string) => void, mono = false) => {
        const el = h("textarea", { placeholder, rows: "3", spellcheck: "false", class: mono ? "mono" : "" }) as HTMLTextAreaElement;
        el.value = value;
        el.addEventListener("input", () => { apply(el.value); touch(); });
        return el;
      };

      const color = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#8b5cf6" }) as HTMLInputElement;
      color.addEventListener("change", () => { a.color = color.value; touch(); draw(); });

      const kind = select<QuickAction["kind"]>(
        [["prompt", t("Chiedi alla chat")], ["script", "Script"], ["app", t("Programma / cartella")], ["url", "Link"]],
        a.kind,
        (v) => { a.kind = v; touch(); draw(); },
      );

      // Moving and deleting act on the saved list at once; a new action is just dropped.
      const move = (delta: number) => {
        const j = idx + delta;
        if (idx < 0 || j < 0 || j >= actions.length) return;
        [actions[idx], actions[j]] = [actions[j], actions[idx]];
        commit();
        draw();
      };
      const up = h("button", { class: "icon", text: "↑", title: t("Sposta su"), disabled: isNew || idx === 0, onclick: () => move(-1) });
      const down = h("button", { class: "icon", text: "↓", title: t("Sposta giù"), disabled: isNew || idx === actions.length - 1, onclick: () => move(1) });
      const del = h("button", {
        class: "danger icon", text: "✕", title: t("Elimina"),
        onclick: () => {
          if (idx >= 0) {
            actions.splice(idx, 1);
            commit();
          }
          forget(a.id);
          draw();
        },
      });

      const card = h("div", { class: "qa-edit" },
        h("div", { class: "row head" },
          iconPicker(a.icon, a.color, (v) => { a.icon = v; touch(); draw(); }),
          field(a.name, t("Nome"), (v) => { a.name = v.trim(); }),
          color, kind, up, down, del,
        ),
      );

      switch (a.kind) {
        case "url":
          card.append(h("div", { class: "row" }, h("label", { text: t("Link") }),
            field(a.target, "https://…", (v) => { a.target = v.trim(); })));
          break;
        case "app":
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Programma o cartella") }),
              field(a.target, t("es. mstsc, chrome, regedit, %ProgramFiles%\\App\\app.exe, C:\\Clienti"), (v) => { a.target = v.trim(); })),
            h("div", { class: "row" }, h("label", { text: t("Argomenti") }),
              field(a.args, t("es. /v:server01 — le virgolette raggruppano"), (v) => { a.args = v; })),
          );
          break;
        case "script":
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Shell") }),
              select<QuickAction["shell"]>([["powershell", "PowerShell"], ["cmd", t("Prompt dei comandi")]], a.shell,
                (v) => { a.shell = v; touch(); }),
              h("span", { class: "hint", text: t("Chiedi conferma") }),
              toggle(a.confirm, (v) => { a.confirm = v; touch(); }),
            ),
            area(a.script, t("I comandi da eseguire. Partono solo dopo un clic nell'isola."), (v) => { a.script = v; }, true),
          );
          break;
        case "prompt":
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Applicata a") }),
              select<QuickAction["input"]>(
                [["clipboard", t("Testo copiato negli appunti")], ["selection", t("Testo selezionato")], ["file", t("File rilasciato sull'isola")], ["none", t("Niente (solo la domanda)")]],
                a.input,
                (v) => { a.input = v; touch(); draw(); },
              )),
            area(a.prompt, t("Cosa chiedere alla chat"), (v) => { a.prompt = v; }),
          );
          break;
      }
      card.append(h("div", { class: "row" }, h("label", { text: t("Scorciatoia") }),
        hotkeyInput(a.hotkey, (v) => { a.hotkey = v; touch(); })));
      if (!(a.kind === "prompt" && a.input === "file")) {
        // Icon from the same grid as the actions (no emoji keyboard needed), and a
        // name: actions with the same name share the folder, and its icon.
        const look = folderLook(a.folder);
        const folderField = field(look.name, t("Nessuna (in primo piano)"), (v) => {
          const name = v.trim();
          const other = rows.find((x) => x !== a && name && folderLook(x.folder).name === name);
          a.folder = folderValue(other ? folderLook(other.folder).icon : look.icon, name);
        }, "width:200px");
        folderField.setAttribute("list", "qa-folders");
        folderField.addEventListener("change", () => draw());
        // The folder's icon belongs to the whole folder: saved at once for every action in it.
        const folderIcon = iconPicker(look.icon, "#94a3b8", (v) => {
          if (!look.name) return;
          for (const x of [...actions, ...drafts.values()]) if (folderLook(x.folder).name === look.name) x.folder = folderValue(v, look.name);
          commit();
          draw();
        });
        card.append(h("div", { class: "row" }, h("label", { text: t("Cartella") }), folderIcon, folderField,
          h("span", { class: "hint note", text: t("le azioni con lo stesso nome di cartella si raggruppano nella scheda ⚡; l'icona vale per tutta la cartella") })));
      }
      const dirty = drafts.has(a.id);
      bar.style.display = dirty ? "" : "none";
      card.classList.toggle("dirty", dirty);
      card.append(bar);
      list.append(card);
    });
  }

  const hotkeyField = (value: string, apply: (v: string) => void) =>
    hotkeyInput(value, (v) => { apply(v); commit(); });

  const add = h("button", { class: "primary", text: t("Aggiungi azione") });
  add.addEventListener("click", () => {
    // Saved only with its Salva button.
    const a = blankAction();
    drafts.set(a.id, a);
    fresh.push(a.id);
    draw();
    const card = list.lastElementChild as HTMLElement | null;
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card?.querySelector<HTMLInputElement>(".row.head input[type=text]")?.select();
  });

  draw();
  void checkHotkeys();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Azioni rapide") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("Pulsanti nella scheda ⚡ dell'isola: link, programmi, script (partono solo dopo un clic) e domande alla chat sul testo copiato, sul testo selezionato o sul file rilasciato. Nessuna chiave o password qui dentro."),
    }),
    h("div", { class: "row" }, h("label", { text: t("Apri l'isola") }),
      hotkeyField(settings.hotkeyOpen, (v) => { settings.hotkeyOpen = v; })),
    h("div", { class: "row" }, h("label", { text: t("Chiedi sul testo copiato") }),
      hotkeyField(settings.hotkeyAsk, (v) => { settings.hotkeyAsk = v; })),
    h("div", { class: "row" }, h("label", { text: t("Cronologia appunti") }),
      hotkeyField(settings.hotkeyClipboard, (v) => { settings.hotkeyClipboard = v; })),
    h("div", { class: "row" }, h("label", { text: t("Cattura una zona e chiedi") }),
      hotkeyField(settings.hotkeyScreenshot, (v) => { settings.hotkeyScreenshot = v; }),
      h("span", { class: "hint note", text: t("scorciatoie di questo PC, valgono in ogni app") })),
    h("div", { class: "row" }, h("label", { text: t("Vai alla richiesta in attesa") }),
      hotkeyField(settings.hotkeyPending, (v) => { settings.hotkeyPending = v; }),
      h("span", { class: "hint note", text: t("poi N nega, Y consente, S sempre; 1–9 sceglie una risposta") })),
    h("div", { class: "row" }, h("label", { text: t("Porta avanti la sessione") }),
      hotkeyField(settings.hotkeySession, (v) => { settings.hotkeySession = v; }),
      h("span", { class: "hint note", text: t("l'app dove gira la sessione: terminale, VS Code, Cursor o Claude") })),
    h("div", { class: "row" }, h("label", { text: t("Pillola successiva") }),
      hotkeyField(settings.hotkeyNextPill ?? "", (v) => { settings.hotkeyNextPill = v; })),
    h("div", { class: "row" }, h("label", { text: t("Suoni sì / no") }),
      hotkeyField(settings.hotkeyMute ?? "", (v) => { settings.hotkeyMute = v; }),
      h("span", { class: "hint note", text: t("Isola aperta: ← → pillole, ↑ ↓ scorre, Ctrl+N nuova chat, Ctrl+P tieni aperta, Esc chiude") })),
    h("div", { class: "row" }, h("label", { text: t("Suggerimenti per l'app in uso") }),
      toggle(settings.contextActions !== false, (v) => { settings.contextActions = v; void save(); }),
      h("span", { class: "hint note", text: t("in cima alla scheda ⚡: per Outlook, Excel, Word, il browser, il codice… usano il testo che hai selezionato") })),
    warn,
    folders,
    list,
    h("div", { class: "row" }, add),
  );
}

// ── Automations ───────────────────────────────────────────────────────────────

const TRIGGER_KINDS: [AutomationTrigger["kind"], string][] = [
  ["time", t("A un orario")],
  ["startup", t("All'avvio (con il PC)")],
  ["unlock", t("Quando sblocchi il PC")],
  ["wifi", t("Quando ti colleghi a una rete Wi-Fi")],
  ["app", t("Quando parte un programma")],
  ["drive", t("Quando colleghi una chiavetta o un disco")],
  ["folder", t("Quando arriva un file in una cartella")],
  ["integration", t("Quando un'integrazione o un widget segnala…")],
];

const STEP_KINDS: [AutomationStep["kind"], string][] = [
  ["quick", t("Esegui un'azione rapida")],
  ["notice", t("Mostra un avviso nell'isola")],
  ["profile", t("Passa a un profilo")],
  ["app", t("Apri un programma o una cartella")],
  ["url", t("Apri un link")],
];

function blankStep(kind: AutomationStep["kind"] = "notice"): AutomationStep {
  return { kind, id: "", title: "", text: "", level: "info", target: "", args: "", url: "" };
}

function blankAutomation(): Automation {
  return {
    id: `a${Date.now().toString(36)}`,
    name: t("Nuova automazione"),
    enabled: true,
    trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5], delay: 30, ssid: "", exe: "", folder: "", source: "", when: "problem" },
    profile: "",
    steps: [{ ...blankStep("notice"), title: t("Buongiorno!"), text: t("Si comincia.") }],
    notify: false,
  };
}

function automationsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const commit = () => void save();

  /** Quick actions of every profile, by id (an automation can use any of them). */
  function quickActions(): [string, string][] {
    const seen = new Map<string, string>();
    for (const a of settings.actions ?? []) seen.set(a.id, a.name || t("Senza nome"));
    for (const p of settings.profiles) {
      const acts = (p.values as Record<string, unknown>).actions;
      if (Array.isArray(acts)) {
        for (const a of acts as QuickAction[]) if (!seen.has(a.id)) seen.set(a.id, `${a.name || t("Senza nome")} (${p.name})`);
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
      list.append(h("div", { class: "hint", text: t("Nessuna automazione. Esempi: alle 9 dei giorni feriali apri Outlook e il gestionale; quando colleghi una chiavetta mostra un avviso; quando il sito di un cliente va giù esegui lo script di controllo.") }));
    }
    settings.automations.forEach((a, idx) => {
      const trg = a.trigger;
      const field = (value: string, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0") => {
        const el = h("input", { type: "text", value, placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };
      const tested = h("span", { class: "hint note" });
      const test = h("button", { text: t("Prova ora"), title: t("Esegue subito i passi (salva prima)") });
      test.addEventListener("click", async () => {
        await save();
        try {
          await Bridge.automationRunNow(a.id);
          tested.textContent = t("eseguita: vedi il registro qui sotto");
        } catch (e) {
          tested.textContent = String(e).replace(/^Error:\s*/, "");
        }
      });
      const del = h("button", { class: "danger icon", text: "✕", title: t("Elimina"),
        onclick: () => { settings.automations.splice(idx, 1); commit(); draw(); } });

      const card = h("div", { class: "qa-edit" },
        h("div", { class: "row head" },
          toggle(a.enabled, (v) => { a.enabled = v; commit(); }),
          field(a.name, t("Nome"), (v) => { a.name = v.trim(); }),
          test, del),
      );

      // ── Quando ──
      const when = h("div", { class: "row" }, h("label", { text: t("Quando") }),
        select<AutomationTrigger["kind"]>(TRIGGER_KINDS, trg.kind, (v) => { trg.kind = v; commit(); draw(); }));
      card.append(when);
      switch (trg.kind) {
        case "time": {
          const time = h("input", { type: "time", value: trg.time || "09:00" }) as HTMLInputElement;
          time.addEventListener("change", () => { trg.time = time.value; commit(); });
          const days = h("div", { class: "days" });
          for (const [d, label] of DAYS) {
            const b = h("button", { class: trg.days.includes(d) ? "day on" : "day", text: label, title: t("Vuoto = tutti i giorni") });
            b.addEventListener("click", () => {
              trg.days = trg.days.includes(d) ? trg.days.filter((x) => x !== d) : [...trg.days, d].sort();
              b.classList.toggle("on");
              commit();
            });
            days.append(b);
          }
          card.append(h("div", { class: "row" }, h("label", { text: t("Alle") }), time, days,
            h("span", { class: "hint note", text: t("nessun giorno = tutti i giorni") })));
          break;
        }
        case "startup": {
          const delay = h("input", { type: "number", min: "5", value: String(trg.delay || 30), style: "width:80px" }) as HTMLInputElement;
          delay.addEventListener("change", () => { trg.delay = Math.max(5, Number(delay.value) || 30); commit(); });
          card.append(h("div", { class: "row" }, h("label", { text: t("Dopo") }), delay,
            h("span", { class: "hint note", text: t("secondi dall'avvio di EasyIsland (che parte con Windows, se attivo in Generale)") })));
          break;
        }
        case "wifi":
          card.append(h("div", { class: "row" }, h("label", { text: t("Rete") }),
            field(trg.ssid, t("nome della rete Wi-Fi, es. Ufficio-5G"), (v) => { trg.ssid = v.trim(); })));
          break;
        case "app":
          card.append(h("div", { class: "row" }, h("label", { text: t("Programma") }),
            field(trg.exe, t("nome dell'eseguibile, es. teams.exe, excel.exe"), (v) => { trg.exe = v.trim(); })));
          break;
        case "folder":
          card.append(h("div", { class: "row" }, h("label", { text: t("Cartella") }),
            field(trg.folder, t("es. C:\\Users\\nome\\Downloads o \\\\server\\scansioni"), (v) => { trg.folder = v.trim(); })));
          break;
        case "integration": {
          const opts = sources();
          if (!trg.source && opts[0]) trg.source = opts[0][0];
          card.append(h("div", { class: "row" }, h("label", { text: t("Da") }),
            opts.length
              ? select<string>(opts, trg.source, (v) => { trg.source = v; commit(); })
              : h("span", { class: "hint", text: t("Accendi un'integrazione come Stato del PC, Rete, Outlook o Zammad, o crea un widget.") }),
            select<AutomationTrigger["when"]>(
              [["problem", t("un problema (diventa giallo o rosso)")], ["event", t("una novità (es. nuovo ticket)")], ["any", t("un problema o una novità")]],
              (trg.when || "problem") as AutomationTrigger["when"], (v) => { trg.when = v; commit(); })));
          break;
        }
      }

      // ── Se ──
      card.append(h("div", { class: "row" }, h("label", { text: t("Solo nel profilo") }),
        select<string>([["", t("Qualsiasi profilo")], ...settings.profiles.map((p): [string, string] => [p.id, p.name])],
          a.profile, (v) => { a.profile = v; commit(); })));

      // ── Allora ──
      a.steps.forEach((s, si) => {
        const remove = h("button", { class: "danger icon", text: "✕", title: t("Togli questo passo"),
          onclick: () => { a.steps.splice(si, 1); commit(); draw(); } });
        const row = h("div", { class: "row" }, h("label", { text: si === 0 ? t("Allora") : t("poi") }),
          select<AutomationStep["kind"]>(STEP_KINDS, s.kind, (v) => { a.steps[si] = { ...blankStep(v) }; commit(); draw(); }));
        switch (s.kind) {
          case "quick": {
            const opts = quickActions();
            if (!s.id && opts[0]) s.id = opts[0][0];
            row.append(opts.length
              ? select<string>(opts, s.id, (v) => { s.id = v; commit(); })
              : h("span", { class: "hint", text: t("Crea prima un'azione rapida.") }));
            break;
          }
          case "notice":
            row.append(
              field(s.title, t("Titolo"), (v) => { s.title = v; }, "width:160px"),
              field(s.text, t("Testo"), (v) => { s.text = v; }),
              select<string>([["info", t("Info")], ["ok", t("Ok")], ["warn", t("Avviso")], ["error", t("Errore")]], s.level || "info",
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
              field(s.target, t("es. outlook, C:\\Clienti, mstsc"), (v) => { s.target = v.trim(); }),
              field(s.args, "argomenti (facoltativi)", (v) => { s.args = v; }, "width:160px"));
            break;
          case "url":
            row.append(field(s.url, "https://…", (v) => { s.url = v.trim(); }));
            break;
        }
        row.append(remove);
        card.append(row);
      });
      const addStep = h("button", { text: t("+ Aggiungi un passo"),
        onclick: () => { a.steps.push(blankStep("quick")); commit(); draw(); } });
      card.append(h("div", { class: "row" }, h("label", { text: "" }), addStep,
        h("span", { class: "hint", text: t("Avvisami ogni volta") }),
        toggle(a.notify, (v) => { a.notify = v; commit(); }),
        tested));
      list.append(card);
    });
  }

  const add = h("button", { class: "primary", text: t("Aggiungi automazione") });
  add.addEventListener("click", () => { settings.automations.push(blankAutomation()); commit(); draw(); });

  // ── Registro ──
  const logBox = h("div", { class: "auto-log" });
  async function drawLog() {
    const entries = (await Bridge.automationsLog()) ?? [];
    clear(logBox);
    if (entries.length === 0) {
      logBox.append(h("div", { class: "hint", text: t("Ancora nessuna esecuzione da quando EasyIsland è partito.") }));
      return;
    }
    for (const e of entries.slice(0, 30)) {
      const when = new Date(e.at).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
      habitsBox.append(h("div", { class: "hint", text: t("Spento. Acceso, EasyIsland annota quando apri i programmi (solo il nome, mai titoli o contenuti), quando accendi o sblocchi il PC, la rete Wi-Fi, le chiavette collegate, le azioni rapide e i profili scelti a mano. Tutto resta su questo PC (45 giorni al massimo) e da lì propone automazioni: una al giorno al massimo, da accettare o rifiutare.") }));
    } else {
      const st = await Bridge.habitsStats();
      const since = st?.since ? new Date(st.since).toLocaleDateString(locale()) : "";
      habitsBox.append(h("div", { class: "row" },
        h("span", { class: "hint", text: st && st.events
          ? (since
            ? t("{n} eventi in {days} giorni, dal {since}. Servono almeno 1–3 settimane per le prime proposte.", { n: st.events, days: st.days, since })
            : t("{n} eventi in {days} giorni. Servono almeno 1–3 settimane per le prime proposte.", { n: st.events, days: st.days }))
          : t("Nessun evento ancora: le prime proposte arrivano dopo qualche settimana di uso.") }),
        h("button", { class: "danger", text: t("Cancella lo storico"), onclick: async () => {
          await Bridge.habitsClear();
          void drawHabits();
        } })));
      const list = (await Bridge.habitsSuggestions()) ?? [];
      habitsBox.append(h("h3", { text: t("Proposte") }));
      if (list.length === 0) habitsBox.append(h("div", { class: "hint", text: t("Nessuna proposta per ora.") }));
      for (const g of list) {
        const answer = (choice: "create" | "snooze" | "dismiss") => async () => {
          try { await Bridge.habitAnswer(g.fp, choice); } catch { /* shown by the list refresh */ }
          void drawHabits();
        };
        habitsBox.append(h("div", { class: "qa-edit" },
          h("b", { text: g.title }), h("div", { class: "hint", text: g.text }),
          h("div", { class: "row" },
            h("button", { class: "primary", text: g.accept || t("Crea"), onclick: answer("create") }),
            h("button", { text: t("Non ora"), onclick: answer("snooze") }),
            h("button", { text: t("No, mai"), onclick: answer("dismiss") }))));
      }
    }
    const refused = settings.suggestionsDismissed ?? [];
    if (refused.length) {
      habitsBox.append(h("h3", { text: t("Proposte rifiutate") }));
      for (const r of refused) {
        habitsBox.append(h("div", { class: "row" },
          h("span", { style: "flex:1 1 auto", text: r.title }),
          h("button", { text: (r as { accept?: string }).accept === t("Spegni") ? t("Spegni comunque") : t("Crea comunque"), onclick: async () => {
            try { await Bridge.habitAnswer(r.fp, "create"); } catch { /* the settings echo redraws */ }
          } }),
          h("button", { text: t("Togli dai rifiutati"), title: t("Potrà essere riproposta"), onclick: async () => {
            await Bridge.habitAnswer(r.fp, "restore");
          } })));
      }
    }
  }
  void onEvent<null>("habits-changed", () => void drawHabits());
  void drawHabits();

  return h("section", {},
    h("h2", {}, h("span", { text: t("Automazioni") })),
    h("div", { class: "hint", text: t("Quando succede qualcosa, EasyIsland esegue i passi che scegli, senza chiedere: le hai approvate creandole. Fanno eccezione gli script con \"Chiedi conferma\" e le domande alla chat, che si aprono nell'isola. In pausa non parte niente. Valgono per questo PC; ognuna si può limitare a un profilo.") }),
    list,
    h("div", { class: "row" }, add),
    h("h3", { text: t("Proposte dalle tue abitudini") }),
    h("div", { class: "row" }, h("label", { text: t("Proponimi automazioni") }),
      toggle(settings.habitsEnabled === true, (v) => { settings.habitsEnabled = v; void save().then(() => drawHabits()); }),
      h("span", { class: "hint note", text: t("da attivare a mano; tutto resta su questo PC") })),
    h("div", { class: "row" }, h("label", { text: t("Programmi da non osservare") }),
      (() => {
        const el = h("input", { type: "text", value: (settings.habitsExcluded ?? []).join(", "),
          placeholder: t("es. steam.exe, spotify"), spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
        el.addEventListener("change", () => {
          settings.habitsExcluded = el.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
          void save();
        });
        return el;
      })()),
    habitsBox,
    h("h3", { text: t("Registro") }),
    h("div", { class: "row" }, h("button", { text: t("Aggiorna"), onclick: () => void drawLog() }),
      h("span", { class: "hint note", text: t("le ultime esecuzioni, solo in memoria") })),
    logBox,
  );
}

// ── Connectors (MCP) ──────────────────────────────────────────────────────────

/** MCP connectors of Claude Code: only the subscription engine can use them. */
function connectorsBlock(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const refresh = h("button", { text: t("Ricarica elenco") });

  async function draw() {
    clear(list);
    const names = (await Bridge.mcpServersConfigured()) ?? [];
    // Keep choices for servers that are gone out of the list, but show them.
    const all = [...new Set([...names, ...settings.mcpServers.map((m) => m.name)])];
    if (all.length === 0) {
      list.append(h("div", {
        class: "hint",
        text: t("Nessun server MCP configurato in Claude Code. Aggiungine uno da un terminale con «claude mcp add --scope user …», poi premi Ricarica elenco."),
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
      if (missing) row.append(h("span", { class: "hint", text: t("non più configurato in Claude Code") }));
      const c = choice();
      if (c) {
        row.append(
          h("span", { class: "hint", text: t("chiedi conferma per ogni operazione") }),
          toggle(c.confirm, (v) => { c.confirm = v; void save(); }),
        );
      }
      list.append(row);
    }
  }
  refresh.addEventListener("click", () => void draw());
  void draw();

  return h(
    "div",
    { class: "sub-block" },
    h("h3", {}, h("span", { text: t("Connettori") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("I server MCP che hai configurato in Claude Code (calendario, documenti, ticketing…). Con la conferma accesa ogni operazione chiede Consenti / Nega nell'isola: spegnila solo per connettori di sola lettura. Quelli di claude.ai qui non ci sono."),
    }),
    list,
    h("div", { class: "row" }, refresh),
  );
}

// ── Widgets ───────────────────────────────────────────────────────────────────

const WIDGET_KINDS: [WidgetDef["kind"], string][] = [
  ["calendar", t("Calendario (link ICS)")],
  ["domain", t("Scadenza domini")],
  ["http", t("Sito web (HTTP)")],
  ["tls", t("Certificato HTTPS")],
  ["ping", "Ping"],
  ["tcp", t("Porta TCP")],
  ["service", t("Servizio Windows")],
  ["json", "API JSON"],
];

/** Mirrors default_every / min_every in src-tauri/src/widgets.rs. */
const EVERY_HINT: Partial<Record<WidgetDef["kind"], string>> = {
  tls: t("predefinito 6 ore, minimo 1 ora"),
  json: t("predefinito 120, minimo 15"),
  calendar: t("predefinito 5 minuti, minimo 1"),
  domain: t("predefinito 12 ore, minimo 1 ora"),
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
  void Bridge.secretPresent(key).then((has) => { if (has) el.placeholder = t("••••••••  (salvato) — incolla un altro {what} per cambiarlo", { what }); });
  el.addEventListener("change", async () => {
    const v = el.value.trim();
    if (!v) return;
    try {
      await Bridge.secretSet(key, v);
      el.value = "";
      el.placeholder = t("••••••••  (salvato)");
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
  [t("Calendario"), () => blankWidget("calendar", { name: t("Calendario"), color: "#f97316" })],
  [t("Scadenza domini"), () => blankWidget("domain", { name: t("Domini"), color: "#a855f7" })],
  [t("Sito cliente"), () => blankWidget("http", { name: t("Sito cliente"), url: "https://", color: "#22c55e" })],
  [t("Certificato"), () => blankWidget("tls", { name: t("Certificato"), color: "#f5a524" })],
  [t("Server (ping)"), () => blankWidget("ping", { name: t("Server"), color: "#38bdf8" })],
  [t("Desktop remoto (3389)"), () => blankWidget("tcp", { name: "RDP", port: 3389, color: "#8b5cf6" })],
  [t("Spooler di stampa"), () => blankWidget("service", { name: t("Stampa"), service: "Spooler", color: "#8e939c" })],
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
      const test = h("button", { class: "icon", text: "▶", title: t("Prova ora") });
      test.addEventListener("click", async () => {
        clear(result);
        result.append(h("div", { class: "hint", text: t("Controllo in corso…") }));
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
        class: "danger icon", text: "✕", title: t("Elimina"),
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
          input(w.name, t("Nome"), (v) => { w.name = v.trim(); }),
          color, kind, test, del,
        ),
      );

      switch (w.kind) {
        case "calendar": {
          card.append(
            row(t("Link ICS"), secretInput(`widget:${w.id}:ics`, t("https://… o webcal://… (salvato in Gestione credenziali)"), "link")),
            h("div", { class: "hint", text: t("Google Calendar: Impostazioni → il calendario → «Indirizzo segreto in formato iCal». Outlook.com: Impostazioni → Calendario → Calendari condivisi → Pubblica un calendario → link ICS. iCloud: condividi il calendario come pubblico. Il link è come una password: resta in Gestione credenziali.") }),
            row(t("Avvisa"), input(w.warnDays || 10, "10", (v) => { w.warnDays = Math.max(1, Number(v) || 10); }, "width:80px", "number"),
              h("span", { class: "hint note", text: t("minuti prima dell'inizio") })),
          );
          break;
        }
        case "domain":
          card.append(
            row(t("Domini"), input(w.host, t("es. cliente.it, altrocliente.com"), (v) => { w.host = v.trim(); })),
            row(t("Avvisa da"), input(w.warnDays || 30, "30", (v) => { w.warnDays = Number(v) || 30; }, "width:80px", "number"),
              h("span", { class: "hint note", text: t("giorni prima della scadenza (in rosso sotto i 7). Fino a 10 domini, separati da virgole; dati da RDAP o WHOIS del registro.") })),
          );
          break;
        case "http":
          card.append(
            row(t("Indirizzo"), input(w.url, "https://www.cliente.it", (v) => { w.url = v.trim(); })),
            row(t("Stato atteso"), input(w.expectStatus || "", t("vuoto = qualsiasi 2xx/3xx"), (v) => { w.expectStatus = Number(v) || 0; }, "width:200px", "number")),
          );
          break;
        case "tls":
          card.append(
            row(t("Dominio"), input(w.host, "www.cliente.it", (v) => { w.host = v.trim(); }),
              input(w.port || 443, "443", (v) => { w.port = Number(v) || 443; }, "width:80px", "number")),
            row(t("Avvisa da"), input(w.warnDays || 30, "30", (v) => { w.warnDays = Number(v) || 30; }, "width:80px", "number"),
              h("span", { class: "hint note", text: t("giorni prima della scadenza (in rosso sotto i 7)") })),
          );
          break;
        case "ping":
          card.append(row("Host", input(w.host, t("nome o indirizzo IP, es. 192.168.1.10"), (v) => { w.host = v.trim(); })));
          break;
        case "tcp":
          card.append(row(t("Host e porta"),
            input(w.host, "server01.cliente.local", (v) => { w.host = v.trim(); }),
            input(w.port || "", "3389", (v) => { w.port = Number(v) || 0; }, "width:90px", "number")));
          break;
        case "service":
          card.append(row(t("Nome servizio"), input(w.service, t("es. Spooler, wuauserv"), (v) => { w.service = v.trim(); })));
          break;
        case "json": {
          card.append(
            row(t("Indirizzo"),
              select<WidgetDef["method"]>([["GET", "GET"], ["POST", "POST"]], w.method, (v) => { w.method = v; commit(); }),
              input(w.url, "https://api.servizio.it/stato", (v) => { w.url = v.trim(); })),
          );
          // Headers: a secret one goes to the Credential Manager, never here.
          w.headers.forEach((hd, hi) => {
            const key = `widget:${w.id}:${hd.name}`;
            const value = h("input", {
              type: hd.secret ? "password" : "text", value: hd.secret ? "" : hd.value,
              placeholder: hd.secret ? t("valore segreto (salvato in Gestione credenziali)") : t("valore"),
              style: "flex:1 1 auto;min-width:0", spellcheck: "false",
            }) as HTMLInputElement;
            value.addEventListener("change", async () => {
              if (hd.secret) {
                try {
                  await Bridge.secretSet(key, value.value);
                  value.value = "";
                  value.placeholder = t("••••••••  (salvato)");
                } catch {
                  value.placeholder = t("Nome intestazione non valido per un segreto");
                }
              } else {
                hd.value = value.value;
                commit();
              }
            });
            card.append(row(hi === 0 ? t("Intestazioni") : "",
              input(hd.name, t("es. Authorization"), (v) => { hd.name = v.trim(); }, "width:160px"),
              value,
              h("span", { class: "hint", text: t("segreto") }),
              toggle(hd.secret, (v) => { hd.secret = v; if (v) hd.value = ""; commit(); draw(); }),
              h("button", { class: "icon", text: "✕", title: t("Rimuovi"), onclick: () => { w.headers.splice(hi, 1); commit(); draw(); } }),
            ));
          });
          w.fields.forEach((f, fi) => {
            card.append(row(fi === 0 ? t("Campi da mostrare") : "",
              input(f.label, t("Etichetta"), (v) => { f.label = v; }, "width:160px"),
              input(f.path, t("percorso, es. data.tickets.open"), (v) => { f.path = v.trim(); }),
              h("button", { class: "icon", text: "✕", title: t("Rimuovi"), onclick: () => { w.fields.splice(fi, 1); commit(); draw(); } }),
            ));
          });
          const alert = w.alert ?? { path: "", op: ">", value: "" };
          card.append(
            h("div", { class: "row" },
              h("button", { text: t("+ Intestazione"), onclick: () => { w.headers.push({ name: "", value: "", secret: false }); commit(); draw(); } }),
              h("button", { text: t("+ Campo"), onclick: () => { w.fields.push({ label: "", path: "" }); commit(); draw(); } }),
            ),
            row(t("Avvisa se"),
              input(alert.path, t("percorso"), (v) => { alert.path = v.trim(); w.alert = alert.path ? alert : null; }, "width:180px"),
              select<string>(
                [["==", "="], ["!=", "≠"], [">", ">"], ["<", "<"], [">=", "≥"], ["<=", "≤"], ["contains", t("contiene")], ["missing", t("manca")]],
                alert.op,
                (v) => { alert.op = v; w.alert = alert.path ? alert : null; commit(); },
              ),
              input(alert.value, t("valore"), (v) => { alert.value = v; w.alert = alert.path ? alert : null; }, "width:120px"),
            ),
          );
          break;
        }
      }
      card.append(row(t("Ogni"),
        input(w.every || "", t("predefinito"), (v) => { w.every = Math.max(0, Number(v) || 0); }, "width:110px", "number"),
        h("span", { class: "hint", text: t("secondi ({hint}; ×3 a batteria)", { hint: EVERY_HINT[w.kind] ?? t("predefinito 60, minimo 15") }) })),
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
    h("h2", {}, h("span", { text: t("Widget") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("Controlli che compaiono come pillole accanto al personaggio: il calendario (link ICS), la scadenza dei domini, siti, certificati, server, porte, servizi Windows o qualsiasi API JSON; se ne possono creare quanti servono. Stato del PC, sicurezza, rete, meteo, Outlook e Zammad sono in Integrazioni. Quando un controllo passa da OK a problema, il personaggio ti avvisa. Si fermano quando EasyIsland è in pausa."),
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
    h("h2", {}, h("span", { text: t("Notifiche") }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: t("Il personaggio si fa vedere per") }),
      select<Settings["notify"]>(
        [
          ["all", t("Tutto (attività, fine sessione, integrazioni, avvisi)")],
          ["alerts", t("Solo avvisi (permessi, domande, errori, fine)")],
          ["permissions", t("Solo richieste di permesso")],
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
    type: "text", value: settings.presenceApps.join(", "), placeholder: t("es. AnyDesk, RustDesk"), spellcheck: "false",
    style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  apps.addEventListener("change", () => {
    settings.presenceApps = apps.value.split(",").map((s) => s.trim()).filter(Boolean);
    commit();
  });
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Davanti al cliente") }), profileChip()),
    h("div", { class: "hint", text: t("Il personaggio si fa da parte quando qualcuno potrebbe vedere il tuo schermo. Si attiva anche a mano: icona nell'area di notifica → Davanti al cliente.") }),
    h("div", { class: "row" },
      h("label", { text: t("Durante le chiamate") }),
      toggle(settings.presenceMeeting, (v) => { settings.presenceMeeting = v; commit(); }),
      h("span", { class: "hint note", text: t("microfono o webcam in uso da qualsiasi app: Teams, Zoom, Meet nel browser, Webex…") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Durante l'assistenza") }),
      toggle(settings.presenceRemote, (v) => { settings.presenceRemote = v; commit(); }),
      h("span", { class: "hint note", text: t("qualcuno è collegato a questo PC: Desktop remoto, Assistenza rapida, TeamViewer") }),
    ),
    h("div", { class: "row" }, h("label", { text: t("Altri programmi") }), apps),
    h("div", { class: "row" },
      h("label", { text: t("Cosa fa") }),
      select<Settings["presenceMode"]>(
        [["hide", t("Nasconde il personaggio e silenzia (le richieste di permesso compaiono comunque)")], ["silent", t("Solo silenzio, il personaggio resta")]],
        settings.presenceMode,
        (v) => { settings.presenceMode = v; commit(); },
      ),
    ),
  );
}

// ── Messages from scripts ─────────────────────────────────────────────────────

function scriptsSection(hookPath: string): HTMLElement {
  const command = `"${hookPath}" notify "Backup" "${t("Completato in 4 minuti")}" --stato ok`;
  const feedback = h("div", {});
  const copy = h("button", { text: t("Copia comando") });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = t("Copiato ✓");
    } catch {
      copy.textContent = t("Copia non riuscita");
    }
    window.setTimeout(() => { copy.textContent = t("Copia comando"); }, 2000);
  });
  const test = h("button", { text: t("Prova") });
  test.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.notifyTest();
      feedback.append(h("div", { class: "notice ok", text: t("Inviato: guarda l'isola.") }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Messaggi dagli script") })),
    h("div", { class: "hint", text: t("Qualsiasi script, attività pianificata, n8n o programma può mostrare un messaggio sull'isola. Stato: ok, avviso, errore o info; --apri aggiunge un pulsante con un link. Valgono le regole di questa pagina: in «solo avvisi» passano solo avvisi ed errori.") }),
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
  const th = settings.theme;
  const commit = () => void save();
  const pct = (v: number) => Math.round(v * 100);
  // The colour row follows the character: its own colour is the default (for
  // the cube, the logo's colours).
  const colorRow = h("div", { class: "row" });
  const drawColorRow = () => {
    clear(colorRow);
    const c = characters().find((x) => x.id === th.character) ?? characters()[0];
    colorRow.append(
      h("label", { text: t("Colore di {name}", { name: c.name }) }),
      colorField(th.slimeColor, rgbHex(c.color), (v) => { th.slimeColor = v; commit(); }, t("Il suo")),
      h("span", { class: "hint note", text: t("negli altri stati {name} prende il colore dello stato", { name: c.name }) }),
    );
  };
  drawColorRow();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Tema") }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: t("Personaggio") }),
      select<string>(
        characters().map((c) => [c.id, c.name] as [string, string]),
        th.character ?? characters()[0].id,
        (v) => { th.character = v; commit(); drawColorRow(); },
      ),
    ),
    colorRow,
    h("div", { class: "row" },
      h("label", { text: t("Colore dell'isola") }),
      colorField(th.islandColor, "#000000", (v) => { th.islandColor = v || "#000000"; commit(); }, t("Nero")),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Opacità dell'isola") }),
      slider(50, 100, 5, pct(th.islandOpacity), "%", (v) => { th.islandOpacity = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Sfondo a isola chiusa") }),
      toggle(th.compactBackground ?? true, (v) => { th.compactBackground = v; commit(); }),
      h("span", { class: "hint note", text: t("spento, a isola chiusa resta solo il personaggio, senza il cerchio o la barra dell'isola; aprendola lo sfondo torna. Con la barra al passaggio del mouse le pillole restano senza sfondo") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Volume avvisi") }),
      slider(0, 100, 10, pct(th.volumeAlerts), "%", (v) => { th.volumeAlerts = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Volume interfaccia") }),
      slider(0, 100, 10, pct(th.volumeUi), "%", (v) => { th.volumeUi = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Volume emozioni") }),
      slider(0, 100, 10, pct(th.volumeEmotes), "%", (v) => { th.volumeEmotes = v / 100; commit(); }),
    ),
  );
}

// ── Backup ────────────────────────────────────────────────────────────────────

/** Impostazioni → Generale → Aggiornamenti: the version, the daily check, "Controlla ora". */
function updatesSection(): HTMLElement {
  const status = h("div", {});
  const check = h("button", { text: t("Controlla ora") }) as HTMLButtonElement;

  const show = (cls: string, text: string, ...extra: Node[]) => {
    clear(status);
    status.append(h("div", { class: `notice ${cls}` }, h("span", { text }), ...extra));
  };

  check.addEventListener("click", async () => {
    check.disabled = true;
    clear(status);
    status.append(h("div", { class: "hint", text: t("Controllo su GitHub…") }));
    try {
      const u = await Bridge.updateCheck();
      if (!u) {
        show("ok", t("Hai già l'ultima versione ({version}).", { version }));
      } else {
        const install = h("button", { class: "primary", text: t("Installa {version}", { version: u.version }), style: "margin-left:10px" }) as HTMLButtonElement;
        install.addEventListener("click", async () => {
          install.disabled = true;
          install.textContent = t("Scarico…");
          try {
            await Bridge.updateInstall();
          } catch (err) {
            show("err", String(err).replace(/^Error:\s*/, ""));
          }
        });
        show("warn", t("È disponibile EasyIsland {version}. Installando, l'app si chiude e si riapre da sola.", { version: u.version }), install);
      }
    } catch (err) {
      show("err", t("Controllo non riuscito: {err}", { err: String(err).replace(/^Error:\s*/, "") }));
    } finally {
      check.disabled = false;
    }
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Aggiornamenti") })),
    h("div", {
      class: "hint",
      text: t("Le nuove versioni arrivano dalle release di GitHub (EdoardoDevelop/easyisland), firmate: l'app verifica la firma prima di installare e installa solo dopo un tuo clic. È l'unica richiesta di rete che non configuri tu, e si può spegnere."),
    }),
    h("div", { class: "row" },
      h("label", { text: t("Versione") }),
      h("span", { text: version || "—" }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Controllo automatico") }),
      toggle(settings.updateCheck ?? true, (v) => { settings.updateCheck = v; void save(); }),
      h("span", { class: "hint note", text: t("all'avvio e una volta al giorno; se c'è una versione nuova te lo dice l'isola") }),
    ),
    h("div", { class: "row" }, check),
    status,
  );
}

function backupSection(): HTMLElement {
  const feedback = h("div", {});
  const exportBtn = h("button", { text: t("Esporta…") });
  exportBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      const path = await Bridge.settingsExport();
      feedback.append(h("div", { class: "notice ok", text: t("Salvato in {path}", { path }) }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });

  const file = h("input", { type: "file", accept: ".json,application/json", style: "display:none" }) as HTMLInputElement;
  const importBtn = h("button", { text: t("Importa…") });
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
        text: t("Impostazioni importate. Le chiavi API non sono nel file: reinseriscile qui sopra se servono."),
      }));
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
    }
  });
  feedback.id = "backup-feedback";

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Backup e trasferimento") })),
    h("div", {
      class: "hint",
      text: t("Esporta tutte le impostazioni, profili compresi, in un file JSON nella cartella Documenti; importalo su un altro PC per ritrovare la stessa isola. Le chiavi API restano in Gestione credenziali e non vengono esportate."),
    }),
    h("div", { class: "row" }, exportBtn, importBtn, file),
    feedback,
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  document.title = t("Impostazioni — EasyIsland");
  const info = await Bridge.boot();
  if (info) {
    settings = { ...settings, ...info.settings };
    version = info.version;
    syncLanguage(settings.language);
  } else if (settings.profiles.length === 0) {
    // Plain browser preview (npm run ui): the profiles Rust would have created.
    const rules = () => ({ ssids: [], days: [], from: "", to: "" });
    settings.profiles = [
      { id: "lavoro", name: t("Lavoro"), values: snapshot(), rules: rules() },
      { id: "casa", name: t("Casa"), values: snapshot(), rules: rules() },
      { id: "concentrazione", name: t("Concentrazione"), values: snapshot(), rules: rules() },
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
      id: "generale", label: t("Generale"), icon: "wrench", color: "#94A3B8", title: t("Generale"),
      intro: t("Suono, avvio con Windows e i profili (lavoro, casa…): ogni profilo ha le sue impostazioni."),
      sections: () => [generalSection(), updatesSection(), profilesSection()],
    },
    {
      id: "aspetto", label: t("Aspetto"), icon: "image", color: "#F472B6", title: t("Aspetto"),
      intro: t("Dove sta l'isola, come si mostra, il personaggio e i colori."),
      sections: () => [placementSection(), themeSection()],
    },
    {
      id: "notifiche", label: t("Notifiche"), icon: "alert", color: "#F5A524", title: t("Notifiche"),
      intro: t("Quando il personaggio si fa vedere, quando si fa da parte e i messaggi dagli script."),
      sections: () => [notifySection(), presenceSection(), scriptsSection(b.status.hookPath)],
    },
    {
      id: "chat", label: t("Chat"), icon: "chat", color: "#A78BFA", title: t("Chat"),
      intro: t("Con quale intelligenza artificiale parla il personaggio quando gli scrivi."),
      sections: () => [claudeChatSection(b.hasKey)],
    },
    {
      id: "claude", label: t("Agenti"), icon: "terminal", color: "#E07A5F", title: t("Agenti di programmazione"),
      intro: t("Le sessioni di Claude Code, Codex, opencode e degli altri agenti nell'isola, con i loro permessi."),
      sections: () => [agentsSection(b.status), agentsTabSection(), recapSection()],
    },
    {
      id: "azioni", label: t("Azioni rapide"), icon: "bolt", color: "#FACC15", title: t("Azioni rapide"),
      intro: t("Pulsanti della scheda ⚡ e scorciatoie da tastiera."),
      sections: () => [actionsSection()],
    },
    {
      id: "automazioni", label: t("Automazioni"), icon: "rocket", color: "#22D3EE", title: t("Automazioni"),
      intro: t("Quando succede qualcosa (un orario, l'avvio, una rete, un programma, una chiavetta, un file, un avviso), EasyIsland fa qualcosa per te."),
      sections: () => [automationsSection()],
    },
    {
      id: "integrazioni", label: t("Integrazioni"), icon: "network", color: "#38BDF8", title: t("Integrazioni"),
      intro: t("Servizi e programmi, uno per tipo: GitHub, Vercel, n8n, Stripe, Zammad, Outlook, stato del PC, sicurezza, rete, meteo…"),
      sections: () => [integrationsSection(b.present)],
    },
    {
      id: "widget", label: t("Widget"), icon: "chart", color: "#22C55E", title: t("Widget"),
      intro: t("Controlli ripetibili senza codice: calendari, domini, siti, certificati, server, porte, servizi Windows e API."),
      sections: () => [widgetsSection()],
    },
    {
      id: "backup", label: t("Backup"), icon: "cloud", color: "#A78BFA", title: t("Backup e trasferimento"),
      intro: t("Porta le impostazioni su un altro PC. Le chiavi restano in Gestione credenziali e vanno reinserite."),
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
    h("div", { class: "brand" }, h("span", { text: t("EasyIsland") }), h("span", { class: "version", text: version })),
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
  nav.append(h("div", { class: "nav-foot", text: t("Nessuna telemetria. Le richieste di rete vanno solo ai servizi che configuri tu.") }));

  const body = h("div", { class: "page-inner" },
    h("header", { class: "page-head" }, h("h1", { text: page.title }), h("div", { class: "hint", text: page.intro })),
    ...page.sections(),
  );
  const main = h("main", { class: "page", "data-page": page.id }, body);
  root.append(nav, main);
  main.scrollTop = scrollTop;
}

void main();
