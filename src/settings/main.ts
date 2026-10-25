// Settings window — the place where anything that writes to disk is confirmed.
// Sections marked with the profile chip are saved into the active profile;
// the rest belongs to this PC.

import "./settings.css";
import "../character/roster";
import { characters, type RGB } from "../character/character";
import { type MemoryInfo, Bridge, onEvent, type HookStatus, type ModelOption, type NotionPage, type NotionMapStatus } from "../core/bridge";
import { type AgentTaskItem, type Custom, type Skill, type TaskState, folderLook, folderValue, CHAT_ENGINES, DEFAULT_SETTINGS, PROBE_INTEGRATIONS, type Reaction, type Automation, type AutomationCondition, type AutomationStep, type AutomationTrigger, type ChatAssistant, type QuickAction, type IntegrationConfig, type NotionRef, type NotionView, type Settings, type Theme, type WidgetDef } from "../core/state";

const PROBE_INTEGRATION_IDS = Object.keys(PROBE_INTEGRATIONS);
import { h, clear, hasMark, TAB_ICONS } from "../views/dom";
import { ISLAND_MIN_W, PANEL_H, PANEL_W, islandMax } from "../core/layout";
import { ACTION_ICONS, actionIcon, actionIconSvg, renderActionIcon } from "../views/action-icons";
import { language, locale, resolveLanguage, syncLanguage, t } from "../core/i18n";
import { applyUiStyle, uiStyle } from "../core/uistyle";
import "./settings-windows.css";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";
const HOMEPAGE = "https://edoardodevelop.github.io/easyisland/";

const root = document.getElementById("settings-root")!;

/** When this window last saved: what comes back right after is its own echo. */
let savedAt = 0;

async function save() {
  savedAt = Date.now();
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
  antigravity: {
    name: "Antigravity", file: "hooks.json",
    what: t("Sessioni della CLI (agy), dell'IDE e dell'app di Google Antigravity: passi, diff e fine del lavoro; comandi e strumenti MCP con Consenti / Nega dall'isola (senza risposta decide Antigravity, come sempre). Gli hook vanno in ~/.gemini/config/hooks.json, in un gruppo «easyisland» tutto suo."),
    done: t("Apri una nuova sessione di Antigravity (agy, IDE o app) per attivare gli hook."),
  },
  opencode: {
    name: "opencode", file: "easyisland.js",
    what: t("opencode 2: accendi l'interruttore, EasyIsland segue il suo servizio in background senza installare nulla; i permessi arrivano con Consenti / Nega / Sempre. Il plugin serve solo a opencode 1.x."),
    done: t("Riavvia opencode per caricare il plugin."),
  },
} as const;
type HookTool = keyof typeof HOOK_TOOLS;

const AGENT_ORDER: HookTool[] = ["claude", "codex", "opencode", "antigravity", "gemini", "cursor", "copilot"];

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
    relay.append(h("label", { text: t("Programma ponte (relay)") }), h("span", { class: "path", text: s.hookPath || "…" }), statusDot(s.hookReady));
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
    h("h2", {}, h("span", { text: t("Collegamento degli agenti all'isola") })),
    h("div", { class: "hint", text: t("Ogni agente ha la sua sessione nella voce Agenti dell'isola. «Installa» mostra prima cosa cambia nel suo file, ne fa una copia e scrive solo dopo la tua conferma; i tuoi hook restano.") }),
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
    h("h2", {}, h("span", { text: t("Riepilogo settimanale degli agenti") })),
    h("div", { class: "hint", text: t("Il lunedì dalle 8 l'isola mostra la settimana prima: tempo, sessioni, file e righe cambiate, comandi, permessi. Si contano solo i numeri e il nome della cartella del progetto, mai comandi, file o richieste; restano su questo PC (12 settimane).") }),
    h("div", { class: "row" },
      h("label", { text: t("Riepilogo") }),
      toggle(settings.weeklyRecap !== false, (v) => { settings.weeklyRecap = v; void save(); }),
      h("button", { text: t("Mostra ora"), onclick: () => void Bridge.recapShow() }),
      clearBtn,
      done));
}

/** The morning and end-of-day recap (daily.rs, src/island/daily.ts). */
function dailySection(): HTMLElement {
  const hour = h("input", {
    type: "number", min: "12", max: "23", step: "1", style: "width:64px",
    value: String(settings.eveningHour ?? 18),
  }) as HTMLInputElement;
  hour.addEventListener("change", () => {
    const v = Math.round(Number(hour.value));
    settings.eveningHour = Number.isFinite(v) ? Math.min(23, Math.max(12, v)) : 18;
    hour.value = String(settings.eveningHour);
    void save();
  });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Riepilogo giornaliero degli agenti") })),
    h("div", { class: "hint", text: t("Al mattino (dalle 8) il tempo degli agenti di ieri, a fine giornata quello di oggi; in tutti e due i repository con modifiche non salvate e le pull request in attesa (con gh o il token di GitHub). Si apre una volta, solo se c'è qualcosa da dire. I repository sono quelli dove hanno lavorato gli agenti: se ne tiene solo il percorso, su questo PC.") }),
    h("div", { class: "row" },
      h("label", { text: t("Riepilogo") }),
      select<Settings["dailyRecap"]>(
        [["both", t("Al mattino e a fine giornata")], ["morning", t("Solo al mattino")], ["evening", t("Solo a fine giornata")], ["off", t("Spento")]],
        settings.dailyRecap ?? "both",
        (v) => { settings.dailyRecap = v; void save(); },
      ),
      h("button", { text: t("Mostra ora"), onclick: () => void Bridge.dailyShow() })),
    h("div", { class: "row" }, h("label", { text: t("Fine giornata alle") }), hour, h("span", { class: "hint note", text: t("ora, da 12 a 23") })));
}

/** EasyIsland's tools in Claude Code everywhere (mcp_setup.rs). */
function mcpSection(): HTMLElement {
  return h("section", {},
    h("h2", {}, h("span", { text: t("Strumenti di EasyIsland in Claude Code") })),
    h("div", { class: "hint", text: t("Claude Code, nel terminale o in VS Code, può mostrare card con pulsanti nell'isola (per esempio «ho finito» o una domanda rapida), avvisi, e mettere file nel Vassoio. La chat dell'isola li ha già. Claude Code chiede il permesso prima di usare uno strumento.") }),
    mcpStatus(false));
}

/** Status, «Aggiungi…» / «Togli…» and the confirmation, for Claude Code or Antigravity (mcp_setup.rs). */
function mcpStatus(agy: boolean): HTMLElement {
  const body = h("div", {});
  const draw = async () => {
    const s = agy ? await Bridge.mcpAgyStatus() : await Bridge.mcpClaudeStatus();
    clear(body);
    if (!s) return;
    const state = !s.cli ? (agy ? t("Antigravity (agy) non è installato su questo PC.") : t("Claude Code non è installato")) : s.current ? t("Aggiunti") : s.installed ? t("Aggiunti, ma con un percorso vecchio") : t("Non aggiunti");
    const detail = h("div", {});
    const ask = (install: boolean) => {
      clear(detail);
      const what = agy
        ? install
          ? t("Antigravity aggiunge questa voce ai suoi server MCP (~/.gemini/config/mcp_config.json, per la CLI, l'IDE e l'app), dopo una copia del file:")
          : t("Antigravity toglie la voce «easyisland» dai suoi server MCP, dopo una copia del file.")
        : install
          ? t("Claude Code aggiunge questa voce ai suoi server MCP (~/.claude.json, per tutti i progetti), dopo una copia del file:")
          : t("Claude Code toglie la voce «easyisland» dai suoi server MCP, dopo una copia del file.");
      const confirm = h("button", { class: "primary", text: t("Conferma") }) as HTMLButtonElement;
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        try {
          const backup = agy ? await Bridge.mcpAgyApply(install) : await Bridge.mcpClaudeApply(install);
          clear(detail);
          const next = !install ? "" : agy ? t("Vale dalla prossima domanda ad Antigravity.") : t("Vale dalla prossima sessione di Claude Code.");
          detail.append(h("div", { class: "notice ok", text: `${backup ? t("Fatto. Copia di prima in {path}.", { path: backup }) : t("Fatto.")} ${next}` }));
          window.setTimeout(() => void draw(), 6000);
        } catch (err) {
          confirm.disabled = false;
          detail.append(h("div", { class: "notice err", text: t("Non riuscito: {err}", { err: String(err) }) }));
        }
      });
      detail.append(h("div", { class: "hint", text: what }));
      if (install) detail.append(h("pre", { class: "diff", text: s.entry }));
      detail.append(h("div", { class: "row" }, confirm, h("button", { text: t("Annulla"), onclick: () => clear(detail) })));
    };
    body.append(
      h("div", { class: "row" },
        h("label", { text: t("Stato") }),
        statusDot(s.current), h("span", { text: state }),
        s.cli && !s.current ? h("button", { text: t("Aggiungi…"), onclick: () => ask(true) }) : null,
        s.installed ? h("button", { text: t("Togli…"), onclick: () => ask(false) }) : null),
      detail);
  };
  void draw();
  return body;
}

function agentsTabSection(): HTMLElement {
  const id = "integration_claude";
  const icons = () => (settings.integrationTabIcons ??= {});
  const cur = icons()[id];
  const place = h("select", {},
    h("option", { value: "icon", text: t("Icona del terminale") }),
    h("option", { value: "logo", text: t("Logo di Claude") }),
    h("option", { value: "emoji", text: t("Emoji o lettere") })) as HTMLSelectElement;
  // "@name" was the header tab with the word "Agenti": the menu always has the name.
  place.value = !cur || cur === "@name" ? "icon" : cur === "@logo" ? "logo" : "emoji";
  const emoji = h("input", {
    type: "text", maxlength: "4", spellcheck: "false", style: "width:56px;text-align:center",
    title: t("Un'emoji o una o due lettere"), placeholder: "✳",
    value: cur && !cur.startsWith("@") ? cur : "",
  }) as HTMLInputElement;
  const apply = () => {
    emoji.style.display = place.value === "emoji" ? "" : "none";
    if (place.value === "icon") delete icons()[id];
    else if (place.value === "logo") icons()[id] = "@logo";
    else icons()[id] = emoji.value.trim() || (emoji.value = "✳");
  };
  emoji.style.display = place.value === "emoji" ? "" : "none";
  place.addEventListener("change", () => { apply(); void save(); });
  emoji.addEventListener("change", () => { apply(); void save(); });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Voce «Agenti» nel menu dell'isola") })),
    h("div", { class: "row" },
      h("label", { text: t("Icona") }), place, emoji,
      h("span", { class: "hint note", text: t("la voce Agenti, con le sessioni degli agenti") })));
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
      h("label", { text: t("Azioni sul PC") }),
      toggle(settings.agentTools !== false, (v) => { settings.agentTools = v; void save(); }),
      h("span", { class: "hint note", text: t("programmi, cartelle, link, le tue azioni rapide, lo stato di PC, rete, posta e ticket. Ogni azione che cambia qualcosa chiede Consenti / Nega nell'isola") })),
    recipesRow(),
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
    h("h2", {}, dot, h("span", { text: t("Motore e modello") })),
    h("div", { class: "row" }, h("label", { text: t("Motore predefinito") }), engine,
      h("span", { class: "hint note", text: t("nella chat, dal nome del motore in alto, ne scegli un altro solo per quella conversazione") })),
    engineHint,
    cliBlock,
    apiBlock,
    other.el,
    h("h2", {}, h("span", { text: t("Comandi e file (modalità terminale)") })),
    terminalRow(),
    h("h2", {}, h("span", { text: t("Istruzioni e memoria") })),
    instructionsRow(),
    assistantsBlock(),
    memoryRow(),
    h("h2", {}, h("span", { text: t("Conversazioni salvate") })),
    historyRow(),
  );
}

/**
 * Impostazioni → Chat → Modalità terminale (docs/chat.md): the chat works as
 * Claude Code or opencode in a terminal, in a folder of the user's. Commands
 * and changes still ask in the island.
 */
function terminalRow(): HTMLElement {
  const folder = h("input", {
    type: "text", value: settings.chatFolder ?? "", placeholder: t("la tua cartella utente"),
    style: "flex:1 1 auto;min-width:0", spellcheck: "false",
  }) as HTMLInputElement;
  const bad = h("span", { class: "hint note" });
  let timer = 0;
  folder.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const v = folder.value.trim();
      const ok = !v || (await Bridge.isFolder(v));
      bad.textContent = ok ? "" : t("questa cartella non c'è");
      settings.chatFolder = v;
      void save();
    }, 500);
  });
  // Windows' own folder dialog; the folder is saved by Rust (workdir.rs).
  const pickBtn = h("button", { text: t("Scegli…") }) as HTMLButtonElement;
  pickBtn.addEventListener("click", async () => {
    try {
      const p = await Bridge.workPick();
      if (p) { folder.value = p; settings.chatFolder = p; bad.textContent = ""; }
    } catch (e) {
      bad.textContent = String(e).replace(/^Error:\s*/, "");
    }
  });
  // The work folder is for every chat, not only terminal mode (docs/strumenti.md).
  const folderRow = h("div", { style: "display:flex;flex-direction:column;gap:4px" },
    h("div", { class: "row" }, h("label", { text: t("Cartella di lavoro") }), folder, pickBtn, bad),
    h("span", { class: "hint note", text: t("La chat (con gli strumenti di EasyIsland) e Telegram la consultano e ci spostano i file; la trovi anche in «File e schermo». Con la modalità terminale è la cartella in cui la chat lavora; vuota = la tua cartella utente.") }));
  return h("div", { style: "display:flex;flex-direction:column;gap:8px" },
    h("div", { class: "row" },
      h("label", { text: t("Modalità terminale") }),
      toggle(settings.chatTerminal === true, (v) => { settings.chatTerminal = v; void save(); }),
      h("span", { class: "hint note", text: t("la chat lavora come Claude Code o opencode da terminale: esegue comandi, modifica file e usa tutti i tuoi server MCP, plugin e skill. Ogni comando o modifica chiede Consenti / Nega nell'isola, con «Sempre» per non ripetere la domanda. Gli altri motori passano da opencode, che deve essere installato") })),
    folderRow);
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

/**
 * Impostazioni → Chat → Antigravity: is `agy` installed, and how to get it
 * (its own installer, then the Google sign-in in a terminal). Permissions in
 * the chat come through its hooks (Agenti di codice → Antigravity).
 */
async function antigravityHowTo(): Promise<HTMLElement> {
  const CMD = "irm https://antigravity.google/cli/install.ps1 | iex";
  const dot = statusDot(false);
  const state = h("span", { class: "hint", text: t("Verifica di Antigravity…") });
  const recheck = h("button", { text: t("Ricontrolla") });
  const copy = h("button", { text: t("Copia") }) as HTMLButtonElement;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(CMD);
      copy.textContent = t("Copiato ✓");
    } catch {
      copy.textContent = t("Non riuscito");
    }
    window.setTimeout(() => (copy.textContent = t("Copia")), 1800);
  });
  const howTo = h("div", { class: "notice warn", style: "display:none;flex-direction:column;gap:8px" },
    h("b", { text: t("Come preparare Antigravity (una volta sola)") }),
    h("div", { text: t("1. In PowerShell incolla questo comando e premi Invio (installa la CLI «agy» di Google):") }),
    h("div", { class: "row" }, h("code", { class: "path", text: CMD }), copy),
    h("div", { text: t("2. Chiudi e riapri PowerShell, scrivi «agy» e accedi con il tuo account Google (gratuito, Pro o Ultra).") }),
    h("div", { text: t("3. Per Consenti / Nega su comandi e strumenti: Impostazioni → Agenti di codice → Antigravity → Installa.") }),
    h("div", { text: t("4. Torna qui e premi Ricontrolla.") }),
    h("div", { class: "hint", text: t("L'IDE o l'app di Antigravity da soli non bastano: la chat usa la CLI. I modelli (Gemini, Claude, GPT-OSS) dipendono dal tuo piano Google.") }));
  const paint = async () => {
    const st = await Bridge.antigravityStatus();
    const ok = !!st?.found;
    dot.style.background = ok ? "#22c55e" : "#f4505e";
    state.textContent = ok ? t("Antigravity (agy) trovato: {p}", { p: st!.path }) : t("Antigravity (agy) non è installato su questo PC.");
    howTo.style.display = ok ? "none" : "flex";
  };
  recheck.addEventListener("click", () => void paint());
  await paint();
  return h("div", { style: "display:flex;flex-direction:column;gap:8px" },
    h("div", { class: "row" }, dot, state, recheck),
    howTo,
    h("div", { class: "hint", text: t("Lavora con i suoi strumenti nella cartella della modalità terminale o, se non c'è, nella cartella di lavoro. Comandi e strumenti MCP chiedono Consenti / Nega nell'isola tramite i suoi hook; senza hook li salta. Il modello vuoto = quello predefinito del tuo account.") }),
    h("b", { text: t("Strumenti di EasyIsland in Antigravity") }),
    h("div", { class: "hint", text: t("Con questi Antigravity usa le integrazioni di EasyIsland come gli altri motori: Notion (leggere e aggiungere righe), Vassoio, azioni rapide, stato del PC, appunti, musica. Quelli che leggono vanno da soli, gli altri chiedono Consenti / Nega.") }),
    mcpStatus(true));
}

/** What each engine is, in one line under the picker. */
const ENGINE_HINTS: Record<string, string> = {
  subscription: t("Il tuo abbonamento Claude Pro o Max, tramite Claude Code da riga di comando (gira nascosto). Nessun costo extra: conta nei limiti del piano. Cerca sul web e legge i file che rilasci."),
  api: t("L'API di Anthropic con la tua chiave, a consumo dalla Console di Anthropic."),
  antigravity: t("Google Antigravity (la CLI agy) su questo PC, con il tuo account Google: un agente con strumenti come Claude Code e opencode. Ogni comando o strumento MCP chiede Consenti / Nega nell'isola."),
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
    const agy = id === "antigravity";
    if (agy) el.append(await antigravityHowTo());
    if (current !== id) return;
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
    } else if (!opencode && !agy) {
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
    const missing = h("div", { class: "notice err", style: agy ? "display:none" : "", text: opencode
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
      missing.style.display = model.value.trim() || agy ? "none" : "";
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
  /** A row of its own after the options (3CX: the ringtone file). */
  extra?: () => HTMLElement;
  /** Nothing of it in the island (Telegram): no icon or colour to choose. */
  noMenu?: boolean;
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
    fields: [{ key: "notion-api-key", label: t("Token"), placeholder: "ntn_…", secret: true }],
    hint: t("Le tue attività da un database (oggi e scadute, spuntate con un clic), le note veloci in una pagina o in un database, le pagine che tieni a portata e la ricerca. Le pagine si aprono nell'app Notion se è installata. Crea un'integrazione interna su notion.so/profile/integrations (leggere, aggiornare e inserire contenuti), copia il token e condividi con lei le pagine e i database che vuoi usare (… → Connessioni)."),
    extra: () => notionRows() },
  { id: "integration_rdm", name: "Remote Desktop Manager", color: "#E8542A", fields: [], extra: () => rdmRows(),
    hint: t("Le tue connessioni di Remote Desktop Manager, cercate e aperte dall'isola: nella card, nella barra in alto, su una chiamata 3CX, su un ticket Zammad e dal testo selezionato (Win+Alt+A). Si collega sempre RDM: EasyIsland trova la connessione e gliela fa aprire o modificare. L'elenco arriva dal modulo PowerShell di Devolutions, qualunque sia l'origine dati (file, Devolutions Server, Hub, SQL), con i permessi di chi usa il PC: solo nome, cartella, indirizzo e tipo, mai le password, e resta in memoria. Senza il modulo la ricerca si apre dentro RDM e ci si connette comunque a un indirizzo.") },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: t("Chiave API"), placeholder: "cal_…", secret: true }] },
  { id: "integration_outlook", name: "Outlook", color: "#0A84D6", fields: [], extra: () => msAccountRows(),
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
  { id: "integration_telegram", name: "Telegram", color: "#29A9EB", noMenu: true,
    fields: [{ key: "telegram-bot-token", label: t("Token del bot"), placeholder: "123456789:AA…", secret: true }],
    extra: () => telegramRows(),
    hint: t("La chat di EasyIsland dentro Telegram, con il tuo bot. In Telegram scrivi a @BotFather, manda /newbot, scegli nome e username e copia qui il token che ti dà. Poi «Collega»: il bot risponde solo alla chat collegata. Conversazione separata da quella dell'isola, con il motore e il modello scelti in Telegram (/motore, /modello); con la modalità terminale, Consenti / Nega arrivano come pulsanti in Telegram. Foto e file mandati al bot finiscono nel Vassoio; i vocali si trascrivono con il servizio scelto in «Vocali». Funziona solo con il PC acceso e EasyIsland aperto: i messaggi arrivati nel frattempo vengono scartati.") },
  { id: "integration_remote", name: t("Accesso remoto"), color: "#14B8A6", fields: [],
    hint: t("Un controllo al volo sul PC di un cliente raggiungibile in rete o in VPN: nella scheda Accesso remoto scegli WinRM o SSH (Windows o Linux), scrivi indirizzo, utente e password e «Avvia connessione». Poi «Collega alla chat» (o 🔌 nella chat) e chiedi all'IA cosa fare: ogni comando sul PC remoto chiede Consenti / Nega. Niente viene salvato, né su disco né in Gestione credenziali: «Chiudi connessione» dimentica la password e rimette a posto TrustedHosts. La scheda ha la guida passo passo per preparare il PC e cosa fare se non va. Servono gli strumenti di EasyIsland accesi (Impostazioni → Chat).") },
  { id: "integration_recorder", name: t("Registra"), color: "#F4505E", fields: [],
    options: [
      { label: t("Cartella"), type: "text", placeholder: t("vuoto = Video\\EasyIsland"), get: (c) => c.recordFolder ?? "", set: (c, v) => { c.recordFolder = v.trim(); } },
      { label: t("Schermo"), type: "number", placeholder: "15", unit: t("fotogrammi al secondo (5–30)"),
        get: (c) => c.recordFps ?? 15, set: (c, v) => { c.recordFps = Math.min(30, Math.max(5, Math.round(Number(v)) || 15)); } },
    ],
    hint: t("Registra una conversazione (microfono e audio del PC, per esempio una chiamata) o lo schermo sotto il mouse con l'audio, finché premi Stop. Tutto con Windows, nessun programma da installare: .m4a per l'audio, .mp4 per lo schermo. Mentre registra, accanto al personaggio c'è sempre il punto rosso con Stop; alla fine scegli se metterla nel Vassoio, aprirla o lasciarla nella cartella. Avvisa chi è in chiamata prima di registrarlo.") },
  { id: "integration_teams", name: "Microsoft Teams", color: "#5B5FC7", fields: [], extra: () => msAccountRows(),
    hint: t("Le riunioni di Teams dall'isola, senza accedere con l'account: riconosce la riunione dal microfono e dalla webcam usati da Teams e mette Microfono, Video, Alza la mano, Condividi ed Esci nella card e accanto al personaggio chiuso (sono le scorciatoie di Teams, mandate alla sua finestra). Apri Teams e «Partecipa dal link copiato». Nelle automazioni: «Quando inizia o finisce una riunione Teams». Chat, riunioni del giorno e stato arriveranno con l'accesso a Microsoft.") },
  { id: "integration_3cx", name: "3CX", color: "#0596D4",
    options: [
      { label: t("Accesso"), type: "select", placeholder: "",
        choices: [["user", t("Interno e password (come l'app 3CX)")], ["api", t("Client API (Admin Console, licenza 8SC+)")]],
        get: (c) => c.threecxMode ?? "user", set: (c, v) => { c.threecxMode = v === "api" ? "api" : "user"; } },
      { label: t("Interno"), type: "text", placeholder: "es. 101", when: (c) => c.threecxMode === "api",
        get: (c) => c.threecxExtension ?? "", set: (c, v) => { c.threecxExtension = v.trim(); } },
      { label: t("Chiamata in arrivo"), type: "select", placeholder: "",
        choices: [["on", t("Apre l'isola con un suono")], ["off", t("Solo il pallino su 3CX nel menu")]],
        get: (c) => (c.threecxAlert === false ? "off" : "on"), set: (c, v) => { c.threecxAlert = v === "on"; } },
      { label: t("Suoneria del PC"), type: "select", placeholder: "", when: (c) => c.threecxMode !== "api",
        choices: [["on", t("Suona quando chiamano «Questo PC»")], ["off", t("Silenziata")]],
        get: (c) => (c.threecxRing === false ? "off" : "on"), set: (c, v) => { c.threecxRing = v === "on"; } },
    ],
    extra: ringtoneRow,
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
      choices: [["pill", t("Solo con il Meteo aperto")], ["idle", t("Anche quando è inattivo")]],
      get: (c) => (c.weatherOnCharacter ? "idle" : "pill"), set: (c, v) => { c.weatherOnCharacter = v === "idle"; },
    }],
    hint: t("Da Open-Meteo, gratuito e senza chiave. Il personaggio mostra il cielo (sole, luna, nuvole, nebbia, pioggia, neve, temporale) con il Meteo aperto e, se scegli «Anche quando è inattivo», ogni volta che non c'è altro da fare. Avvisa quando è probabile la pioggia nelle prossime ore.") },
  { id: "integration_claude_usage", name: t("Consumo Claude"), color: "#D97757", fields: [],
    options: [{
      label: t("Piano nell'isola"), type: "select", placeholder: "",
      choices: [["header", t("Anche nell'intestazione dell'isola")], ["card", t("Solo nella card")]],
      get: (c) => (c.planInHeader === false ? "card" : "header"), set: (c, v) => { c.planInHeader = v === "header"; },
    }],
    hint: t("Quanti token hanno usato le sessioni di Claude Code (terminale, VS Code e app desktop di Claude) nelle ultime 5 ore, oggi e negli ultimi 7 giorni, per progetto e per modello. Letti dalle trascrizioni che Claude Code salva già in %USERPROFILE%\\.claude\\projects: solo i conteggi, mai il testo. In cima, le percentuali del piano Pro o Max (5 ore, settimana e settimana Opus): chieste ad Anthropic ogni 5 minuti con l'accesso già fatto in Claude Code (lo stesso dato di /usage; l'accesso viene solo letto), o passate da Claude Code alla sua status line.") },
  { id: "integration_clipboard", name: t("Appunti"), color: "#A78BFA", fields: [],
    hint: t("Gli ultimi 30 testi copiati, più quelli fissati: clic per incollarli nell'app in primo piano, o trasformarli (maiuscole, una riga, JSON, URL). Si apre anche con la scorciatoia in Azioni rapide. Restano solo in memoria (mai su disco) e si svuotano alla chiusura; ciò che i gestori di password segnano come privato non viene registrato.") },
  { id: "integration_media", name: t("Media"), color: "#1ED760", fields: [],
    hint: t("Cosa è in riproduzione (musica, video, podcast: Spotify, YouTube o un'altra scheda del browser, Lettore multimediale… tutto ciò che compare nei controlli multimediali di Windows), con copertina, play/pausa, precedente e successivo. Tutto in locale, nessun account.") },
];

// ── Notion: what the card shows ─────────────────────────────────────────────

function notionRef(p: NotionPage): NotionRef {
  return { id: p.id, title: p.title || t("Senza titolo"), emoji: p.emoji ?? null, url: p.url, database: !!p.database };
}

const notionIcon = (r: { emoji: string | null; database: boolean }) => r.emoji || (r.database ? "🗂️" : "📄");

/** A search field that lists Notion pages (or only databases) to pick one. */
function notionPicker(placeholder: string, kind: "page" | "database" | null, onPick: (r: NotionRef) => void): HTMLElement {
  const input = h("input", { type: "text", placeholder, spellcheck: "false", autocomplete: "off", style: "width:100%;box-sizing:border-box" }) as HTMLInputElement;
  const results = h("div", { style: "display:flex;flex-direction:column;gap:2px" });
  let timer = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { clear(results); return; }
    timer = window.setTimeout(async () => {
      try {
        const list = await Bridge.notionSearch(q, 8, kind);
        if (input.value.trim() !== q) return;
        clear(results);
        for (const p of list) {
          results.append(h("button", { class: "notion-pick", title: t("Scegli"), onclick: () => {
            onPick(notionRef(p));
            input.value = "";
            clear(results);
          } }, `${notionIcon(notionRef(p))}  ${p.title || t("Senza titolo")}`));
        }
        if (list.length === 0) results.append(h("div", { class: "hint", text: t("Nessuna pagina trovata: l'integrazione vede solo le pagine condivise con lei.") }));
      } catch (e) {
        clear(results);
        results.append(h("div", { class: "notice warn", text: String(e).replace(/^Error:\s*/, "") }));
      }
    }, 350);
  });
  return h("div", { style: "display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-width:0" }, input, results);
}

/** The properties of the tasks database, read once per database (notion.rs → properties). */
let notionProps: { db: string; list: { name: string; kind: string; options: [string, string][] }[] | null; error: string } | null = null;

const PERIODS: [string, string][] = [
  ["all", t("Tutte le date")],
  ["today", t("Scadute e di oggi")],
  ["week", t("Fino a domenica")],
  ["month", t("Fino a fine mese")],
  ["days", t("Nei prossimi giorni…")],
];

/**
 * Impostazioni → Notion → Viste: named filters of the tasks (settings.rs
 * NotionView). Each one: a period, the undated ones or not, the order, and
 * for each select, multi-select, status or relation the values wanted.
 */
function notionViewsEditor(db: string, saved: () => void): HTMLElement {
  const c = settings.integrationConfig;
  const box = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  if (!notionProps || notionProps.db !== db) {
    const mine = { db, list: null, error: "" } as NonNullable<typeof notionProps>;
    notionProps = mine;
    Bridge.notionProperties(db)
      .then((l) => { mine.list = l; })
      .catch((e) => { mine.error = String(e).replace(/^Error:\s*/, ""); })
      .finally(() => { if (notionProps === mine) draw(); });
  }
  let timer = 0;
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(saved, 600); };

  const uniqueName = (base: string) => {
    const names = new Set((c.notionViews ?? []).map((v) => v.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };
  const add = (v: Partial<NotionView>) => {
    const views = c.notionViews ?? [];
    if (views.length >= 6) return;
    c.notionViews = [...views, { name: uniqueName(v.name ?? t("Vista")), period: "all", days: 7, undated: true, filters: [], sort: "due", ...v, }];
    saved();
    draw();
  };

  function viewBox(v: NotionView): HTMLElement {
    const name = h("input", { type: "text", value: v.name, spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
    name.addEventListener("input", () => {
      const next = name.value.trim();
      if (!next || (c.notionViews ?? []).some((x) => x !== v && x.name === next)) return;
      if (c.notionView === v.name) c.notionView = next;
      v.name = next;
      later();
    });
    const remove = h("button", { text: t("Togli"), onclick: () => {
      c.notionViews = (c.notionViews ?? []).filter((x) => x !== v);
      if (c.notionView === v.name) c.notionView = "";
      saved();
      draw();
    } });
    const period = h("select", {}, ...PERIODS.map(([id, label]) => h("option", { value: id, text: label }))) as HTMLSelectElement;
    period.value = v.period || "all";
    const days = h("input", { type: "number", min: "1", max: "366", value: String(v.days || 7), style: "width:64px" }) as HTMLInputElement;
    const showDays = () => { days.style.display = period.value === "days" ? "" : "none"; };
    period.addEventListener("change", () => { v.period = period.value; showDays(); saved(); });
    days.addEventListener("input", () => { const n = Math.round(Number(days.value)); if (n >= 1 && n <= 366) { v.days = n; later(); } });
    showDays();
    const sort = h("select", {},
      h("option", { value: "due", text: t("Per scadenza") }),
      h("option", { value: "priority", text: t("Per priorità") })) as HTMLSelectElement;
    sort.value = v.sort === "priority" ? "priority" : "due";
    sort.addEventListener("change", () => { v.sort = sort.value; saved(); });

    const filters = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
    const props = notionProps?.list ?? [];
    for (const p of props) {
      const current = () => v.filters.find((f) => f.prop === p.name);
      const chips = p.options.map(([value, label]) => {
        const b = h("button", { class: "chip-opt", text: label, title: label }) as HTMLButtonElement;
        const paint = () => b.classList.toggle("on", !!current()?.values.includes(value));
        b.addEventListener("click", () => {
          let f = current();
          if (!f) { f = { prop: p.name, kind: p.kind, values: [] }; v.filters.push(f); }
          f.values = f.values.includes(value) ? f.values.filter((x) => x !== value) : [...f.values, value];
          if (f.values.length === 0) v.filters = v.filters.filter((x) => x !== f);
          paint();
          saved();
        });
        paint();
        return b;
      });
      filters.append(h("div", { class: "row", style: "align-items:flex-start" },
        h("span", { class: "hint", style: "min-width:84px;padding-top:3px", text: p.name }),
        h("div", { class: "chip-opts" }, ...chips)));
    }
    if (notionProps?.error) filters.append(h("div", { class: "notice warn", text: notionProps.error }));
    else if (!notionProps?.list) filters.append(h("div", { class: "hint", text: t("Leggo le colonne del database…") }));
    else if (props.length) filters.append(h("div", { class: "hint", text: t("In ogni riga, nessuna scelta = tutte; più scelte = una qualsiasi.") }));

    return h("div", { class: "notion-view-edit" },
      h("div", { class: "row" }, name, remove),
      h("div", { class: "row" }, h("span", { class: "hint", style: "min-width:84px", text: t("Scadenza") }), period, days,
        h("label", { class: "inline-check" }, toggle(v.undated, (on) => { v.undated = on; saved(); }), h("span", { text: t("anche senza scadenza") }))),
      h("div", { class: "row" }, h("span", { class: "hint", style: "min-width:84px", text: t("Ordine") }), sort),
      filters);
  }

  function draw() {
    clear(box);
    const views = c.notionViews ?? [];
    for (const v of views) box.append(viewBox(v));
    if (views.length < 6) {
      box.append(h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" },
        h("button", { text: `+ ${t("Nuova vista")}`, onclick: () => add({}) }),
        h("button", { text: `+ ${t("Oggi")}`, onclick: () => add({ name: t("Oggi"), period: "today", undated: false }) }),
        h("button", { text: `+ ${t("Settimana")}`, onclick: () => add({ name: t("Settimana"), period: "week", undated: false }) }),
        h("button", { text: `+ ${t("Tutte")}`, onclick: () => add({ name: t("Tutte"), period: "all", undated: true }) })));
    }
  }
  draw();
  return box;
}

/**
 * Remote Desktop Manager: what is installed and what is missing (each with
 * the command to type, never run from here), the workspace to read, the list.
 */
/**
 * Microsoft account (msgraph.rs), the same block in Outlook and Teams: the app
 * registration's id and tenant, Accedi / Esci, and how to register the app.
 * Everything read-only; the token stays in the Credential Manager.
 */
function msAccountRows(): HTMLElement {
  const c = settings.integrationConfig;
  const box = h("div", { class: "ms-account", style: "display:flex;flex-direction:column;gap:8px;padding-top:6px;border-top:1px solid var(--hairline)" });
  const state = h("span", { class: "hint", text: t("Controllo…") });
  const login = h("button", { class: "primary", text: t("Accedi con Microsoft") }) as HTMLButtonElement;
  const logout = h("button", { text: t("Esci") }) as HTMLButtonElement;
  const note = h("div", { class: "hint note" });

  const refresh = async () => {
    const s = await Bridge.msStatus();
    if (!s) { state.textContent = t("Disponibile nell'app installata."); login.disabled = true; logout.style.display = "none"; return; }
    state.textContent = s.signedIn
      ? t("Collegato: {who}", { who: s.account ?? t("account Microsoft") })
      : s.configured ? t("Non collegato") : t("Manca l'ID applicazione");
    login.style.display = s.signedIn ? "none" : "";
    login.disabled = !s.configured;
    logout.style.display = s.signedIn ? "" : "none";
    note.textContent = s.error ?? "";
  };
  login.addEventListener("click", async () => {
    login.disabled = true;
    note.textContent = t("Completa l'accesso nel browser che si è aperto…");
    try {
      await save();
      const who = await Bridge.msLogin();
      note.textContent = t("Collegato: {who}", { who });
    } catch (e) {
      note.textContent = String(e).replace(/^Error:\s*/, "");
    }
    await refresh();
  });
  logout.addEventListener("click", async () => {
    await Bridge.msLogout().catch(() => undefined);
    await refresh();
  });

  const input = (value: string, placeholder: string, apply: (v: string) => void) => {
    const el = h("input", { type: "text", value, placeholder, spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
    el.addEventListener("change", () => { apply(el.value.trim()); void save().then(refresh); });
    return el;
  };
  box.append(
    h("div", { class: "row" }, h("b", { text: t("Account Microsoft (API)") }), state),
    h("div", { class: "hint", text: t("Con l'accesso, Outlook legge posta e calendario da Microsoft 365 (anche con il nuovo Outlook e a Outlook chiuso) e Teams mostra il tuo stato e le riunioni di oggi con «Partecipa». Solo lettura; il token resta in Gestione credenziali.") }),
    h("div", { class: "row" }, h("label", { text: t("ID applicazione") }),
      input(c.msClientId ?? "", "00000000-0000-0000-0000-000000000000", (v) => { c.msClientId = v; })),
    h("div", { class: "row" }, h("label", { text: t("Tenant") }),
      input(c.msTenant ?? "", t("organizations (lavoro) · consumers (personale) · common · dominio o ID"), (v) => { c.msTenant = v; })),
    h("div", { class: "row" }, h("label", { text: "" }), login, logout),
    note,
    h("details", {},
      h("summary", { class: "hint", text: t("Come si registra l'app (una volta, gratis)") }),
      h("ol", { class: "hint", style: "margin:6px 0 0 18px;display:flex;flex-direction:column;gap:4px" },
        h("li", { text: t("portal.azure.com o entra.microsoft.com → Microsoft Entra ID → Registrazioni app → Nuova registrazione.") }),
        h("li", { text: t("Nome: EasyIsland. Account: solo questa organizzazione, oppure anche account personali se usi Outlook.com.") }),
        h("li", { text: t("URI di reindirizzamento: piattaforma «Client pubblico/nativo (dispositivi mobili e desktop)», indirizzo http://localhost.") }),
        h("li", { text: t("Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate: User.Read, Mail.Read, Calendars.Read, Presence.Read, offline_access.") }),
        h("li", { text: t("Copia qui l'«ID applicazione (client)» e, per un account di lavoro, l'«ID directory (tenant)» o lascia organizations.") }),
        h("li", { text: t("Se l'azienda blocca il consenso degli utenti, l'IT deve approvare l'app: EasyIsland non lo aggira.") }))),
  );
  void refresh();
  return box;
}

/** Telegram: the bot, the linked chat, «Collega» with a code, «Scollega». */
function telegramRows(): HTMLElement {
  const box = h("div", { style: "display:flex;flex-direction:column;gap:8px;padding-top:6px;border-top:1px solid var(--hairline)" });
  const state = h("span", { class: "hint", text: t("Controllo…") });
  const link = h("button", { class: "primary", text: t("Collega") }) as HTMLButtonElement;
  const unlink = h("button", { text: t("Scollega") }) as HTMLButtonElement;
  const note = h("div", { class: "hint note" });
  let bot = "";

  const refresh = async () => {
    const s = await Bridge.telegramInfo();
    if (!s) { state.textContent = t("Disponibile nell'app installata."); link.disabled = true; unlink.style.display = "none"; return; }
    bot = s.bot;
    const on = settings.activeIntegrations.includes("integration_telegram");
    state.textContent = !s.token ? t("Manca il token del bot")
      : !on ? t("Accendi l'integrazione")
      : !s.running ? t("Non in ascolto")
      : s.linked ? t("@{bot} risponde a {who}", { bot: s.bot, who: s.name || t("la tua chat") })
      : t("@{bot} in ascolto, nessuna chat collegata", { bot: s.bot });
    link.disabled = !s.running;
    link.textContent = s.linked ? t("Collega un'altra chat") : t("Collega");
    unlink.style.display = s.linked ? "" : "none";
    if (s.error) note.textContent = s.error;
  };
  link.addEventListener("click", async () => {
    try {
      const code = await Bridge.telegramLinkCode();
      note.textContent = t("In Telegram apri @{bot} e manda: /start {code} (vale 10 minuti).", { bot: bot || "bot", code });
    } catch (e) {
      note.textContent = String(e).replace(/^Error:\s*/, "");
    }
  });
  unlink.addEventListener("click", async () => {
    try { await Bridge.telegramUnlink(); note.textContent = ""; } catch (e) { note.textContent = String(e).replace(/^Error:\s*/, ""); }
    await refresh();
  });
  // "Automatica" (telegram.rs `asks_anyway`): in Modalità terminale only deleting asks. Also /automatica in the bot.
  const auto = h("div", { class: "row" },
    h("label", { text: t("Automatica") }),
    toggle(settings.integrationConfig.telegramAuto === true, (v) => { settings.integrationConfig.telegramAuto = v; void save(); }),
    h("span", { class: "hint note", text: t("in modalità terminale comandi e modifiche vanno senza chiedere; le cancellazioni chiedono ancora (anche /automatica nel bot)") }));
  // «Vocali» (transcribe.rs): who turns voice messages into text, with the key of that chat engine.
  const voiceNote = h("span", { class: "hint note" });
  const voiceKeys: Record<string, [string, string]> = {
    gemini: ["gemini-api-key", "Google AI"], openai: ["openai-api-key", "OpenAI"], openrouter: ["openrouter-api-key", "OpenRouter"],
  };
  const voiceHint = async () => {
    const v = settings.integrationConfig.telegramVoice ?? "";
    if (!v) { voiceNote.textContent = t("i vocali non si leggono; Claude Code e opencode non sentono l'audio"); return; }
    const [key, name] = voiceKeys[v];
    voiceNote.textContent = (await Bridge.secretPresent(key))
      ? t("il vocale diventa testo e va alla chat come un messaggio scritto")
      : t("manca la chiave di {name}: mettila in Impostazioni → Chat", { name });
  };
  // The model: only those of the service that take audio, cheapest first (transcribe.rs `models`).
  const voiceModel = h("select", {}) as HTMLSelectElement;
  const voiceModelRow = h("div", { class: "row" }, h("label", { text: t("Modello per l'audio") }), voiceModel);
  voiceModel.addEventListener("change", () => { settings.integrationConfig.telegramVoiceModel = voiceModel.value; void save(); });
  const loadVoiceModels = async () => {
    const v = settings.integrationConfig.telegramVoice ?? "";
    voiceModelRow.style.display = v ? "" : "none";
    if (!v) return;
    const chosen = settings.integrationConfig.telegramVoiceModel ?? "";
    clear(voiceModel);
    voiceModel.append(h("option", { value: chosen, text: chosen || t("Predefinito del servizio") }));
    voiceModel.value = chosen;
    try {
      const list = await Bridge.voiceModels(v);
      if ((settings.integrationConfig.telegramVoice ?? "") !== v) return;
      clear(voiceModel);
      voiceModel.append(h("option", { value: "", text: t("Predefinito del servizio") }));
      for (const m of list) {
        const price = priceLabel(m);
        voiceModel.append(h("option", { value: m.id, text: price ? `${m.id} — ${price}` : m.id }));
      }
      if (chosen && !list.some((m) => m.id === chosen)) voiceModel.append(h("option", { value: chosen, text: chosen }));
      voiceModel.value = chosen;
    } catch {
      // No key yet, or the service is unreachable: the hint says what is missing.
    }
  };
  const voice = h("div", { class: "row" },
    h("label", { text: t("Vocali") }),
    select<string>([["", t("Spenti")], ["gemini", "Google AI (Gemini)"], ["openai", "OpenAI"], ["openrouter", "OpenRouter"]],
      settings.integrationConfig.telegramVoice ?? "", (v) => {
        settings.integrationConfig.telegramVoice = v;
        // Another service: its own models.
        settings.integrationConfig.telegramVoiceModel = "";
        void save();
        void voiceHint();
        void loadVoiceModels();
      }),
    voiceNote);
  void voiceHint();
  void loadVoiceModels();
  box.append(h("div", { class: "row" }, h("b", { text: t("Chat collegata") }), state), h("div", { class: "row" }, link, unlink), auto, voice, voiceModelRow, note);
  void refresh();
  // The bot may take a few seconds to start after the token is saved or the switch turned on.
  const timer = window.setInterval(() => { if (!box.isConnected) window.clearInterval(timer); else void refresh(); }, 4000);
  return box;
}

function rdmRows(): HTMLElement {
  const box = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const c = settings.integrationConfig;
  const copyBtn = (text: string) => {
    const b = h("button", { text: t("Copia") }) as HTMLButtonElement;
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = t("Copiato ✓"); } catch { b.textContent = t("Non riuscito"); }
      window.setTimeout(() => { b.textContent = t("Copia"); }, 1600);
    });
    return b;
  };
  const line = (ok: boolean | null, label: string, value: string, fix?: string) => h("div", { style: "display:flex;flex-direction:column;gap:4px" },
    h("div", { class: "row" },
      statusDot(ok ?? false),
      h("span", { style: "min-width:150px", text: label }),
      h("span", { class: "hint", style: "flex:1 1 auto;min-width:0;overflow-wrap:anywhere", text: value })),
    fix ? h("div", { class: "row", style: "padding-left:18px" }, h("code", { class: "path", text: fix }), copyBtn(fix)) : null);

  const state = h("div", { style: "display:flex;flex-direction:column;gap:6px" }, h("div", { class: "hint", text: t("Controllo…") }));
  const check = async () => {
    const s = await Bridge.rdmStatus();
    clear(state);
    if (!s) { state.append(h("div", { class: "hint", text: t("Disponibile nell'app installata.") })); return; }
    state.append(
      line(!!s.exe || s.protocol, "Remote Desktop Manager", (s.exe ?? (s.protocol ? t("solo i link rdm://") : t("non trovato su questo PC"))) + " · " + (s.running ? t("avviato") : t("non avviato"))),
      line(!!s.pwsh, t("PowerShell 7"), s.pwsh ?? t("manca: serve per leggere l'elenco"), s.pwsh ? undefined : "winget install Microsoft.PowerShell"),
      line(!!s.module, t("Modulo di Devolutions"), s.module ? `Devolutions.PowerShell ${s.module}` : t("manca: da installare in PowerShell 7, della stessa versione di RDM"),
        s.module || !s.pwsh ? undefined : "Install-Module Devolutions.PowerShell -Scope CurrentUser"),
      line(s.count > 0 ? true : s.listError ? false : null, t("Elenco"),
        s.count > 0
          ? t("{n} connessioni da «{ds}»", { n: s.count, ds: s.dataSource ?? "RDM" }) + (s.at ? " · " + t("sincronizzato il {d}", { d: new Date(s.at * 1000).toLocaleString() }) : "") + (s.listError ? " · " + s.listError : "")
          : s.listError ?? t("non ancora sincronizzato")),
    );
  };

  const reread = h("button", { text: t("Sincronizza") }) as HTMLButtonElement;
  reread.addEventListener("click", async () => {
    reread.disabled = true;
    reread.textContent = t("Sincronizzo…");
    await Bridge.refreshIntegration("integration_rdm");
    await check();
    reread.disabled = false;
    reread.textContent = t("Sincronizza");
  });

  // The workspace: RDM's current one, or one chosen (loaded on request: it starts PowerShell).
  const source = h("select", {}, h("option", { value: "", text: t("Quella aperta in RDM") })) as HTMLSelectElement;
  if (c.rdmDataSource) source.append(h("option", { value: c.rdmDataSource, text: t("Scelta prima ({id})", { id: c.rdmDataSource.slice(0, 8) }) }));
  source.value = c.rdmDataSource ?? "";
  source.addEventListener("change", () => {
    c.rdmDataSource = source.value;
    void save();
    void Bridge.refreshIntegration("integration_rdm").then(check);
  });
  const load = h("button", { text: t("Carica le origini") }) as HTMLButtonElement;
  const sourceNote = h("span", { class: "hint note" });
  load.addEventListener("click", async () => {
    load.disabled = true;
    sourceNote.textContent = t("Chiedo a RDM…");
    try {
      const list = await Bridge.rdmDataSources();
      clear(source);
      source.append(h("option", { value: "", text: t("Quella aperta in RDM") }));
      for (const d of list) source.append(h("option", { value: d.id, text: d.kind ? `${d.name} (${d.kind})` : d.name }));
      source.value = list.some((d) => d.id === c.rdmDataSource) ? c.rdmDataSource ?? "" : "";
      sourceNote.textContent = t("{n} origini dati", { n: list.length });
    } catch (e) {
      sourceNote.textContent = String(e).replace(/^Error:\s*/, "");
    }
    load.disabled = false;
  });

  box.append(
    state,
    h("div", { class: "row" }, reread, h("span", { class: "hint note", text: t("l'elenco resta su questo PC, cifrato per il tuo utente Windows: si aggiorna solo quando premi Sincronizza") })),
    h("div", { class: "row" }, h("label", { style: "min-width:104px", text: t("Origine dati") }), source, load, sourceNote),
    h("div", { class: "hint", text: t("Con più origini (il tuo file, il server dei colleghi…) scegli quale leggere. Ognuno legge con i propri permessi di RDM: un collega vede solo ciò che vede in RDM. Se l'origine chiede un accesso o un secondo fattore, aprila prima in RDM e salva le credenziali.") }),
  );
  void check();
  return box;
}

/** What notion_suggest found, once per window. */
let notionFound: Promise<Awaited<ReturnType<typeof Bridge.notionSuggest>>> | null = null;

/**
 * Notion, before anything is chosen: the databases that look like tasks or
 * notes, one click each. Nothing shows when nothing fits (or no token yet).
 */
function notionQuickSetup(useTasks: (r: NotionRef) => void, useNotes: (r: NotionRef) => void): HTMLElement {
  const c = settings.integrationConfig;
  const box = h("div", { class: "notice", style: "display:none;flex-direction:column;gap:6px" });
  notionFound ??= Bridge.notionSuggest().catch(() => []);
  void notionFound.then((list) => {
    const tasks = c.notionTasks ? [] : list.filter((d) => d.tasks).slice(0, 2);
    const notes = c.notionInbox ? [] : list.filter((d) => d.notes && !d.tasks).slice(0, 2);
    if (!tasks.length && !notes.length) return;
    box.append(h("b", { text: t("Configurazione rapida") }),
      h("div", { class: "hint", text: t("Ho trovato questi database: un clic e la card è pronta (poi si cambia tutto qui sotto).") }));
    for (const d of tasks) box.append(h("div", { class: "row" },
      h("span", { style: "flex:1 1 auto;min-width:0", text: `${notionIcon(notionRef(d))}  ${d.title}` }),
      h("button", { class: "primary", text: t("Usa per le attività"), onclick: () => useTasks(notionRef(d)) })));
    for (const d of notes) box.append(h("div", { class: "row" },
      h("span", { style: "flex:1 1 auto;min-width:0", text: `${notionIcon(notionRef(d))}  ${d.title}` }),
      h("button", { text: t("Usa per le note"), onclick: () => useNotes(notionRef(d)) })));
    box.style.display = "flex";
  });
  return box;
}

/** Notion: the tasks database, where notes go, the pages kept in the card. */
function notionRows(): HTMLElement {
  const box = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const changed = (schemas = false) => {
    void save();
    if (schemas) void Bridge.notionForgetSchemas();
    void Bridge.refreshIntegration("integration_notion");
    draw();
  };
  const chosen = (r: NotionRef, remove: () => void) => h("div", { class: "row" },
    h("span", { style: "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: `${notionIcon(r)}  ${r.title}`, title: r.url }),
    h("button", { text: t("Togli"), onclick: remove }));
  const block = (label: string, hint: string, ...rows: (Node | null)[]) => h("div", { class: "row", style: "align-items:flex-start" },
    h("label", { style: "min-width:104px;padding-top:2px", text: label }),
    h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" }, h("div", { class: "hint", text: hint }), ...rows));

  // A tasks database chosen: three views to start from, "Oggi" in the card.
  const useTasks = (r: NotionRef) => {
    const c = settings.integrationConfig;
    c.notionTasks = r;
    c.notionViews = [
      { name: t("Oggi"), period: "today", days: 7, undated: false, filters: [], sort: "due" },
      { name: t("Settimana"), period: "week", days: 7, undated: false, filters: [], sort: "due" },
      { name: t("Tutte"), period: "all", days: 7, undated: true, filters: [], sort: "due" },
    ];
    c.notionView = t("Oggi");
    changed(true);
  };

  function draw() {
    clear(box);
    const c = settings.integrationConfig;
    if (!c.notionTasks || !c.notionInbox) box.append(notionQuickSetup(useTasks, (r) => { c.notionInbox = r; changed(true); }));
    box.append(
      block(t("Attività"), t("Il database delle tue cose da fare: la card mostra quelle non fatte, prima le scadute e quelle di oggi. Serve una data e una casella o uno stato «fatto»."),
        c.notionTasks ? chosen(c.notionTasks, () => { c.notionTasks = null; c.notionViews = []; c.notionView = ""; changed(true); })
          : notionPicker(t("Cerca il database…"), "database", useTasks)),
      ...(c.notionTasks
        ? [block(t("Viste"), t("Quali attività vedere nella card: per scadenza, categoria, contesto, progetto… Con più viste, nella card le cambi con un clic. Senza viste compaiono tutte quelle non fatte."),
          notionViewsEditor(c.notionTasks.id, () => { void save(); void Bridge.refreshIntegration("integration_notion"); }))]
        : []),
      block(t("Note"), t("Dove va «+ Nota»: in una pagina il testo si aggiunge in fondo con data e ora, in un database diventa una riga nuova."),
        c.notionInbox ? chosen(c.notionInbox, () => { c.notionInbox = null; changed(true); })
          : notionPicker(t("Cerca una pagina o un database…"), null, (r) => { c.notionInbox = r; changed(true); })),
      block(t("Pagine"), t("Le pagine e i database da tenere nella card, nell'ordine in cui li aggiungi (al massimo 6 visibili)."),
        ...c.notionPins.map((r) => chosen(r, () => { c.notionPins = c.notionPins.filter((x) => x.id !== r.id); changed(); })),
        notionPicker(t("Aggiungi una pagina…"), null, (r) => {
          if (!c.notionPins.some((x) => x.id === r.id)) c.notionPins = [...c.notionPins, r];
          changed();
        })),
      block(t("Avvisi"), t("Notion non passa alle integrazioni le sue notifiche (menzioni, promemoria): EasyIsland le ricava dalle attività e dai commenti, ogni 5 minuti, e le mostra nell'isola. Un clic apre la pagina."),
        h("div", { class: "row" },
          toggle(c.notionAlertDue !== false, (v) => { c.notionAlertDue = v; void save(); }),
          h("span", { text: t("Prima di un'attività con orario") }),
          select<string>([["0", t("all'ora")], ["5", t("5 minuti prima")], ["10", t("10 minuti prima")], ["15", t("15 minuti prima")], ["30", t("30 minuti prima")], ["60", t("un'ora prima")]],
            String(c.notionAlertLead ?? 10), (v) => { c.notionAlertLead = Number(v); void save(); })),
        h("div", { class: "row" },
          toggle(c.notionAlertComments !== false, (v) => { c.notionAlertComments = v; void save(); }),
          h("span", { text: t("Nuovi commenti sulle pagine qui sopra e sulle attività di oggi") })),
        h("div", { class: "row" },
          toggle(c.notionMorning !== false, (v) => { c.notionMorning = v; void save(); }),
          h("span", { text: t("Le attività di oggi nel riepilogo del mattino") }))),
      block(t("Mappa per la chat"), t("La struttura del tuo Notion (database, proprietà, opzioni, relazioni e pagine che l'integrazione vede) resta su questo PC, cifrata per il tuo utente Windows. La chat la riceve all'inizio di ogni conversazione e non deve cercare com'è fatto il tuo Notion. Il contenuto delle pagine non c'è."),
        notionMapRow(c)),
    );
  }
  draw();
  return box;
}

/**
 * Chat → "Assistenti" (Raycast's Agents, LibreChat's presets): a name, an
 * engine and instructions, picked in the chat with "/name" for one conversation.
 */
function assistantsBlock(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  let timer = 0;
  const persist = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 400);
  };
  const paint = () => {
    clear(list);
    const all = settings.chatAssistants ?? [];
    for (const a of all) {
      const icon = h("input", { type: "text", value: a.icon, maxlength: "4", style: "width:44px;text-align:center", title: t("Emoji") }) as HTMLInputElement;
      icon.addEventListener("input", () => { a.icon = icon.value.trim(); persist(); });
      const name = h("input", { type: "text", value: a.name, placeholder: t("Nome (es. Preventivi)"), style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
      name.addEventListener("input", () => { a.name = name.value; persist(); });
      const engine = h("select", {}) as HTMLSelectElement;
      engine.append(h("option", { value: "", text: t("Motore predefinito") }));
      for (const e of CHAT_ENGINES) engine.append(h("option", { value: e.id, text: e.name }));
      engine.value = a.engine;
      engine.addEventListener("change", () => { a.engine = engine.value; void save(); });
      const del = h("button", { text: t("Elimina") }) as HTMLButtonElement;
      del.addEventListener("click", () => {
        settings.chatAssistants = (settings.chatAssistants ?? []).filter((x) => x.id !== a.id);
        void save();
        paint();
      });
      const text = h("textarea", { class: "instructions", rows: "2", placeholder: t("Cosa deve sapere e come deve rispondere") }) as HTMLTextAreaElement;
      text.value = a.instructions;
      text.addEventListener("input", () => { a.instructions = text.value; persist(); });
      list.append(h("div", { class: "engine-block", style: "display:flex;flex-direction:column;gap:6px" },
        h("div", { class: "row" }, icon, name, engine, del), text));
    }
  };
  const add = h("button", { text: t("+ Aggiungi assistente") }) as HTMLButtonElement;
  add.addEventListener("click", () => {
    const a: ChatAssistant = { id: `a${Date.now().toString(36)}`, name: t("Nuovo assistente"), icon: "🤖", engine: "", instructions: "" };
    settings.chatAssistants = [...(settings.chatAssistants ?? []), a];
    void save();
    paint();
  });
  paint();
  return h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { class: "row" },
      h("label", { text: t("Assistenti") }),
      h("span", { class: "hint note", style: "flex:1 1 auto;min-width:0", text: t("un motore e delle istruzioni per un tipo di lavoro. Nella chat li scegli con / e il loro nome: valgono per quella conversazione") }),
      add),
    list);
}

/** Chat → "Istruzioni": what every new conversation is told first; of the active profile. */
function instructionsRow(): HTMLElement {
  const area = h("textarea", {
    class: "instructions",
    rows: "3",
    placeholder: t("Es. Rispondi breve. Sono un tecnico informatico, i miei clienti sono piccoli uffici. Per i preventivi usa l'IVA al 22%."),
  }) as HTMLTextAreaElement;
  area.value = settings.chatInstructions ?? "";
  let timer = 0;
  area.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      settings.chatInstructions = area.value;
      void save();
    }, 400);
  });
  return h("div", { style: "display:flex;flex-direction:column;gap:4px" },
    h("div", { class: "row" },
      h("label", { text: t("Istruzioni") }),
      h("span", { class: "hint note", text: t("dette alla chat all'inizio di ogni conversazione. Valgono per il profilo attivo: ogni profilo (es. un cliente) può avere le sue") })),
    area);
}

/** Chat → "Memoria" (memory.rs): the notes every conversation gets, the diary, and opening them. */
function memoryRow(): HTMLElement {
  const line = h("span", { class: "hint note", style: "flex:1 1 auto;min-width:0" });
  const show = (m: MemoryInfo | null) => {
    line.textContent = settings.chatHistory === false
      ? t("spenta insieme alla cronologia")
      : t("{n} note che la chat ricorda in ogni conversazione, {p} pagine collegate, {d} giorni nel diario, {i} file da leggere. File .md su questo PC: puoi modificarli", { n: m?.notes ?? 0, p: m?.pages ?? 0, d: m?.days ?? 0, i: m?.inbox ?? 0 });
  };
  const map = h("button", { text: t("Mappa") }) as HTMLButtonElement;
  map.addEventListener("click", () => void Bridge.memoryWindowOpen());
  const open = h("button", { text: t("Apri MEMORIA.md") }) as HTMLButtonElement;
  const fail = (e: unknown) => { line.textContent = String(e).replace(/^Error:\s*/, ""); };
  open.addEventListener("click", () => void Bridge.memoryOpen(false).catch(fail));
  const folder = h("button", { text: t("Cartella") }) as HTMLButtonElement;
  folder.addEventListener("click", () => void Bridge.memoryOpen(true).catch(fail));
  void Bridge.memoryInfo().then(show);
  return h("div", { class: "row" }, h("label", { text: t("Memoria") }), line, map, open, folder);
}

/** Chat → "Ricette": how a kind of question was answered, learnt by use (recipes.rs). */
function recipesRow(): HTMLElement {
  const line = h("span", { class: "hint note", style: "flex:1 1 auto;min-width:0" });
  const show = (n: number | null) => {
    line.textContent = t("{n} imparate con l'uso: alle domande simili la chat va dritta agli strumenti giusti, più veloce e con meno token", { n: n ?? 0 });
    forget.disabled = !n;
  };
  const forget = h("button", { text: t("Dimentica") }) as HTMLButtonElement;
  forget.addEventListener("click", async () => {
    await Bridge.recipesForget();
    show(await Bridge.recipesCount());
  });
  void Bridge.recipesCount().then(show);
  return h("div", { class: "row" }, h("label", { text: t("Ricette") }), line, forget);
}

/** Notion → "Mappa per la chat": what is kept, "Sincronizza" and how often by itself. */
function notionMapRow(c: IntegrationConfig): HTMLElement {
  const line = h("span", { class: "hint note", style: "flex:1 1 auto;min-width:0" });
  const error = h("div", { class: "notice warn", style: "display:none" });
  const show = (s: NotionMapStatus | null) => {
    line.textContent = !s || !s.at
      ? t("non ancora sincronizzata")
      : t("{db} database, {p} pagine · sincronizzata il {d}", { db: s.databases, p: s.pages, d: new Date(s.at * 1000).toLocaleString() });
  };
  void Bridge.notionMapStatus().then(show);
  const sync = h("button", { text: t("Sincronizza") }) as HTMLButtonElement;
  sync.addEventListener("click", async () => {
    sync.disabled = true;
    sync.textContent = t("Sincronizzo…");
    error.style.display = "none";
    try {
      show(await Bridge.notionMapSync());
    } catch (e) {
      error.textContent = String(e).replace(/^Error:\s*/, "");
      error.style.display = "";
    }
    sync.disabled = false;
    sync.textContent = t("Sincronizza");
  });
  const every = select<string>([["0", t("solo a mano")], ["1", t("ogni ora")], ["3", t("ogni 3 ore")], ["6", t("ogni 6 ore")], ["12", t("ogni 12 ore")], ["24", t("una volta al giorno")]],
    String(c.notionMapHours ?? 6), (v) => { c.notionMapHours = Number(v); void save(); });
  return h("div", {}, h("div", { class: "row" }, line, sync), h("div", { class: "row" }, h("span", { text: t("Da sola") }), every), error);
}

/** 3CX: the ringtone of "Questo PC", the built-in one or a file of the user's. */
function ringtoneRow(): HTMLElement {
  const name = h("span", { class: "hint note", style: "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" });
  const error = h("div", { class: "notice warn", style: "display:none" });
  const show = () => { name.textContent = settings.integrationConfig.threecxRingtone || t("Predefinita (generata da EasyIsland)"); };
  show();
  const file = h("input", { type: "file", accept: ".mp3,.wav,.ogg,.m4a,audio/*", style: "display:none" }) as HTMLInputElement;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    error.style.display = "none";
    try {
      await Bridge.threecxSetRingtone(f.name, new Uint8Array(await f.arrayBuffer()));
      settings.integrationConfig.threecxRingtone = f.name;
      show();
      void save();
    } catch (e) {
      error.textContent = String(e).replace(/^Error:\s*/, "");
      error.style.display = "";
    }
  });
  const reset = h("button", { text: t("Predefinita"), onclick: async () => {
    await Bridge.threecxSetRingtone("", new Uint8Array());
    settings.integrationConfig.threecxRingtone = "";
    show();
    void save();
  } });
  return h("div", { style: "display:flex;flex-direction:column;gap:4px" },
    h("div", { class: "row" },
      h("label", { style: "min-width:104px", text: t("Suoneria") }),
      name,
      h("button", { text: t("Scegli un file…"), title: t("MP3, WAV, OGG o M4A, fino a 10 MB"), onclick: () => file.click() }),
      reset, file),
    error);
}

/** Impostazioni → Integrazioni: the groups, in this order; anything else goes last. */
const INTEGRATION_GROUPS: [string, string[]][] = [
  [t("Lavoro e clienti"), ["integration_3cx", "integration_teams", "integration_zammad", "integration_rdm", "integration_remote", "integration_outlook", "integration_calcom", "integration_notion", "integration_telegram"]],
  [t("Sviluppo e servizi"), ["integration_github", "integration_vercel", "integration_n8n", "integration_stripe", "integration_resend"]],
  [t("Questo PC"), ["integration_recorder", "integration_system", "integration_security", "integration_network", "integration_weather", "integration_claude_usage", "integration_clipboard", "integration_media"]],
];

/** The integration whose settings are open (one at a time), kept while the window is. */
let openIntegration = "";
let integrationQuery = "";
let onlyActive = false;

/**
 * Impostazioni → Integrazioni: a short list by group, each integration one
 * row (switch, name, state, what it is); a click opens its settings under it,
 * one at a time. A search and "solo attive" narrow the list.
 */
function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { class: "int-groups" });
  const entries: { def: IntegrationDef; el: HTMLElement; text: string; refresh: () => void; open: (on: boolean) => void }[] = [];

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = t("Scegli quali integrazioni mostrare nel menu dell'isola ({n} attive). Le chiavi restano in Gestione credenziali di Windows, mai su disco.", { n: used });
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      refreshAll();
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
          if (field.key === "telegram-bot-token") void Bridge.telegramRestart();
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
    if (def.extra) {
      const row = def.extra();
      if (def.id === "integration_3cx") conditional.push([row, (c) => c.threecxMode !== "api"]);
      rows.append(row);
    }
    syncVisible();
    const dot = h("i", { class: "dot" });
    dot.style.background = settings.integrationColors?.[def.id] || def.color;
    if (!def.noMenu) {
      // Its icon in the island's menu: the logo (or its colour) or the user's emoji.
      const place = h("select", {},
        h("option", { value: "logo", text: hasMark(def.id) ? t("Logo") : t("Pallino del suo colore") }),
        h("option", { value: "icon", text: t("Emoji o lettere") })) as HTMLSelectElement;
      const iconInput = h("input", {
        type: "text", maxlength: "4", spellcheck: "false", style: "width:56px;text-align:center",
        title: t("Un'emoji o una o due lettere"), placeholder: TAB_ICONS[def.id] ?? "★",
      }) as HTMLInputElement;
      const icons = () => (settings.integrationTabIcons ??= {});
      const own = icons()[def.id]?.trim() ?? "";
      iconInput.value = own.startsWith("@") ? "" : own;
      place.value = own && !own.startsWith("@") ? "icon" : "logo";
      const syncIcon = () => { iconInput.style.display = place.value === "icon" ? "" : "none"; };
      syncIcon();
      place.addEventListener("change", () => {
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
        h("label", { style: "min-width:104px", text: t("Nel menu") }), place, iconInput,
        h("span", { class: "hint note", text: t("l'icona accanto al nome, nel menu a sinistra dell'isola") })));
      // Its colour: pill, card and the character while its tab is open.
      const colors = () => (settings.integrationColors ??= {});
      const paint = () => { dot.style.background = colors()[def.id] || def.color; };
      paint();
      rows.append(h("div", { class: "row" },
        h("label", { style: "min-width:104px", text: t("Colore") }),
        colorField(colors()[def.id] ?? "", def.color, (v) => {
          if (v) colors()[def.id] = v;
          else delete colors()[def.id];
          paint();
          void save();
        }, t("Predefinito")),
        h("span", { class: "hint note", text: t("anche del personaggio quando la sua scheda è aperta") })));
    }
    if (def.hint) rows.prepend(h("div", { class: "hint int-hint", text: def.hint }));

    // The row: switch, colour, name, its state and the first words of what it is.
    const state = h("span", { class: "int-state" });
    const summary = h("span", { class: "int-summary", text: firstSentence(def.hint ?? "") });
    const chevron = h("span", { class: "int-chevron", text: "›" });
    const head = h("div", { class: "int-row-head", role: "button", tabindex: "0" },
      sw, dot, h("span", { class: "int-row-name", text: def.name }), state, summary, chevron);
    const details = h("div", { class: "int-details" }, rows);
    const el = h("div", { class: "int-row", "data-item": def.id }, head, details);
    const open = (on: boolean) => {
      el.classList.toggle("open", on);
      details.style.display = on ? "" : "none";
    };
    const refresh = () => {
      const on = settings.activeIntegrations.includes(def.id);
      const missing = def.fields.filter((f) => !(f.when && !f.when(settings.integrationConfig)) && !present[f.key]);
      state.className = `int-state ${!on ? "off" : missing.length ? "warn" : "ok"}`;
      state.textContent = !on ? t("Spenta") : missing.length ? t("Manca: {what}", { what: missing.map((f) => f.label.toLowerCase()).join(", ") }) : t("Attiva");
    };
    const toggleOpen = () => {
      const next = openIntegration === def.id ? "" : def.id;
      openIntegration = next;
      for (const e of entries) e.open(e.def.id === next);
      if (next) requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    head.addEventListener("click", toggleOpen);
    head.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") toggleOpen(); });
    // A key saved in this row changes its state.
    rows.addEventListener("click", () => window.setTimeout(refresh, 300));
    open(openIntegration === def.id);
    refresh();
    entries.push({ def, el, text: `${def.name} ${def.hint ?? ""}`.toLowerCase(), refresh, open });
  }

  function refreshAll() {
    for (const e of entries) e.refresh();
    draw();
  }

  // Groups, then the search and "solo attive" over them.
  function draw() {
    clear(list);
    const q = integrationQuery.trim().toLowerCase();
    const shown = (e: (typeof entries)[number]) =>
      (!q || e.text.includes(q)) && (!onlyActive || settings.activeIntegrations.includes(e.def.id));
    const grouped = new Set(INTEGRATION_GROUPS.flatMap(([, ids]) => ids));
    const groups: [string, (typeof entries)[number][]][] = [
      ...INTEGRATION_GROUPS.map(([name, ids]) => [name, ids.map((id) => entries.find((e) => e.def.id === id)).filter((e): e is (typeof entries)[number] => !!e)] as [string, (typeof entries)[number][]]),
      [t("Altre"), entries.filter((e) => !grouped.has(e.def.id))],
    ];
    for (const [name, items] of groups) {
      const visible = items.filter(shown);
      if (!visible.length) continue;
      const on = items.filter((e) => settings.activeIntegrations.includes(e.def.id)).length;
      list.append(h("div", { class: "int-group" },
        h("div", { class: "int-group-head" }, h("span", { text: name }), h("span", { class: "hint", text: t("{n} di {total} attive", { n: on, total: items.length }) })),
        ...visible.map((e) => e.el)));
    }
    if (!list.childElementCount) list.append(h("div", { class: "hint", text: t("Nessuna integrazione trovata.") }));
  }

  const search = h("input", { type: "text", placeholder: t("Cerca un'integrazione…"), value: integrationQuery, spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
  search.addEventListener("input", () => { integrationQuery = search.value; draw(); });
  const filterRow = h("div", { class: "row" }, search,
    h("label", { class: "inline-check" }, toggle(onlyActive, (v) => { onlyActive = v; draw(); }), h("span", { text: t("Solo attive") })));
  draw();

  updateNote();
  // Pills and tabs are dragged into order right in the island.
  const resetOrder = h("button", { text: t("Ripristina l'ordine"), title: t("Torna all'ordine predefinito") });
  resetOrder.addEventListener("click", () => { settings.pillOrder = []; settings.tabOrder = []; void save(); });
  const orderRow = h("div", { class: "row" },
    h("label", { text: t("Blocca lo spostamento") }),
    toggle(!!settings.lockOrder, (v) => { settings.lockOrder = v; void save(); }),
    resetOrder,
    h("span", { class: "hint note", text: t("nell'isola le integrazioni del menu e i riquadri della Panoramica si riordinano trascinandoli; acceso, restano dove sono") }));
  return h("section", {}, h("h2", {}, h("span", { text: t("Integrazioni") }), profileChip()), note, filterRow, list,
    h("h3", { class: "int-sub", text: t("Menu dell'isola") }), orderRow);
}

/** The first sentence of a hint, for the integration's row. */
function firstSentence(text: string): string {
  const s = text.split(/(?<=\.)\s/)[0] ?? "";
  return s.replace(/\.$/, "");
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
      h("span", { class: "hint note", text: t("delle schede, il menu a sinistra si aggiunge") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Altezza minima") }),
      heightSlider,
      h("button", { text: t("Predefinite"), onclick: () => { settings.islandWidth = 640; settings.islandHeight = 0; commit(); render(); } }),
      h("span", { class: "hint note", text: t("0 = l'altezza di ogni vista; fino alla grandezza dello schermo, anche trascinando l'angolo dell'isola aperta") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Campo in alto") }),
      toggle(settings.searchBar !== false, (v) => { settings.searchBar = v; commit(); }),
      h("span", { class: "hint note", text: t("nella barra dell'isola aperta: cerca integrazioni, azioni e programmi installati") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Personaggio nel menu") }),
      select([["large", t("Grande")], ["medium", t("Medio")], ["small", t("Piccolo")]], settings.menuCharacter ?? "large",
        (v) => { settings.menuCharacter = v as Settings["menuCharacter"]; commit(); }),
      h("span", { class: "hint note", text: t("in cima al menu a sinistra dell'isola aperta") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Fumetto") }),
      toggle(settings.characterBubble !== false, (v) => { settings.characterBubble = v; commit(); }),
      h("span", { class: "hint note", text: t("in alto il personaggio dice cosa succede: la richiesta in attesa, la sessione al lavoro, la scheda aperta") }),
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
      h("label", { text: t("Risposte rapide") }),
      select([["right", t("A destra del personaggio")], ["left", t("A sinistra del personaggio")], ["off", t("Spente")]],
        settings.compactStrip ?? "right",
        (v) => { settings.compactStrip = v as Settings["compactStrip"]; commit(); }),
      h("span", { class: "hint note", text: t("a isola chiusa, accanto al personaggio: chi lavora e cosa fa, Nega / Consenti sui permessi, Rispondi / Rifiuta e Riaggancia sulle chiamate 3CX, senza aprire l'isola. Spente: i permessi e le chiamate aprono l'isola come prima.") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Barra dell'app in uso") }),
      toggle(settings.appBar !== false, (v) => { settings.appBar = v; commit(); }),
      h("span", { class: "hint note", text: t("accanto al personaggio chiuso, le tue azioni rapide del programma che stai usando (Azioni rapide → «Nella barra con»). Nulla di predefinito: senza azioni per quel programma non compare. Ha la precedenza sulla riga dell'agente al lavoro, non su permessi e chiamate.") }),
    ),
    h("div", { class: "row" },
      h("label", { text: "" }),
      h("span", { class: "hint", text: t("Pulsanti") }),
      select<Settings["appBarLook"]>([["both", t("Icona e testo")], ["icon", t("Solo icona")], ["text", t("Solo testo")]],
        settings.appBarLook ?? "both", (v) => { settings.appBarLook = v; commit(); }),
      h("span", { class: "hint", text: t("al massimo") }),
      (() => {
        const n = h("input", { type: "number", min: "1", max: "12", value: String(settings.appBarMax || 6), style: "width:64px" }) as HTMLInputElement;
        n.addEventListener("change", () => { settings.appBarMax = Math.min(12, Math.max(1, Math.round(Number(n.value)) || 6)); n.value = String(settings.appBarMax); commit(); });
        return n;
      })(),
      h("span", { class: "hint", text: t("Nome del programma") }),
      toggle(settings.appBarName !== false, (v) => { settings.appBarName = v; commit(); }),
    ),
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
      h("label", { text: t("Come un'app") }),
      toggle(settings.islandApp ?? false, (v) => { settings.islandApp = v; commit(); }),
      h("span", { class: "hint note", text: t("icona nella barra delle applicazioni (un clic apre l'isola), Alt+Tab, riduci a icona e schermo intero") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Resta aperta") }),
      toggle(settings.stayOpenByUser ?? false, (v) => { settings.stayOpenByUser = v; commit(); }),
      h("span", { class: "hint note", text: t("quando la apri tu non si chiude da sola: come con 📌, finché non la chiudi") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Schermo intero") }),
      toggle(settings.quietFullscreen, (v) => { settings.quietFullscreen = v; commit(); }),
      h("span", { class: "hint note", text: t("nascondi durante video, giochi e presentazioni (i permessi compaiono comunque)") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Permessi e chiamate") }),
      toggle(settings.alertsOpen !== false, (v) => { settings.alertsOpen = v; commit(); }),
      h("span", { class: "hint note", text: t("aprono l'isola da soli; spento, aspettano accanto al personaggio o con un pallino (li apre la scorciatoia «Vai alla richiesta in attesa»)") }),
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
  "hoverSize", "compactStrip", "appBar", "chatInstructions", "appBarLook", "appBarMax", "appBarName", "openDelay", "revealDuration", "quietFullscreen", "soundEnabled",
  "soundVolume", "autoCloseInterval", "theme", "notify", "reactions", "actions", "widgets", "mcpServers",
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

/** What a prompt action works on, and where its answer goes, as one choice in the editor. */
type PromptUse = QuickAction["input"] | "replace";

/** Actions on the selected text to start from: name, icon, colour, prompt. */
const STARTER_REWRITES = (): [string, string, string, string][] => [
  [t("Riscrivi"), "i:sparkles", "#8b5cf6", t("Riscrivi questo testo in modo più chiaro e scorrevole, stesso tono e stessa lingua.")],
  [t("Correggi"), "i:check", "#22c55e", t("Correggi errori di ortografia, grammatica e punteggiatura di questo testo, senza cambiarne il senso.")],
  [t("Più formale"), "i:briefcase", "#0a84d6", t("Riscrivi questo testo in un tono più formale e professionale, stessa lingua.")],
  [t("In inglese"), "i:globe", "#38bdf8", t("Traduci questo testo in inglese, con lo stesso tono.")],
];

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
function iconPicker(value: string, color: string, onPick: (v: string) => void, auto?: () => Promise<string | null>): HTMLElement {
  const current = actionIcon(value)?.name;
  const pop = h("div", { class: "icon-pop", role: "listbox" });
  if (auto) {
    // The program's own icon or the site's favicon, taken now and kept in the action.
    const b = h("button", { class: `icon-auto${value.startsWith("data:") ? " on" : ""}`, title: t("L'icona del programma o del sito") },
      h("span", { text: t("Automatica") }));
    b.addEventListener("click", async () => {
      b.classList.add("working");
      const v = await auto();
      b.classList.remove("working");
      if (!v) {
        b.title = t("Icona non trovata: controlla il link o il programma");
        b.classList.add("failed");
        return;
      }
      pop.classList.remove("open");
      onPick(v);
    });
    pop.append(b);
  }
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

/** The automatic icon of a link or program action as a small PNG data: URL, or null. */
async function autoIcon(a: QuickAction): Promise<string | null> {
  const target = a.target.trim();
  if (!target) return null;
  const raw = a.kind === "url" ? await Bridge.siteIcon(/^[a-z][\w+.-]*:/i.test(target) ? target : `https://${target}`).catch(() => null)
    : a.kind === "app" ? await Bridge.programIcon(target).catch(() => null) : null;
  return raw ? pngIcon(raw) : null;
}

/** Any picture (ico, svg, png…) redrawn as a 64 px PNG, so every view shows it the same way. */
function pngIcon(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const side = 64;
      const c = document.createElement("canvas");
      c.width = c.height = side;
      const g = c.getContext("2d");
      const w = img.naturalWidth || side;
      const hh = img.naturalHeight || side;
      if (!g) return resolve(null);
      const k = Math.min(side / w, side / hh);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, (side - w * k) / 2, (side - hh * k) / 2, w * k, hh * k);
      try {
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
  const starters = h("div", { class: "row" });
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
    drawStarters();
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
        [["prompt", t("Chiedi alla chat")], ["keys", t("Tasti nel programma in uso")], ["script", "Script"], ["app", t("Programma / cartella")], ["url", "Link"]],
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

      // A new link or program: its icon follows it while the user has not picked one.
      let autoTimer = 0;
      const refreshAuto = () => {
        if (a.icon !== "i:bolt" && !a.icon.startsWith("data:")) return;
        window.clearTimeout(autoTimer);
        autoTimer = window.setTimeout(async () => {
          const v = await autoIcon(a);
          if (!v || (a.icon !== "i:bolt" && !a.icon.startsWith("data:"))) return;
          a.icon = v;
          touch();
          card.querySelector(".icon-pick-btn")?.replaceChildren(renderActionIcon(v, 18));
        }, 900);
      };
      const card = h("div", { class: "qa-edit", "data-item": a.id },
        h("div", { class: "row head" },
          iconPicker(a.icon, a.color, (v) => { a.icon = v; touch(); draw(); }, a.kind === "url" || a.kind === "app" ? () => autoIcon(a) : undefined),
          field(a.name, t("Nome"), (v) => { a.name = v.trim(); }),
          color, kind, up, down, del,
        ),
      );

      switch (a.kind) {
        case "url":
          card.append(h("div", { class: "row" }, h("label", { text: t("Link") }),
            field(a.target, "https://…", (v) => { a.target = v.trim(); refreshAuto(); })));
          break;
        case "keys": {
          // The sequence as text, plus a recorder that appends the combination pressed.
          const keysField = field(a.keys ?? "", t("es. Ctrl+T  ·  Ctrl+L, \"https://…\", Invio  ·  F5"), (v) => { a.keys = v; }) as HTMLInputElement;
          const rec = h("button", { text: t("● Registra"), title: t("Premi una combinazione: si aggiunge in fondo") });
          rec.addEventListener("click", () => {
            rec.textContent = t("Premi i tasti…");
            void Bridge.hotkeysSuspend(true);
            const done = () => {
              window.removeEventListener("keydown", onKey, true);
              rec.textContent = t("● Registra");
              void Bridge.hotkeysSuspend(false);
            };
            const onKey = (e: KeyboardEvent) => {
              e.preventDefault();
              e.stopPropagation();
              const key = hotkeyKeyName(e.code) ?? ({
                ArrowUp: "Su", ArrowDown: "Giù", ArrowLeft: "Sinistra", ArrowRight: "Destra", Backspace: "Backspace",
                Delete: "Canc", Home: "Inizio", End: "Fine", PageUp: "PagSu", PageDown: "PagGiù", Insert: "Ins",
              } as Record<string, string>)[e.code];
              if (!key) return; // a modifier alone: wait for the key
              const combo = [...hotkeyModifiers(e), key].join("+");
              const now = keysField.value.trim();
              keysField.value = now ? `${now}, ${combo}` : combo;
              a.keys = keysField.value;
              touch();
              done();
            };
            window.addEventListener("keydown", onKey, true);
          });
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Tasti") }), keysField, rec),
            h("div", { class: "row" }, h("label", { text: "" }), h("span", { class: "hint note", text: t("Separati da virgole: combinazioni (Ctrl, Alt, Maiusc, Win + un tasto), tasti come Invio, Esc, F5, Su, Giù, Tab; il testo tra virgolette viene scritto così com'è; «attendi 300» fa una pausa in millisecondi. Vanno al programma in primo piano.") })),
          );
          break;
        }
        case "app":
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Programma o cartella") }),
              field(a.target, t("es. mstsc, chrome, regedit, %ProgramFiles%\\App\\app.exe, C:\\Clienti"), (v) => { a.target = v.trim(); refreshAuto(); })),
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
        case "prompt": {
          // One choice for what the action works on and where the answer goes.
          const use: PromptUse = a.input === "selection" && a.output === "replace" ? "replace" : a.input;
          const replacing = use === "replace";
          card.append(
            h("div", { class: "row" }, h("label", { text: t("Lavora su") }),
              select<PromptUse>(
                [
                  ["replace", t("Testo selezionato: lo sostituisce")],
                  ["selection", t("Testo selezionato: risposta in chat")],
                  ["page", t("Tutto il testo della finestra in uso (pagina, mail, documento)")],
                  ["clipboard", t("Testo copiato negli appunti")],
                  ["file", t("File rilasciato sull'isola")],
                  ["none", t("Niente (solo la domanda)")],
                ],
                use,
                (v) => {
                  a.input = v === "replace" ? "selection" : v;
                  if (v === "replace") a.output = "replace";
                  else delete a.output;
                  touch();
                  draw();
                },
              ),
              a.input === "selection"
                ? h("span", { class: "hint note", text: t("compare nel menu di {key}", { key: settings.hotkeySelectionMenu || "Win+Alt+A" }) })
                : null),
            area(a.prompt, replacing ? t("Come riscrivere il testo, es. «Rendilo più cortese»") : t("Cosa chiedere alla chat"),
              (v) => { a.prompt = v; }),
          );
          break;
        }
      }
      card.append(h("div", { class: "row" }, h("label", { text: t("Scorciatoia") }),
        hotkeyInput(a.hotkey, (v) => { a.hotkey = v; touch(); })));
      // ── The bar of the app in use ──
      const appsField = field(a.apps ?? "", t("programmi, es. chrome.exe, msedge.exe — * = tutti"), (v) => {
        const apps = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).join(", ");
        if (apps) a.apps = apps;
        else delete a.apps;
      }) as HTMLInputElement;
      // The program in front right now, one click away (not the settings window itself).
      const addFront = h("button", { text: t("+ Programma in uso"), title: t("Aggiunge il programma che era in primo piano prima delle Impostazioni") });
      addFront.addEventListener("click", async () => {
        const fg = await Bridge.foregroundApp();
        if (!fg?.exe || fg.exe === "easyisland.exe") return;
        const list = (a.apps ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (!list.includes(fg.exe)) list.push(fg.exe);
        a.apps = list.join(", ");
        appsField.value = a.apps;
        touch();
      });
      card.append(
        h("div", { class: "row" }, h("label", { text: t("Nella barra con") }), appsField, addFront),
        h("div", { class: "row" }, h("label", { text: "" }),
          h("span", { class: "hint", text: t("Solo nella barra") }),
          toggle(a.barOnly === true, (v) => { if (v) a.barOnly = true; else delete a.barOnly; touch(); }),
          h("span", { class: "hint", text: t("Aspetto") }),
          select<"" | "both" | "icon" | "text">(
            [["", t("Come la barra")], ["both", t("Icona e testo")], ["icon", t("Solo icona")], ["text", t("Solo testo")]],
            a.barLook ?? "", (v) => { if (v) a.barLook = v; else delete a.barLook; touch(); }),
          h("span", { class: "hint note", text: t("accanto al personaggio chiuso, quando usi uno di questi programmi; «Solo nella barra» la toglie dalla scheda ⚡, dalla ricerca e dal menu della selezione") })),
      );
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
        // The name as typed now (it is only taken on "change"); with none yet, the
        // field asks for one instead of the click doing nothing.
        const folderIcon = iconPicker(look.icon, "#94a3b8", (v) => {
          const name = folderField.value.trim();
          if (!name) {
            folderField.placeholder = t("Prima scrivi il nome della cartella");
            folderField.focus();
            return;
          }
          a.folder = folderValue(v, name);
          for (const x of [...actions, ...drafts.values()]) if (folderLook(x.folder).name === name) x.folder = folderValue(v, name);
          if (!isNew) commit();
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

  /** With no action on the selected text, the menu is empty: offer four to start from. */
  function drawStarters() {
    clear(starters);
    const none = !settings.actions.some((a) => a.kind === "prompt" && a.input === "selection");
    starters.style.display = none ? "" : "none";
    if (!none) return;
    starters.append(
      h("span", { class: "hint", text: t("Il menu è vuoto finché non crei un'azione sul testo selezionato.") }),
      h("button", {
        text: t("Aggiungi Riscrivi, Correggi, Più formale, In inglese"),
        onclick: () => {
          settings.actions.push(...STARTER_REWRITES().map(([name, icon, color, prompt]) => ({
            ...blankAction(), name, icon, color, prompt, input: "selection" as const, output: "replace" as const,
          })));
          commit();
          draw();
        },
      }),
    );
  }

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
    h("div", { class: "row" }, h("label", { text: t("Menu sul testo selezionato") }),
      hotkeyField(settings.hotkeySelectionMenu ?? "", (v) => { settings.hotkeySelectionMenu = v; }),
      h("span", { class: "hint note", text: t("in qualunque app, browser compresi: mostra le azioni che lavorano sul testo selezionato") })),
    starters,
    h("div", { class: "row" }, h("label", { text: t("Cronologia appunti") }),
      hotkeyField(settings.hotkeyClipboard, (v) => { settings.hotkeyClipboard = v; })),
    h("div", { class: "row" }, h("label", { text: t("Riquadra e chiedi") }),
      hotkeyField(settings.hotkeyScreenshot, (v) => { settings.hotkeyScreenshot = v; }),
      h("span", { class: "hint note", text: t("scorciatoie di questo PC, valgono in ogni app") })),
    h("div", { class: "row" }, h("label", { text: t("Vai alla richiesta in attesa") }),
      hotkeyField(settings.hotkeyPending, (v) => { settings.hotkeyPending = v; }),
      h("span", { class: "hint note", text: t("poi N nega, Y consente, S sempre; 1–9 sceglie una risposta") })),
    h("div", { class: "row" }, h("label", { text: t("Porta avanti la sessione") }),
      hotkeyField(settings.hotkeySession, (v) => { settings.hotkeySession = v; }),
      h("span", { class: "hint note", text: t("l'app dove gira la sessione: terminale, VS Code, Cursor o Claude") })),
    h("div", { class: "row" }, h("label", { text: t("Integrazione successiva") }),
      hotkeyField(settings.hotkeyNextPill ?? "", (v) => { settings.hotkeyNextPill = v; })),
    h("div", { class: "row" }, h("label", { text: t("Suoni sì / no") }),
      hotkeyField(settings.hotkeyMute ?? "", (v) => { settings.hotkeyMute = v; }),
      h("span", { class: "hint note", text: t("Isola aperta: ← → voce successiva, ↑ ↓ scorre, Ctrl+N nuova chat, Ctrl+P tieni aperta, Esc chiude") })),
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
  ["back", t("Quando torni al PC dopo una pausa")],
  ["wifi", t("Quando ti colleghi a una rete Wi-Fi")],
  ["app", t("Quando parte un programma")],
  ["foreground", t("Quando passi a un programma")],
  ["drive", t("Quando colleghi una chiavetta o un disco")],
  ["folder", t("Quando arriva un file in una cartella")],
  ["download", t("Quando finisce un download")],
  ["integration", t("Quando un'integrazione o un widget segnala…")],
  ["call", t("Quando arriva una chiamata (3CX)")],
  ["agent", t("Quando un agente finisce o chiede un permesso")],
  ["server", t("Quando parte un server di sviluppo")],
  ["teams", t("Quando inizia o finisce una riunione Teams")],
];

const STEP_KINDS: [AutomationStep["kind"], string][] = [
  ["quick", t("Esegui un'azione rapida")],
  ["notice", t("Mostra un avviso nell'isola")],
  ["chat", t("Chiedi alla chat")],
  ["task", t("Avvia un compito")],
  ["profile", t("Passa a un profilo")],
  ["app", t("Apri un programma o una cartella")],
  ["url", t("Apri un link")],
  ["wait", t("Aspetta")],
  ["confirm", t("Chiedi prima di continuare")],
];

const CONDITION_KINDS: [AutomationCondition["kind"], string][] = [
  ["hours", t("è tra le…")],
  ["wifi", t("sei sulla rete Wi-Fi")],
  ["app", t("è aperto il programma")],
  ["foreground", t("è in primo piano il programma")],
  ["meeting", t("sei in riunione (microfono o webcam in uso)")],
  ["client", t("sei «davanti al cliente»")],
  ["idle", t("sei assente da")],
  ["battery", t("il PC va a batteria")],
];

/** The trigger's data each "quando" hands to the steps (automations.rs `fill`). */
const PLACEHOLDERS: Partial<Record<AutomationTrigger["kind"], string[]>> = {
  wifi: ["rete"],
  app: ["programma"],
  foreground: ["programma"],
  drive: ["unità"],
  folder: ["file", "percorso", "cartella"],
  download: ["file", "percorso", "cartella"],
  integration: ["testo", "fonte"],
  call: ["chiamante", "numero"],
  agent: ["agente", "progetto", "cartella"],
  server: ["link", "porta", "programma"],
  back: ["minuti"],
};

function blankStep(kind: AutomationStep["kind"] = "notice"): AutomationStep {
  return { kind, id: "", title: "", text: "", level: "info", target: "", args: "", url: "" };
}

function blankCondition(kind: AutomationCondition["kind"] = "hours"): AutomationCondition {
  return { kind, not: false, from: "09:00", to: "18:00", days: [1, 2, 3, 4, 5], ssid: "", exe: "", minutes: 10, percent: 0 };
}

function blankAutomation(): Automation {
  return {
    id: `a${Date.now().toString(36)}`,
    name: t("Nuova automazione"),
    enabled: true,
    trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5], delay: 30, ssid: "", exe: "", folder: "", source: "", when: "problem", filter: "", minutes: 15 },
    profile: "",
    conditions: [],
    repeat: "",
    every: 60,
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

  /** L M M G V S D: none on = every day. */
  function dayButtons(days: number[], apply: (d: number[]) => void): HTMLElement {
    const box = h("div", { class: "days" });
    let now = [...days];
    for (const [d, label] of DAYS) {
      const b = h("button", { class: now.includes(d) ? "day on" : "day", text: label, title: t("Vuoto = tutti i giorni") });
      b.addEventListener("click", () => {
        now = now.includes(d) ? now.filter((x) => x !== d) : [...now, d].sort();
        b.classList.toggle("on");
        apply(now);
        commit();
      });
      box.append(b);
    }
    return box;
  }

  function timeInput(value: string, apply: (v: string) => void): HTMLInputElement {
    const el = h("input", { type: "time", value: value || "09:00" }) as HTMLInputElement;
    el.addEventListener("change", () => { apply(el.value); commit(); });
    return el;
  }

  function numberInput(value: number, min: number, max: number, apply: (v: number) => void): HTMLInputElement {
    const el = h("input", { type: "number", min: String(min), max: String(max), value: String(value), style: "width:80px" }) as HTMLInputElement;
    el.addEventListener("change", () => {
      const n = Math.min(max, Math.max(min, Math.round(Number(el.value)) || min));
      el.value = String(n);
      apply(n);
      commit();
    });
    return el;
  }

  function draw() {
    clear(list);
    if (settings.automations.length === 0) {
      list.append(h("div", { class: "hint", text: t("Nessuna automazione. Esempi: alle 9 dei giorni feriali apri Outlook e il gestionale; quando finisce il download di un PDF in orario d'ufficio chiedi alla chat di riassumerlo; quando torni dalla pausa e non sei in riunione mostra le attività; quando il sito di un cliente va giù esegui lo script di controllo.") }));
    }
    settings.automations.forEach((a, idx) => {
      const trg = a.trigger;
      const conditions = (a.conditions ??= []);
      const field = (value: string, placeholder: string, apply: (v: string) => void, style = "flex:1 1 auto;min-width:0") => {
        const el = h("input", { type: "text", value, placeholder, style, spellcheck: "false" }) as HTMLInputElement;
        el.addEventListener("change", () => { apply(el.value); commit(); });
        return el;
      };
      const filterRow = (placeholder: string) =>
        h("div", { class: "row" }, h("label", { text: t("Solo se") }),
          field(trg.filter ?? "", placeholder, (v) => { trg.filter = v.trim(); }),
          h("span", { class: "hint note", text: t("vuoto = sempre") }));
      const tested = h("span", { class: "hint note" });
      const test = h("button", { text: t("Prova ora"), title: t("Esegue subito i passi, senza guardare le condizioni (salva prima)") });
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
        select<AutomationTrigger["kind"]>(TRIGGER_KINDS, trg.kind, (v) => {
          trg.kind = v;
          if (v === "agent" && !["stop", "permission", "any"].includes(trg.when)) trg.when = "stop";
          if (v === "integration" && !["problem", "event", "any"].includes(trg.when)) trg.when = "problem";
          if (v === "teams" && !["start", "end"].includes(trg.when)) trg.when = "start";
          commit();
          draw();
        }));
      card.append(when);
      switch (trg.kind) {
        case "time":
          card.append(h("div", { class: "row" }, h("label", { text: t("Alle") }),
            timeInput(trg.time, (v) => { trg.time = v; }),
            dayButtons(trg.days, (d) => { trg.days = d; }),
            h("span", { class: "hint note", text: t("nessun giorno = tutti i giorni") })));
          break;
        case "startup":
          card.append(h("div", { class: "row" }, h("label", { text: t("Dopo") }),
            numberInput(trg.delay || 30, 5, 3600, (n) => { trg.delay = n; }),
            h("span", { class: "hint note", text: t("secondi dall'avvio di EasyIsland (che parte con Windows, se attivo in Generale)") })));
          break;
        case "back":
          card.append(h("div", { class: "row" }, h("label", { text: t("Assente da") }),
            numberInput(trg.minutes || 15, 1, 720, (n) => { trg.minutes = n; }),
            h("span", { class: "hint note", text: t("minuti almeno, senza toccare tastiera e mouse") })));
          break;
        case "wifi":
          card.append(h("div", { class: "row" }, h("label", { text: t("Rete") }),
            field(trg.ssid, t("nome della rete Wi-Fi, es. Ufficio-5G"), (v) => { trg.ssid = v.trim(); })));
          break;
        case "app":
        case "foreground":
          card.append(h("div", { class: "row" }, h("label", { text: t("Programma") }),
            field(trg.exe, t("nome dell'eseguibile, es. teams.exe, excel.exe"), (v) => { trg.exe = v.trim(); })));
          break;
        case "folder":
          card.append(h("div", { class: "row" }, h("label", { text: t("Cartella") }),
            field(trg.folder, t("es. C:\\Users\\nome\\Downloads o \\\\server\\scansioni"), (v) => { trg.folder = v.trim(); })));
          card.append(filterRow(t("es. .pdf, .docx oppure una parola del nome")));
          break;
        case "download":
          card.append(filterRow(t("es. .pdf, .zip oppure una parola del nome")));
          break;
        case "call":
          card.append(filterRow(t("nome o numero di chi chiama, es. Rossi, 0331")));
          break;
        case "agent":
          card.append(h("div", { class: "row" }, h("label", { text: t("Quando") }),
            select<AutomationTrigger["when"]>(
              [["stop", t("ha finito")], ["permission", t("aspetta un permesso")], ["any", t("ha finito o aspetta un permesso")]],
              trg.when, (v) => { trg.when = v; commit(); })));
          card.append(filterRow(t("progetto o agente, es. easyisland, Codex")));
          break;
        case "server":
          card.append(filterRow(t("programma o porta, es. node, 5173")));
          break;
        case "teams":
          card.append(h("div", { class: "row" }, h("label", { text: t("Quando") }),
            select<AutomationTrigger["when"]>([["start", t("inizia")], ["end", t("finisce")]],
              trg.when === "end" ? "end" : "start", (v) => { trg.when = v; commit(); }),
            h("span", { class: "hint note", text: t("serve l'integrazione Microsoft Teams accesa") })));
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
          card.append(filterRow(t("una parola del messaggio, es. urgente")));
          break;
        }
      }

      // ── Se ──
      card.append(h("div", { class: "row" }, h("label", { text: t("Solo nel profilo") }),
        select<string>([["", t("Qualsiasi profilo")], ...settings.profiles.map((p): [string, string] => [p.id, p.name])],
          a.profile, (v) => { a.profile = v; commit(); })));
      conditions.forEach((c, ci) => {
        const remove = h("button", { class: "danger icon", text: "✕", title: t("Togli questa condizione"),
          onclick: () => { conditions.splice(ci, 1); commit(); draw(); } });
        // "Se" / "Se non" sits in the label column.
        const lead = select<string>([["", ci === 0 ? t("Se") : t("e se")], ["not", ci === 0 ? t("Se non") : t("e se non")]],
          c.not ? "not" : "", (v) => { c.not = v === "not"; commit(); });
        lead.style.width = "132px";
        const row = h("div", { class: "row" }, lead,
          select<AutomationCondition["kind"]>(CONDITION_KINDS, c.kind, (v) => { conditions[ci] = { ...blankCondition(v), not: c.not }; commit(); draw(); }));
        // The days of "è tra le…" go on a line of their own, under the times.
        let below: HTMLElement | null = null;
        switch (c.kind) {
          case "hours":
            row.append(timeInput(c.from, (v) => { c.from = v; }), h("span", { class: "hint", text: t("e le") }),
              timeInput(c.to || "18:00", (v) => { c.to = v; }));
            below = h("div", { class: "row" }, h("label", { text: "" }), dayButtons(c.days, (d) => { c.days = d; }),
              h("span", { class: "hint note", text: t("nessun giorno = tutti i giorni") }));
            break;
          case "wifi":
            row.append(field(c.ssid, t("nome della rete, es. Ufficio-5G"), (v) => { c.ssid = v.trim(); }));
            break;
          case "app":
          case "foreground":
            row.append(field(c.exe, t("es. excel.exe"), (v) => { c.exe = v.trim(); }));
            break;
          case "idle":
            row.append(numberInput(c.minutes || 10, 1, 720, (n) => { c.minutes = n; }), h("span", { class: "hint", text: t("minuti") }));
            break;
          case "battery":
            row.append(h("span", { class: "hint", text: t("sotto il") }), numberInput(c.percent, 0, 100, (n) => { c.percent = n; }),
              h("span", { class: "hint note", text: t("% (0 = basta che vada a batteria)") }));
            break;
        }
        row.append(remove);
        card.append(row);
        if (below) card.append(below);
      });
      const repeat = a.repeat ?? "";
      const repeatRow = h("div", { class: "row" }, h("label", { text: t("Ripeti") }),
        select<"" | "every" | "day">(
          [["", t("ogni volta")], ["every", t("al massimo una volta ogni…")], ["day", t("una volta al giorno")]],
          repeat, (v) => { a.repeat = v; if (v === "every" && !a.every) a.every = 60; commit(); draw(); }));
      if (repeat === "every") {
        repeatRow.append(numberInput(a.every || 60, 1, 1440, (n) => { a.every = n; }), h("span", { class: "hint", text: t("minuti") }));
      }
      const addCondition = h("button", { text: t("+ Aggiungi una condizione"),
        onclick: () => { conditions.push(blankCondition("hours")); commit(); draw(); } });
      repeatRow.append(addCondition);
      card.append(repeatRow);

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
          case "chat":
            row.append(field(s.text, t("la domanda, es. Riassumi {percorso}"), (v) => { s.text = v; }));
            break;
          case "task":
            row.append(
              field(s.title, t("Titolo"), (v) => { s.title = v; }, "width:160px"),
              field(s.text, t("l'obiettivo, es. Leggi {percorso} e preparami un riassunto in Notion"), (v) => { s.text = v; }));
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
              field(s.args, t("argomenti (facoltativi)"), (v) => { s.args = v; }, "width:160px"));
            break;
          case "url":
            row.append(field(s.url, "https://…", (v) => { s.url = v.trim(); }));
            break;
          case "wait":
            row.append(numberInput(s.minutes || 5, 1, 240, (n) => { s.minutes = n; }), h("span", { class: "hint", text: t("minuti") }));
            break;
          case "confirm":
            row.append(
              field(s.title, t("Titolo (facoltativo)"), (v) => { s.title = v; }, "width:160px"),
              field(s.text, t("Testo (facoltativo): di serie elenca i passi che seguono"), (v) => { s.text = v; }));
            break;
        }
        row.append(remove);
        card.append(row);
      });
      // The trigger's data, to put in notices, links, arguments and questions.
      const names = [...(PLACEHOLDERS[trg.kind] ?? []), "ora", "data"];
      card.append(h("div", { class: "row" }, h("label", { text: "" }),
        h("span", { class: "hint note", text: t("Nei passi puoi usare: {list}. Negli script no: lì non entrano mai.", { list: names.map((n) => `{${n}}`).join(" ") }) })));
      const addStep = h("button", { text: t("+ Aggiungi un passo"),
        onclick: () => { a.steps.push(blankStep("quick")); commit(); draw(); } });
      card.append(h("div", { class: "row" }, h("label", { text: "" }), addStep,
        h("span", { class: "hint", text: t("Avvisami ogni volta") }),
        toggle(a.notify, (v) => { a.notify = v; commit(); }),
        h("span", { class: "hint", text: t("Continua dopo un errore") }),
        toggle(a.keepGoing ?? false, (v) => { a.keepGoing = v; commit(); }),
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
      // "plugin:Notion:notion" → "Notion (plugin)": a server of a Claude Code plugin.
      const plugin = /^plugin:([^:]+):(.+)$/.exec(name);
      const label = plugin ? `${plugin[1]}${plugin[2].toLowerCase() === plugin[1].toLowerCase() ? "" : ` · ${plugin[2]}`} (${t("plugin")})` : name;
      const row = h("div", { class: "row" }, use, h("span", { style: "min-width:160px", text: label, title: name }));
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
    h("h3", {}, h("span", { text: t("Connettori (server MCP)") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("I server MCP che hai configurato in Claude Code (calendario, documenti, ticketing…), anche quelli dei plugin di Claude Code. Con la conferma accesa ogni operazione chiede Consenti / Nega nell'isola: spegnila solo per connettori di sola lettura. Quelli di claude.ai qui non ci sono."),
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

      const card = h("div", { class: "qa-edit", "data-item": w.id },
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
      text: t("Controlli che compaiono nel menu dell'isola: il calendario (link ICS), la scadenza dei domini, siti, certificati, server, porte, servizi Windows o qualsiasi API JSON; se ne possono creare quanti servono. Stato del PC, sicurezza, rete, meteo, Outlook e Zammad sono in Integrazioni. Quando un controllo passa da OK a problema, il personaggio ti avvisa. Si fermano quando EasyIsland è in pausa."),
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

// ── Reazioni del personaggio ──────────────────────────────────────────────────

/** Pills that never complain (or have their own way to show up, like a 3CX call). */
const NO_REACTION = new Set(["integration_claude", "integration_clipboard", "integration_media", "integration_weather", "integration_3cx", "integration_rdm", "integration_teams", "integration_recorder", "integration_remote"]);

/**
 * What the character does in each situation: show itself and sound, change
 * face quietly, or stay calm (only the pill tells). One row per situation of
 * the agents, and one per active check or integration, so a shaky notebook
 * connection can stay quiet while the rest still speaks up.
 */
function reactionsSection(): HTMLElement {
  const choices: [Reaction, string][] = [
    ["show", t("Si fa vedere e suona")],
    ["quiet", t("Cambia faccia, in silenzio")],
    ["off", t("Resta tranquillo")],
  ];
  const row = (label: string, key: string) =>
    h("div", { class: "row" }, h("label", { text: label }),
      select<Reaction>(choices, settings.reactions?.[key] ?? "show", (v) => {
        const all = { ...(settings.reactions ?? {}) };
        // "show" is the default: not written, so a new situation starts as before.
        if (v === "show") delete all[key];
        else all[key] = v;
        settings.reactions = all;
        void save();
      }));
  const checks = [
    ...settings.activeIntegrations
      .filter((id) => !NO_REACTION.has(id))
      .map((id) => [INTEGRATIONS.find((i) => i.id === id)?.name ?? id, id] as const),
    ...(settings.widgets ?? []).map((w) => [w.name || t("Widget"), `widget:${w.id}`] as const),
  ];
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Reazioni del personaggio") }), profileChip()),
    h("div", {
      class: "hint",
      text: t("Per ogni situazione scegli cosa fa il personaggio. «Cambia faccia, in silenzio»: niente suono e l'isola non si apre. «Resta tranquillo»: lo dice solo il pallino nel menu. Permessi e domande degli agenti si fanno sempre vedere, perché l'agente aspetta te."),
    }),
    h("h3", { text: t("Agenti") }),
    row(t("Ha finito"), "agentFinished"),
    row(t("Si ferma per un errore"), "agentError"),
    row(t("Arriva a un limite"), "agentLimit"),
    h("h3", { text: t("Controlli e integrazioni") }),
    ...(checks.length
      ? checks.map(([name, key]) => row(name, key))
      : [h("div", { class: "hint", text: t("Nessun controllo attivo: le integrazioni e i widget accesi compaiono qui.") })]),
  );
}

// ── Davanti al cliente ────────────────────────────────────────────────────────

/** "Proposte al momento giusto" (moments.rs): each one on or off. */
function momentsSection(): HTMLElement {
  const row = (label: string, key: "momentDownloads" | "momentErrors" | "momentServers" | "clearSecrets", note: string) =>
    h("div", { class: "row" },
      h("label", { text: label }),
      toggle(settings[key] !== false, (v) => { settings[key] = v; void save(); }),
      h("span", { class: "hint note", text: note }));
  return h("section", {},
    h("h2", {}, h("span", { text: t("Proposte al momento giusto") })),
    h("div", { class: "hint", text: t("L'isola nota cosa succede sul PC e propone il passo dopo con un clic. Non copre mai quello che stai facendo e segue le regole qui sopra.") }),
    row(t("Download finito"), "momentDownloads", t("Apri, Mostra nella cartella e le azioni sui file, per un file nuovo nella cartella Download")),
    row(t("Errore copiato"), "momentErrors", t("«Spiega e correggi» per uno stack trace o un traceback negli appunti, e chi tiene una porta occupata (serve l'integrazione Appunti)")),
    row(t("Server di sviluppo"), "momentServers", t("«Apri nel browser» quando npm run dev, vite, uvicorn… iniziano ad ascoltare su localhost")),
    row(t("Password e chiavi copiate"), "clearSecrets", t("tolte dagli appunti dopo 30 secondi, se nel frattempo non hai copiato altro")));
}

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

/** Any picture as a PNG data: URL at most 512 px on its longer side, for logo.rs. */
function pngForIsland(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error(t("Immagine non valida")));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("Immagine non valida")));
    };
    img.src = url;
  });
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

  // What sits in the island (character/figure.ts): the character, or a still
  // picture — the EasyIsland logo, the user's PNG (logo.rs) or the weather.
  const characterRow = h("div", { class: "row" },
    h("label", { text: t("Personaggio") }),
    select<string>(
      characters().map((c) => [c.id, c.name] as [string, string]),
      th.character ?? characters()[0].id,
      (v) => { th.character = v; commit(); drawColorRow(); },
    ),
  );
  const logoRow = h("div", { class: "row" });
  const drawLogoRow = async () => {
    const url = await Bridge.logoLoad().catch(() => null);
    clear(logoRow);
    const file = h("input", { type: "file", accept: "image/png,image/*", style: "display:none" }) as HTMLInputElement;
    const status = h("span", { class: "hint" });
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      status.textContent = t("Carico…");
      void pngForIsland(f)
        .then((data) => Bridge.logoSave(data))
        .then(() => {
          th.logoStamp = Date.now();
          commit();
          void drawLogoRow();
        })
        .catch((e) => { status.textContent = String(e).replace(/^Error:\s*/, ""); });
    });
    logoRow.append(
      h("label", { text: t("Il mio logo") }),
      url ? h("img", { class: "logo-preview", src: url, alt: "" }) : h("span", { class: "hint", text: t("nessuna immagine: intanto c'è il logo di EasyIsland") }),
      status,
      file,
      h("button", { text: url ? t("Cambia…") : t("Carica PNG…"), onclick: () => file.click() }),
      ...(url ? [h("button", {
        text: t("Togli"),
        onclick: () => { void Bridge.logoClear().then(() => { th.logoStamp = Date.now(); commit(); void drawLogoRow(); }); },
      })] : []),
      h("span", { class: "hint note", text: t("un PNG con lo sfondo trasparente rende meglio; viene ridotto a 512 px e resta su questo PC (va anche nel backup)") }),
    );
  };
  const showFigure = () => {
    const f = th.figure ?? "character";
    characterRow.style.display = f === "character" ? "" : "none";
    colorRow.style.display = f === "character" ? "" : "none";
    logoRow.style.display = f === "logo" ? "" : "none";
    if (f === "logo") void drawLogoRow();
  };
  const figureRow = h("div", { class: "row" },
    h("label", { text: t("Nell'isola") }),
    select<Theme["figure"]>(
      [["character", t("Il personaggio")], ["easyisland", t("Il logo di EasyIsland")], ["logo", t("Il mio logo")], ["weather", t("Il meteo")]],
      th.figure ?? "character",
      (v) => { th.figure = v; commit(); showFigure(); },
    ),
    h("span", { class: "hint note", text: t("logo e meteo sono immagini ferme: niente animazioni, stati e saluto all'avvio, per un aspetto più sobrio. Il meteo viene dall'integrazione Meteo, che dev'essere attiva") }),
  );
  showFigure();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Tema") }), profileChip()),
    h("div", { class: "row" },
      h("label", { text: t("Stile") }),
      select<"windows" | "classic">(
        [["windows", t("Windows 11")], ["classic", t("Classico")]],
        uiStyle(th.style),
        (v) => { th.style = v; applyUiStyle(v); commit(); render(); },
      ),
      h("span", { class: "hint note", text: t("l'aspetto dell'isola e di questa finestra: Windows 11 (grigio, colore d'accento di Windows, icone a linea) o Classico (isola nera, colori di EasyIsland)") }),
    ),
    figureRow,
    logoRow,
    characterRow,
    colorRow,
    h("div", { class: "row" },
      h("label", { text: t("Colore dell'isola") }),
      colorField(th.islandColor, "#000000", (v) => { th.islandColor = v || "#000000"; commit(); }, uiStyle(th.style) === "windows" ? t("Grigio di Windows") : t("Nero")),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Opacità dell'isola") }),
      slider(50, 100, 5, pct(th.islandOpacity), "%", (v) => { th.islandOpacity = v / 100; commit(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Sfondo a isola chiusa") }),
      toggle(th.compactBackground ?? true, (v) => { th.compactBackground = v; commit(); }),
      h("span", { class: "hint note", text: t("spento, a isola chiusa resta solo il personaggio, senza il cerchio o la barra dell'isola; aprendola lo sfondo torna. Con la barra al passaggio del mouse i mini personaggi restano senza sfondo") }),
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

// ── Compiti (tasks.rs) ─────────────────────────────────────────────────────────

let taskItems: AgentTaskItem[] = [];
/** The task whose log is open. */
let taskLogOpen = "";
/** The task whose engines are being changed. */
let taskEnginesOpen = "";

const TASK_STATE: Record<TaskState, [string, string]> = {
  scheduled: [t("Programmato"), "off"],
  queued: [t("In coda"), "off"],
  running: [t("Al lavoro"), "ok"],
  asking: [t("Attende te"), "warn"],
  paused: [t("In pausa"), "warn"],
  done: [t("Fatto"), "ok"],
  failed: [t("Non riuscito"), "warn"],
  stopped: [t("Fermato"), "off"],
};

const WEEKDAYS = [t("lunedì"), t("martedì"), t("mercoledì"), t("giovedì"), t("venerdì"), t("sabato"), t("domenica")];

/** "daily:09:00" → "ogni giorno alle 09:00". */
function whenLabel(when: string): string {
  if (!when) return t("subito");
  const cut = when.indexOf(":");
  const kind = when.slice(0, cut);
  const rest = when.slice(cut + 1);
  if (kind === "at") return t("il {when}", { when: rest });
  if (kind === "daily") return t("ogni giorno alle {time}", { time: rest });
  if (kind === "weekdays") return t("dal lunedì al venerdì alle {time}", { time: rest });
  if (kind === "every") return t("ogni {n} minuti", { n: rest });
  if (kind === "weekly") {
    const [d, ...hm] = rest.split(":");
    const day = WEEKDAYS[Number(d) - 1] ?? d;
    return t("ogni settimana, {day} alle {time}", { day, time: hm.join(":") });
  }
  return when;
}

/** The form for a new task and the list of all of them. */
function tasksSection(): HTMLElement {
  const list = h("div", { class: "tasks", id: "tasks-list" });
  const feedback = h("div", {});
  const title = h("input", { type: "text", placeholder: t("Titolo (facoltativo)"), style: "flex:1 1 220px" }) as HTMLInputElement;
  const goal = h("textarea", { placeholder: t("Cosa deve fare, con i dettagli che servono. Es.: guarda i ticket nuovi di Zammad e le mail dei clienti e preparami un riepilogo con le priorità in una pagina di Notion.") }) as HTMLTextAreaElement;
  const date = h("input", { type: "date" }) as HTMLInputElement;
  const time = h("input", { type: "time", value: "09:00" }) as HTMLInputElement;
  const weekday = select<string>(WEEKDAYS.map((l, i): [string, string] => [String(i + 1), l]), "1", () => {});
  const every = select<string>([["15", "15 min"], ["30", "30 min"], ["60", t("1 ora")], ["120", t("2 ore")], ["240", t("4 ore")]], "60", () => {});
  const kind = select<"now" | "at" | "daily" | "weekdays" | "weekly" | "every">(
    [["now", t("Subito")], ["at", t("A un'ora")], ["daily", t("Ogni giorno")], ["weekdays", t("Dal lunedì al venerdì")],
      ["weekly", t("Ogni settimana")], ["every", t("Ogni tanto")]],
    "now",
    () => paintWhen(),
  );
  const paintWhen = () => {
    date.style.display = kind.value === "at" ? "" : "none";
    weekday.style.display = kind.value === "weekly" ? "" : "none";
    every.style.display = kind.value === "every" ? "" : "none";
    time.style.display = kind.value === "now" || kind.value === "every" ? "none" : "";
  };
  paintWhen();
  const engines = h("div", {});
  let picker = enginePicker("", "", []);
  engines.append(picker.el);
  // The engines that are ready mark the others "non pronto".
  void loadReadyEngines().then(() => {
    picker = enginePicker("", "", []);
    engines.replaceChildren(picker.el);
  });
  const add = h("button", { class: "primary", text: t("Crea compito") }) as HTMLButtonElement;
  add.addEventListener("click", async () => {
    clear(feedback);
    let when = "";
    if (kind.value === "at") when = `at:${date.value} ${time.value}`;
    else if (kind.value === "weekly") when = `weekly:${weekday.value}:${time.value}`;
    else if (kind.value === "every") when = `every:${every.value}`;
    else if (kind.value !== "now") when = `${kind.value}:${time.value}`;
    const e = picker.value();
    try {
      await Bridge.taskNew(title.value, goal.value, when, e.engine, e.model, e.helpers);
      title.value = "";
      goal.value = "";
      await refreshTasks();
    } catch (e) {
      feedback.append(h("div", { class: "notice err", text: String(e) }));
    }
  });
  void refreshTasks();
  return h("section", {},
    h("h2", {}, h("span", { text: t("Nuovo compito") })),
    h("div", { class: "row" }, title),
    goal,
    engines,
    h("div", { class: "row" }, h("label", { text: t("Quando") }), kind, date, weekday, every, time, h("span", { class: "spacer" }), add),
    feedback,
    h("span", { class: "hint", text: t("Puoi crearli anche dalla chat («/compito …», oppure a parole) e da Telegram. Mentre lavora lo vedi nella scheda Agenti dell'isola: permessi e domande arrivano lì.") }),
    h("h2", {}, h("span", { text: t("I tuoi compiti") })),
    list,
  );
}

async function refreshTasks() {
  taskItems = (await Bridge.tasksList()) ?? [];
  paintTasks();
}

function paintTasks() {
  // The heartbeat's choice follows the tasks (they arrive after the page is drawn).
  const beat = taskItems.find((x) => x.heartbeat);
  const every = document.getElementById("heartbeat-every") as HTMLSelectElement | null;
  if (every && document.activeElement !== every) every.value = beat?.when.startsWith("every:") ? beat.when.slice(6) : "0";
  const digest = document.getElementById("digest-toggle");
  if (digest) {
    const on = taskItems.some((x) => x.digest);
    digest.classList.toggle("on", on);
    digest.setAttribute("aria-pressed", String(on));
  }
  const list = document.getElementById("tasks-list");
  if (!list) return;
  clear(list);
  if (!taskItems.length) {
    list.append(h("span", { class: "hint", text: t("Ancora nessun compito.") }));
    return;
  }
  for (const task of [...taskItems].reverse()) list.append(taskRow(task));
}

type TaskAction = "start" | "pause" | "resume" | "stop" | "delete";

function taskRow(task: AgentTaskItem): HTMLElement {
  const [label, tone] = TASK_STATE[task.state] ?? [task.state, "off"];
  const done = task.plan.filter((s) => s.done).length;
  const buttons = h("div", { class: "row" });
  const btn = (text: string, action: TaskAction, cls = "") => {
    const b = h("button", { class: cls, text }) as HTMLButtonElement;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await Bridge.taskControl(task.id, action);
      } catch (e) {
        console.warn(e);
      }
      await refreshTasks();
    });
    buttons.append(b);
  };
  switch (task.state) {
    case "running":
      btn(t("Pausa"), "pause");
      btn(t("Ferma"), "stop");
      break;
    case "paused":
      btn(t("Riprendi"), "resume", "primary");
      btn(t("Ferma"), "stop");
      break;
    case "queued":
    case "asking":
      btn(t("Ferma"), "stop");
      break;
    case "scheduled":
      btn(t("Avvia ora"), "start");
      break;
    default:
      btn(t("Rifai"), "start");
  }
  const log = h("button", { text: taskLogOpen === task.id ? t("Chiudi registro") : t("Registro") });
  log.addEventListener("click", () => {
    taskLogOpen = taskLogOpen === task.id ? "" : task.id;
    paintTasks();
  });
  buttons.append(log);
  if (task.state !== "running") {
    const motors = h("button", { text: taskEnginesOpen === task.id ? t("Chiudi motori") : t("Motori") });
    motors.addEventListener("click", () => {
      taskEnginesOpen = taskEnginesOpen === task.id ? "" : task.id;
      paintTasks();
    });
    buttons.append(motors);
  }
  buttons.append(h("span", { class: "spacer" }));
  btn(t("Elimina"), "delete", "danger");

  const meta = [whenLabel(task.when), enginesLine(task), task.plan.length ? t("{done} di {n} passi", { done, n: task.plan.length }) : "", task.updated].filter(Boolean).join(" · ");
  const body = h("div", { class: "task-body" }, h("div", { class: "hint", text: task.goal }), h("div", { class: "hint", text: meta }));
  if (task.plan.length) {
    body.append(h("ol", { class: "task-plan" }, ...task.plan.map((s) => h("li", { class: s.done ? "done" : "", text: s.text }))));
  }
  if (task.quiet && task.state === "done") body.append(h("div", { class: "hint", text: t("Ultimo controllo: niente da segnalare.") }));
  else if (task.result) body.append(h("div", { class: "notice ok task-result", text: task.result }));
  else if (task.last) body.append(h("div", { class: "hint", text: task.last }));
  if (task.state === "asking") {
    const reply = h("input", { type: "text", placeholder: t("La tua risposta"), style: "flex:1 1 260px" }) as HTMLInputElement;
    const send = h("button", { class: "primary", text: t("Rispondi") }) as HTMLButtonElement;
    const go = async () => {
      if (!reply.value.trim()) return;
      try {
        await Bridge.taskAnswer(task.id, reply.value);
      } catch (e) {
        console.warn(e);
      }
      await refreshTasks();
    };
    send.addEventListener("click", () => void go());
    reply.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void go();
    });
    body.append(h("div", { class: "notice warn", text: task.question }), h("div", { class: "row" }, reply, send));
  }
  body.append(buttons);
  if (taskEnginesOpen === task.id && task.state !== "running") {
    const picker = enginePicker(task.engine, task.model, task.helpers);
    const feedback = h("div", {});
    const save = h("button", { class: "primary", text: t("Salva i motori") }) as HTMLButtonElement;
    save.addEventListener("click", async () => {
      const e = picker.value();
      try {
        await Bridge.taskSetEngines(task.id, e.engine, e.model, e.helpers);
        taskEnginesOpen = "";
        await refreshTasks();
      } catch (err) {
        feedback.replaceChildren(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
      }
    });
    body.append(h("div", { class: "qa-edit" }, picker.el, feedback, h("div", { class: "row" }, save)));
  }
  if (taskLogOpen === task.id) {
    const pre = h("div", { class: "diff task-log", text: "…" });
    void Bridge.taskLog(task.id).then((text) => {
      pre.textContent = text || t("Registro vuoto.");
    });
    body.append(pre);
  }
  return h("div", { class: "task", "data-item": task.id },
    h("div", { class: "task-head" },
      h("span", { class: "task-title", text: task.title }),
      h("span", { class: `int-state ${tone}`, text: label })),
    body);
}

/** Engine and limits of the tasks. */
function tasksSettingsSection(): HTMLElement {
  const engine = h("select", {}) as HTMLSelectElement;
  engine.append(h("option", { value: "", text: t("Quello della chat") }));
  for (const e of CHAT_ENGINES) engine.append(h("option", { value: e.id, text: e.name }));
  engine.value = settings.tasksEngine ?? "";
  engine.addEventListener("change", () => {
    settings.tasksEngine = engine.value;
    void save();
  });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Come lavorano") })),
    h("div", { class: "row" }, h("label", { text: t("Motore") }), engine,
      h("span", { class: "hint note", text: t("serve un motore con gli strumenti: Claude con l'abbonamento (consigliato), Claude con la chiave API, opencode o Antigravity; gli altri rispondono soltanto") })),
    h("div", { class: "row" }, h("label", { text: t("Turni per volta") }),
      slider(1, 50, 1, settings.tasksMaxTurns ?? 12, "", (v) => {
        settings.tasksMaxTurns = v;
        void save();
      }),
      h("span", { class: "hint note", text: t("poi il compito va in pausa e lo riprendi tu: così tempo e costi restano sotto controllo") })),
    h("div", { class: "row" }, h("label", { text: t("Minuti per volta") }),
      slider(5, 240, 5, settings.tasksMaxMinutes ?? 30, " min", (v) => {
        settings.tasksMaxMinutes = v;
        void save();
      })),
    h("span", { class: "hint", text: t("Un compito alla volta, gli altri in coda. Ha gli stessi strumenti e permessi della chat: inviare, eliminare o approvare resta sempre un tuo clic.") }),
  );
}

/** The engines that can answer now (engines_ready); in the browser preview, all of them. */
let readyEngines: Set<string> | null = null;

async function loadReadyEngines() {
  const list = await Bridge.enginesReady();
  readyEngines = list ? new Set(list.filter(([, , ok]) => ok).map(([id]) => id)) : new Set(CHAT_ENGINES.map((e) => e.id));
}

function engineName(id: string): string {
  return CHAT_ENGINES.find((e) => e.id === id)?.name ?? id;
}

/**
 * A task's engines: the one that leads it (and its model), and the helpers it
 * may hand a piece of work to (task_delegate in tasks.rs).
 */
function enginePicker(engine: string, model: string, helpers: string[]): { el: HTMLElement; value(): { engine: string; model: string; helpers: string[] } } {
  const ready = (id: string) => !readyEngines || readyEngines.has(id);
  const main = h("select", {}) as HTMLSelectElement;
  main.append(h("option", { value: "", text: t("Quello dei compiti (qui sotto)") }));
  for (const e of CHAT_ENGINES) main.append(h("option", { value: e.id, text: ready(e.id) ? e.name : `${e.name} · ${t("non pronto")}` }));
  main.value = engine;
  const modelField = h("input", { type: "text", value: model, placeholder: t("modello (vuoto = quello del motore)"), style: "flex:1 1 200px" }) as HTMLInputElement;
  const paintModel = () => {
    modelField.style.display = main.value ? "" : "none";
  };
  main.addEventListener("change", paintModel);
  paintModel();
  const chosen = new Set(helpers);
  const chips = h("div", { class: "chip-opts" });
  for (const e of CHAT_ENGINES) {
    const b = h("button", { class: chosen.has(e.id) ? "chip-opt on" : "chip-opt", text: e.name,
      title: ready(e.id) ? t("Può affidargli un pezzo del lavoro") : t("Non pronto: configuralo in Impostazioni → Chat") }) as HTMLButtonElement;
    b.addEventListener("click", () => {
      if (chosen.has(e.id)) chosen.delete(e.id);
      else chosen.add(e.id);
      b.classList.toggle("on", chosen.has(e.id));
    });
    chips.append(b);
  }
  const el = h("div", { class: "engine-picker" },
    h("div", { class: "row" }, h("label", { text: t("Motore") }), main, modelField),
    h("div", { class: "row" }, h("label", { text: t("Motori aiutanti") }), chips),
    h("span", { class: "hint", text: t("Il motore guida il compito; agli aiutanti può affidare un pezzo del lavoro (una ricerca, una revisione, un testo), ognuno con i suoi punti di forza.") }));
  return { el, value: () => ({ engine: main.value, model: main.value ? modelField.value.trim() : "", helpers: [...chosen] }) };
}

/** "Claude (abbonamento) · aiutanti: opencode, Gemini". */
function enginesLine(task: AgentTaskItem): string {
  const main = task.engine ? `${engineName(task.engine)}${task.model ? ` (${task.model})` : ""}` : t("motore dei compiti");
  return task.helpers.length ? `${main} · ${t("aiutanti: {list}", { list: task.helpers.map(engineName).join(", ") })}` : main;
}

// ── Integrazioni personali (custom.rs) ────────────────────────────────────────

let customItems: Custom[] = [];
/** The integration whose description is open as JSON. */
let customEditing = "";

/** The integrations made from the chat: on or off in the menu, their JSON, delete. */
function customsSection(): HTMLElement {
  const list = h("div", { class: "tasks", id: "customs-list" });
  void Bridge.customsList().then((l) => {
    customItems = l ?? [];
    paintCustoms();
  });
  return h("section", {},
    h("h2", {}, h("span", { text: t("Create da te") })),
    h("span", { class: "hint", text: t("Integrazioni fatte a parole nella chat: «crea un'integrazione per i preventivi, con cliente, voci con quantità e prezzo, IVA e totale, e un pulsante che crea il PDF». Hanno campi, caselle, scelte, tabelle, calcoli, un modello del documento e pulsanti per salvare, creare il documento, copiarlo, chiedere alla chat, aprire un link, eseguire un'azione rapida o aggiungerle a Notion. Per cambiarne una chiedilo alla chat, oppure modifica qui la sua descrizione.") }),
    list);
}

function paintCustoms() {
  const list = document.getElementById("customs-list");
  if (!list) return;
  clear(list);
  if (!customItems.length) {
    list.append(h("span", { class: "hint", text: t("Ancora nessuna: chiedila alla chat.") }));
    return;
  }
  for (const c of customItems) list.append(customRow(c));
}

function customRow(c: Custom): HTMLElement {
  const feedback = h("div", {});
  const save = async (next: Custom) => {
    clear(feedback);
    try {
      const saved = await Bridge.customSave(next);
      customItems = customItems.map((x) => (x.id === saved.id ? saved : x));
      return true;
    } catch (e) {
      feedback.append(h("div", { class: "notice err", text: String(e).replace(/^Error:\s*/, "") }));
      return false;
    }
  };
  const shown = toggle(c.enabled, (on) => void save({ ...c, enabled: on }));
  const json = h("button", { text: customEditing === c.id ? t("Chiudi") : t("Modifica la descrizione") }) as HTMLButtonElement;
  json.addEventListener("click", () => {
    customEditing = customEditing === c.id ? "" : c.id;
    paintCustoms();
  });
  const del = h("button", { class: "danger", text: t("Elimina") }) as HTMLButtonElement;
  del.addEventListener("click", async () => {
    if (!del.classList.contains("confirm")) {
      del.classList.add("confirm");
      del.textContent = t("Sicuro? Elimina anche le schede");
      return;
    }
    try {
      await Bridge.customDelete(c.id);
      customItems = customItems.filter((x) => x.id !== c.id);
      paintCustoms();
    } catch (e) {
      feedback.append(h("div", { class: "notice err", text: String(e) }));
    }
  });
  const body = h("div", { class: "task-body" },
    h("div", { class: "hint", text: c.description }),
    h("div", { class: "hint", text: t("{n} campi · {a} azioni · {s} fonti di dati · id {id}", { n: c.fields.length, a: c.actions.length, s: (c.sources ?? []).length, id: c.id }) }),
    h("div", { class: "row" }, h("label", { text: t("Nel menu dell'isola") }), shown, json, h("span", { class: "spacer" }), del),
    feedback);
  // Its keys ({{secret:nome}}): written into the Credential Manager, never shown again.
  for (const name of c.secrets ?? []) {
    const key = `custom:${c.id}:${name}`;
    const field = h("input", { type: "password", placeholder: "…", style: "flex:1 1 220px" }) as HTMLInputElement;
    const state = h("span", { class: "hint note" });
    void Bridge.secretPresent(key).then((ok) => (state.textContent = ok ? t("salvata in Gestione credenziali") : t("da inserire")));
    const set = h("button", { text: t("Salva") }) as HTMLButtonElement;
    set.addEventListener("click", async () => {
      try {
        await Bridge.secretSet(key, field.value);
        field.value = "";
        state.textContent = t("salvata in Gestione credenziali");
      } catch (e) {
        state.textContent = String(e);
      }
    });
    body.insertBefore(h("div", { class: "row" }, h("label", { text: t("Chiave «{n}»", { n: name }) }), field, set, state), feedback);
  }
  if (customEditing === c.id) {
    const area = h("textarea", { class: "mono" }) as HTMLTextAreaElement;
    area.value = JSON.stringify(c, null, 2);
    area.style.minHeight = "260px";
    const ok = h("button", { class: "primary", text: t("Salva la descrizione") }) as HTMLButtonElement;
    ok.addEventListener("click", async () => {
      let next: Custom;
      try {
        next = JSON.parse(area.value) as Custom;
      } catch (e) {
        feedback.replaceChildren(h("div", { class: "notice err", text: t("Non è JSON valido: {e}", { e: String(e) }) }));
        return;
      }
      next.id = c.id;
      if (await save(next)) {
        customEditing = "";
        paintCustoms();
      }
    });
    body.append(area, h("div", { class: "row" }, ok));
  }
  return h("div", { class: "task", "data-item": `custom-${c.id}` },
    h("div", { class: "task-head" }, h("span", { text: c.icon || "✦" }), h("span", { class: "task-title", text: c.name })),
    body);
}

// ── Battito (tasks.rs) ──────────────────────────────────────────────────────────

/** The heartbeat: a check every N minutes of what BATTITO.md lists, quiet when there is nothing. */
function heartbeatSection(): HTMLElement {
  const beat = taskItems.find((x) => x.heartbeat);
  const minutes = beat?.when.startsWith("every:") ? beat.when.slice(6) : "0";
  const feedback = h("div", {});
  const every = select<string>(
    [["0", t("Spento")], ["15", t("ogni 15 minuti")], ["30", t("ogni 30 minuti")], ["60", t("ogni ora")], ["120", t("ogni 2 ore")], ["240", t("ogni 4 ore")]],
    minutes,
    async (v) => {
      clear(feedback);
      try {
        await Bridge.heartbeatSet(Number(v));
        await refreshTasks();
        render();
      } catch (e) {
        feedback.append(h("div", { class: "notice err", text: String(e).replace(/^Error:\s*/, "") }));
      }
    },
  );
  every.id = "heartbeat-every";
  const list = h("button", { text: t("Cosa tenere d'occhio…") }) as HTMLButtonElement;
  list.addEventListener("click", () => void Bridge.heartbeatOpen().catch((e) => feedback.replaceChildren(h("div", { class: "notice err", text: String(e) }))));
  const digest = toggle(taskItems.some((x) => x.digest), async (on) => {
    clear(feedback);
    try {
      await Bridge.digestSet(on);
      await refreshTasks();
    } catch (e) {
      feedback.append(h("div", { class: "notice err", text: String(e).replace(/^Error:\s*/, "") }));
    }
  });
  digest.id = "digest-toggle";
  return h("section", {},
    h("h2", {}, h("span", { text: t("Battito") })),
    h("div", { class: "row" }, h("label", { text: t("Controllo periodico") }), every, list,
      h("span", { class: "hint note", text: t("a ogni battito l'agente guarda le cose elencate in BATTITO.md (ticket, mail, scadenze…) e ti avvisa solo se c'è qualcosa; senza righe nell'elenco non parte e non costa niente") })),
    h("div", { class: "row" }, h("label", { text: t("Riordino della memoria") }), digest,
      h("span", { class: "hint note", text: t("ogni sera alle 22:30 l'agente rilegge il diario della chat e ti propone le cose da ricordare (salva solo quelle che approvi), legge i file messi in da-leggere della memoria e la domenica propone come sistemarla. Se non c'è niente da fare non parte") })),
    feedback);
}

// ── Abilità (skills.rs) ────────────────────────────────────────────────────────

let skillItems: Skill[] = [];
/** The skill being edited: its id, "" for a new one, null for none. */
let skillEditing: string | null = null;

function skillsSection(): HTMLElement {
  const list = h("div", { class: "tasks", id: "skills-list" });
  const add = h("button", { class: "primary", text: t("Nuova abilità") }) as HTMLButtonElement;
  add.addEventListener("click", () => {
    skillEditing = "";
    paintSkills();
  });
  const folder = h("button", { text: t("Apri la cartella") }) as HTMLButtonElement;
  folder.addEventListener("click", () => void Bridge.skillsOpen());
  void refreshSkills();
  return h("section", {},
    h("h2", {}, h("span", { text: t("Abilità") })),
    h("span", { class: "hint", text: t("Procedure scritte una volta, che la chat e i compiti seguono quando servono: per esempio «resoconto mensile di un cliente» o «controllo dei backup». Ognuna è un file .md che puoi modificare, ha un motore preferito se vuoi, ed è anche il comando /nome nella chat. Si creano anche dalla chat: «ricordati come si fa…».") }),
    h("div", { class: "row" }, add, folder),
    list);
}

async function refreshSkills() {
  skillItems = (await Bridge.skillsList()) ?? [];
  paintSkills();
}

function paintSkills() {
  const list = document.getElementById("skills-list");
  if (!list) return;
  clear(list);
  if (skillEditing === "") list.append(skillEditor(null));
  if (!skillItems.length && skillEditing !== "") list.append(h("span", { class: "hint", text: t("Ancora nessuna abilità.") }));
  for (const s of skillItems) list.append(skillEditing === s.id ? skillEditor(s) : skillRow(s));
}

function skillRow(s: Skill): HTMLElement {
  const edit = h("button", { text: t("Modifica") }) as HTMLButtonElement;
  edit.addEventListener("click", () => {
    skillEditing = s.id;
    paintSkills();
  });
  const del = h("button", { class: "danger", text: t("Elimina") }) as HTMLButtonElement;
  del.addEventListener("click", async () => {
    if (!del.classList.contains("confirm")) {
      del.classList.add("confirm");
      del.textContent = t("Sicuro? Elimina");
      return;
    }
    try {
      await Bridge.skillDelete(s.id);
    } catch (e) {
      console.warn(e);
    }
    await refreshSkills();
  });
  const meta = [`/${s.id}`, s.engine ? t("motore: {e}", { e: engineName(s.engine) }) : "", s.tools.length ? s.tools.join(", ") : ""].filter(Boolean).join(" · ");
  return h("div", { class: "task", "data-item": `skill-${s.id}` },
    h("div", { class: "task-head" }, h("span", { class: "task-title", text: s.name })),
    h("div", { class: "task-body" },
      h("div", { class: "hint", text: s.description }),
      h("div", { class: "hint", text: meta }),
      h("div", { class: "row" }, edit, h("span", { class: "spacer" }), del)));
}

function skillEditor(s: Skill | null): HTMLElement {
  const name = h("input", { type: "text", value: s?.name ?? "", placeholder: t("Nome, es. Resoconto cliente"), style: "flex:1 1 220px" }) as HTMLInputElement;
  const description = h("input", { type: "text", value: s?.description ?? "", placeholder: t("Quando usarla, es. quando chiedo il resoconto mensile di un cliente"), style: "flex:1 1 320px" }) as HTMLInputElement;
  const engine = h("select", {}) as HTMLSelectElement;
  engine.append(h("option", { value: "", text: t("Qualsiasi motore") }));
  for (const e of CHAT_ENGINES) engine.append(h("option", { value: e.id, text: e.name }));
  engine.value = s?.engine ?? "";
  const tools = h("input", { type: "text", value: (s?.tools ?? []).join(", "), placeholder: t("strumenti, es. notion_query, list_status (facoltativi)"), style: "flex:1 1 260px" }) as HTMLInputElement;
  const body = h("textarea", { class: "mono", placeholder: t("Le istruzioni, passo per passo. Es.:\n1. Cerca in Zammad i ticket del cliente del mese scorso\n2. Somma le ore\n3. Scrivi la bozza del resoconto in Notion e dimmi dov'è") }) as HTMLTextAreaElement;
  body.value = s?.body ?? "";
  body.style.minHeight = "160px";
  const feedback = h("div", {});
  const save = h("button", { class: "primary", text: t("Salva") }) as HTMLButtonElement;
  save.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.skillSave({
        name: name.value, description: description.value, engine: engine.value,
        tools: tools.value.split(",").map((x) => x.trim()).filter(Boolean), body: body.value,
      }, s?.id ?? "");
      skillEditing = null;
      await refreshSkills();
    } catch (e) {
      feedback.append(h("div", { class: "notice err", text: String(e).replace(/^Error:\s*/, "") }));
    }
  });
  const cancel = h("button", { text: t("Annulla") }) as HTMLButtonElement;
  cancel.addEventListener("click", () => {
    skillEditing = null;
    paintSkills();
  });
  return h("div", { class: "task qa-edit" },
    h("div", { class: "row" }, name),
    h("div", { class: "row" }, description),
    h("div", { class: "row" }, h("label", { text: t("Motore preferito") }), engine, tools),
    body, feedback,
    h("div", { class: "row" }, save, cancel));
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
      const { settings: next, note } = await Bridge.settingsImport(await f.text());
      settings = { ...settings, ...next };
      render();
      // render() replaced this section; report in the new one.
      document.getElementById("backup-feedback")?.append(h("div", {
        class: "notice ok",
        text: note,
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
      text: t("Esporta in un file JSON nella cartella Documenti le impostazioni (profili compresi), la memoria della chat, le abilità, i compiti, le integrazioni personali, la cronologia delle chat e le abitudini; importalo su un altro PC per ritrovare tutto. Importando, quello che c'era viene messo da parte, non cancellato. Le chiavi API restano in Gestione credenziali e non vengono esportate."),
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
  // Preview: ?ui=classic shows the original look.
  if (!info && new URLSearchParams(location.search).get("ui") === "classic") settings.theme = { ...settings.theme, style: "classic" };
  applyUiStyle(settings.theme.style);
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, legacy: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = INTEGRATIONS.flatMap((d) => d.fields.map((f) => f.key));
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  boot = { status, hasKey, present };
  render();

  // Compiti: the list follows the tasks while they work (tasks.rs).
  void onEvent<AgentTaskItem[]>("tasks-changed", (list) => {
    taskItems = list;
    paintTasks();
  });

  // The island's context menu: "Impostazioni «Zammad»" lands on its row, open.
  // Every opening starts on the first page (Generale), not the last one seen
  // (Edoardo, 24 Oct 2026) — unless it was opened on a given page (settings-goto).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Date.now() - gotoAt < 3000) return;
    try { localStorage.removeItem(PAGE_KEY); } catch { /* no storage */ }
    render();
  });

  void onEvent<{ page: string; item: string }>("settings-goto", ({ page, item }) => {
    gotoAt = Date.now();
    try {
      localStorage.setItem(PAGE_KEY, page);
    } catch {
      // Not remembered: render() below still shows it.
    }
    if (page === "integrazioni" && item) {
      openIntegration = item;
      integrationQuery = "";
      onlyActive = false;
    }
    render();
    if (!item) return;
    requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>(`[data-item="${CSS.escape(item)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("goto");
      window.setTimeout(() => el.classList.remove("goto"), 1600);
    });
  });

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
    applyUiStyle(settings.theme.style);
    // The echo of a save made here (Rust may tidy a value) is taken without
    // redrawing: a redraw closed the open integration and the page jumped up.
    if (redraw && Date.now() - savedAt > 2000) render();
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
      sections: () => [notifySection(), momentsSection(), reactionsSection(), presenceSection(), scriptsSection(b.status.hookPath)],
    },
    {
      id: "chat", label: t("Chat e motori AI"), icon: "chat", color: "#A78BFA", title: t("Chat dell'isola e motori AI"),
      intro: t("Il motore che risponde quando scrivi nell'isola o al bot di Telegram, cosa può fare sul PC, la cartella di lavoro e le conversazioni salvate."),
      sections: () => [claudeChatSection(b.hasKey)],
    },
    {
      id: "claude", label: t("Agenti di codice"), icon: "terminal", color: "#E07A5F", title: t("Agenti di codice nel terminale"),
      intro: t("Claude Code, Codex, opencode e gli altri agenti che lavori da terminale o editor: collegarli all'isola per vederne sessioni e permessi, i riepiloghi del loro lavoro e gli strumenti di EasyIsland che possono usare."),
      sections: () => [agentsSection(b.status), agentsTabSection(), recapSection(), dailySection(), mcpSection()],
    },
    {
      id: "azioni", label: t("Azioni rapide"), icon: "bolt", color: "#FACC15", title: t("Azioni rapide"),
      intro: t("Pulsanti della scheda ⚡ e scorciatoie da tastiera."),
      sections: () => [actionsSection()],
    },
    {
      id: "compiti", label: t("Compiti"), icon: "check", color: "#0EA5E9", title: t("Compiti"),
      intro: t("Obiettivi che EasyIsland porta avanti da solo: fa un piano, lo segue con gli strumenti della chat, ti chiede quando serve e ti dice com'è andata."),
      sections: () => [tasksSection(), heartbeatSection(), skillsSection(), tasksSettingsSection()],
    },
    {
      id: "automazioni", label: t("Automazioni"), icon: "rocket", color: "#22D3EE", title: t("Automazioni"),
      intro: t("Quando succede qualcosa (un orario, l'avvio, una rete, un programma, una chiavetta, un file, un avviso), EasyIsland fa qualcosa per te."),
      sections: () => [automationsSection()],
    },
    {
      id: "integrazioni", label: t("Integrazioni"), icon: "network", color: "#38BDF8", title: t("Integrazioni"),
      intro: t("Servizi e programmi, uno per tipo: GitHub, Vercel, n8n, Stripe, Zammad, Outlook, stato del PC, sicurezza, rete, meteo…"),
      sections: () => [integrationsSection(b.present), customsSection()],
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
/** When the island last opened the window on a given page (settings-goto). */
let gotoAt = 0;

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
  const same = scroller?.getAttribute("data-page") === page.id;
  const scrollTop = same ? scroller!.scrollTop : 0;
  const oldHeight = same ? scroller!.scrollHeight : 0;
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
  // The homepage and its guide on GitHub Pages (site/).
  const link = (text: string, url: string) => {
    const a = h("a", { class: "nav-link", href: url, text });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void Bridge.openUrl(url);
    });
    return a;
  };
  nav.append(h("div", { class: "nav-foot" },
    h("div", { class: "nav-links" },
      link(t("Guida"), language() === "en" ? `${HOMEPAGE}en/guide/` : `${HOMEPAGE}guida/`),
      link(t("Sito"), language() === "en" ? `${HOMEPAGE}en/` : HOMEPAGE),
      link("GitHub", "https://github.com/EdoardoDevelop/easyisland")),
    h("div", { text: t("Nessuna telemetria. Le richieste di rete vanno solo ai servizi che configuri tu.") })));

  const body = h("div", { class: "page-inner" },
    h("header", { class: "page-head" }, h("h1", { text: page.title }), h("div", { class: "hint", text: page.intro })),
    ...page.sections(),
  );
  const main = h("main", { class: "page", "data-page": page.id }, body);
  root.append(nav, main);
  // A redraw stays where it was; parts filled in a moment later (keys, lists)
  // must not let it fall back to the top meanwhile.
  if (oldHeight) body.style.minHeight = `${oldHeight}px`;
  main.scrollTop = scrollTop;
  holdScroll(main, body);
}

/**
 * A list redrawn in place (an action's type, a switch, Aggiungi, Elimina) left
 * the page shorter for a moment and the scroll fell back up (Edoardo, 24 Oct
 * 2026): while parts change, the page keeps at least the height that was in view.
 */
function holdScroll(main: HTMLElement, body: HTMLElement) {
  // The position before the change: reading scrollTop after it may already be the fallen one.
  let top = main.scrollTop;
  main.addEventListener("scroll", () => { top = main.scrollTop; }, { passive: true });
  let release = 0;
  const later = () => {
    window.clearTimeout(release);
    release = window.setTimeout(() => {
      const at = main.scrollTop;
      body.style.minHeight = "";
      main.scrollTop = at;
    }, 2000);
  };
  if (body.style.minHeight) later();
  new MutationObserver(() => {
    const need = top + main.clientHeight;
    body.style.minHeight = `${Math.max(need, parseFloat(body.style.minHeight) || 0)}px`;
    main.scrollTop = top;
    later();
  }).observe(body, { childList: true, subtree: true });
}

void main();
