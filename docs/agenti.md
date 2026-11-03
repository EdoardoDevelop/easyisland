# Agenti di programmazione e hook

## Relay (`hook/`)
- `easyisland-hook.exe` passa gli hook all'app sulla named pipe (solo per l'utente dell'app); senza risposta entro il timeout esce con 0. `DECISION_TIMEOUT` = 108 s in `pipe.rs`: non accorciarlo.
- **Copia in `%LOCALAPPDATA%\EasyIsland\bin`** a ogni avvio (`hooks::ensure_hook_exe`). Se è in uso (server MCP `easyisland-hook mcp` accesi per ore) viene rinominata `easyisland-hook.old-<pid>.exe` e cancellata all'avvio dopo (prima la copia falliva in silenzio e la chat usava un relay vecchio).
- `easyisland-hook notify …`: messaggio all'isola da qualsiasi script.
- `easyisland-hook type <pid>` (`hook/src/console.rs`): scrive stdin nella console di `<pid>` e preme Invio («Continua»). Processo a parte e nascosto, perché collegarsi a un'altra console vale per tutto il processo. Testo su una riga; Invio dopo 250 ms (sennò Claude Code lo prende come incolla).
- **«Sempre»** (`decision_json`, `always_rules`, `session_rule` in `hook/src/main.rs`): prima la regola proposta da Claude Code (`permission_suggestions`, mai in `~/.claude/settings.json`); altrimenti, solo Claude Code, regola **di sessione** su comando esatto (una riga), dominio di `WebFetch`, tutte le modifiche (`acceptEdits`) o strumento per nome. Niente «Sempre» per domande, piani, comandi su più righe. Testi in `alwaysLabel`, `sessionAlways` (`hooks.ts`).
- **Comando degli hook** (`hooks.rs`, `shell_safe_exe`): percorso con `/` senza virgolette, poi l'evento; valido in Git Bash, PowerShell e cmd (la forma con virgolette era un errore di sintassi in PowerShell, usato da Claude Code senza Git Bash). Con spazi si usa il nome breve 8.3, se manca le virgolette. Hook nella forma vecchia = «da aggiornare» (`commands_changed`), con diff e conferma.
- `easyisland-hook statusline` (`hook/src/statusline.rs`): `statusLine` di Claude Code installata con gli hook; passa all'app solo `rate_limits` e la sessione (evento `StatusLine`, non loggato), poi esegue con Git Bash la status line precedente (salvata in `%LOCALAPPDATA%\EasyIsland\bin\statusline-previous.json`, rimessa disinstallando). L'app desktop di Claude non la esegue. Hook installati prima della 0.6.3: «Da aggiornare».
- Il relay taglia ogni stringa a 2.000 caratteri e scarta `tool_response` e `transcript_path`; ciò che serve intero si calcola prima: `hook/src/diff.rs` (`easyisland_diff`, `easyisland_last_message`; vista `src/views/diff.ts`), `hook/src/testrun.rs` (`easyisland_tests`).
- Piano dell'agente (TodoWrite, TaskCreate/TaskUpdate, `update_plan`, `write_todos`): `src/island/plan.ts`. Avvisi di rischio: `src/island/risk.ts`.

## Altri agenti
- `easyisland-hook <Evento> --agent codex|gemini|cursor|copilot|opencode|antigravity` (`hook/src/agents.rs`) traduce nella forma di Claude Code con `easyisland_agent`.
- Installazione: `hooks.rs` → `Target`, con backup, diff, conferma. File: Claude Code `%USERPROFILE%\.claude\settings.json`; Codex `~/.codex/hooks.json`; Gemini `~/.gemini/settings.json`; Cursor `~/.cursor/hooks.json`; Copilot CLI `~/.copilot/hooks/easyisland.json`; Antigravity `~/.gemini/config/hooks.json` (gruppo `easyisland`).
- **Cursor e Copilot solo in osservazione:** mai hook di permesso (un errore bloccherebbe lo strumento); eventi dopo l'esecuzione con `easyisland_after_only`.

## opencode
- **opencode 2** (plugin senza eventi né strumenti): `opencode_agent.rs` segue il servizio. Indirizzo da `opencode service status`, password da `~/.config/opencode/service.json` (solo in memoria). Interruttore `opencodeWatch`, spento di serie.
  - Traduce `/api/event` negli eventi di Claude Code riusando `diff.rs`, `testrun.rs`, `agents.rs` con `#[path]`; taglia a 2.000 caratteri.
  - Permessi via `pipe::request_decision_as`, risposta a `/api/session/{id}/permission/{rid}/reply`; `permission.replied` → `pipe::decline`.
  - Domande (`question` e altri form) come `form.created`: campi `q0`, `q1`… (`string`/`multiselect`) → card «ask»; risposta a `/api/session/{id}/form/{fid}/reply` con `{answer: {q0: …}}`; `form.replied`/`form.cancelled` chiudono. Altri form (numeri, accesso esterno, campi con `when`) dicono solo che opencode aspetta. Gli eventi dei form non sono nell'OpenAPI: forma ricavata da opencode 2.0.24.
  - `PostToolUseFailure` (anche Claude Code): step e prima riga di `error` («⚠ Domanda · Invalid arguments…»).
  - A ogni collegamento legge `/api/session` per le cartelle (sennò il progetto si chiama «Session»). Eventi con `easyisland_host: "opencode"`, tutti nel log.
  - opencode Desktop e il CLI npm (`serve --service`) avviano due servizi sulla porta 49374 con la stessa password; l'osservatore si ricollega da solo.
  - Replay: test `opencode_agent::tests::replay` con `OPENCODE_EVENTS=<file>`.
- **opencode 1.x:** plugin `~/.config/opencode/plugins/easyisland.js` da `src-tauri/src/opencode-plugin.js` (`__HOOK__` = percorso del relay). Lancia il relay senza aspettare; per `permission.asked` aspetta l'isola e risponde `once`/`always`/`reject`. Un file omonimo non nostro non si tocca.

## Nell'isola
- Sessioni → `AgentTask` (`src/island/hooks.ts`, `taskFor`), chiave `agent:<id>`.
- `State.homeAgentId`: Claude Code se `hooksInstalled`, sennò `agent:opencode` se `opencodeWatch`, sennò nessuno (scheda Agenti nascosta finché non arriva una sessione). Un evento di Claude Code senza hook registrati crea comunque il task (`ensureClaudeTask`, via a `SessionEnd`): un permesso ha sempre la card. `hooksInstalled` viene da `hooks::status()` in `boot` e da `hooks_apply`; `save_settings` tiene quello attuale.
- **Menu:** voce Agenti (`rail.ts`, con il numero al lavoro) e riquadri della Panoramica. `State.sessionTasks`/`latestSessionTask` = agente sentito per ultimo (aperto dal clic; `lastActive`). Con più agenti barra `.agent-switch`/`.agent-chip` (puntino verde se lavora; Claude Code primo). Senza sessione «In attesa» (`agentIdleCard`). Icona in Impostazioni → Agenti → «Nel menu dell'isola».
- **Ritorno al colore:** dopo `Stop` «finito», dopo 5 s riposo. Senza `Stop` (Esc, agenti che non lo mandano): con `idle_prompt` di Claude Code o dopo 5 min senza eventi (`armStale`); un permesso in attesa tiene il colore.
- **`Stop`:** se in primo piano c'è l'app della sessione (`HOST_APPS`: Claude, VS Code, terminale, opencode) niente suono né card; altrimenti l'isola si apre con la card «finito». Con app a schermo intero o «Avvisi: solo permessi» solo il pallino.
- **Permesso dalla striscia** con «Risposte rapide» e isola chiusa: Nega/Consenti accanto al personaggio (`src/views/strip.ts`); domande, piani e richieste con rischio aprono la card.
- **Card del permesso ripiegabile:** «Più tardi»/Esc (`foldCard`) senza rispondere; la richiesta aspetta fino a 108 s e torna riaprendo (`defaultView` → `pendingCard`). Tempo rimasto («attende ancora 1:32», `deadline` in `ApprovalInfo`, `waitLeft`), ambra negli ultimi 20 s.
- **Card «finito»:** ultimo messaggio in markdown (`renderMarkdown`). **«Continua»** (`session_reply.rs`, `replyMode`): nei terminali con `easyisland-hook type`; nell'estensione VS Code/Cursor (`entrypoint` `claude-vscode`) link `vscode://anthropic.claude-code/open?session=…&prompt=…` (Invio all'utente); opencode via `/api/session/{id}/prompt`. Niente campo per l'app Claude o a sessione chiusa. Mentre si scrive l'isola non si chiude.
- **«Chiedi a questa sessione»** (solo Claude Code con id e cartella): `State.chatSession` → `session_ask` in `claude_cli.rs`: `claude -p --resume <id> --fork-session` nella cartella, solo Read/Glob/Grep, `dontAsk`, hook spenti; la sessione vera non si tocca, le domande dopo continuano nella copia.
- **«Apri»:** `apps::open_session` per `SessionHost`; opencode: Desktop, terminale, avvio di Desktop (`%LOCALAPPDATA%\Programs\@opencodedesktop\OpenCode.exe`), cartella. Mai VS Code.

## Antigravity (18/10/2026)
- Doc ufficiale: antigravity.google/docs/hooks e /docs/cli/headless. Non provato con agy vero (`docs/prove-dal-vivo.md`).
- Hook in `~/.gemini/config/hooks.json` (condiviso da CLI `agy`, IDE, app), gruppo `"easyisland"` (`antigravity_merged`, `antigravity_status`, `without_ours_for`); gli altri gruppi restano.
- Eventi SessionStart, PreToolUse (timeout 115 s), PostToolUse, Stop. Payload camelCase senza nome dell'evento (arriva dalla riga di comando). `antigravity()` in `agents.rs`: `conversationId` → `session_id`, `workspacePaths[0]` → `cwd`, `toolCall` → nomi di Claude Code (`run_command` → Bash, `write_to_file` → Write, `replace_file_content` → Edit, `view_file` → Read, `call_mcp_tool` → `mcp__server__tool`…). Argomenti (`CommandLine`, `TargetFile`, `AbsolutePath`…) dalla documentazione.
- Permessi: `run_command`, `call_mcp_tool`, `ask_permission` → PermissionRequest. Il relay risponde sempre (`antigravity_output`): Consenti/Sempre → `auto_approve`, Nega → `deny`, nessuna risposta → `allow` (decide Antigravity). Le modifiche ai file le rivede Antigravity.
- Strumenti di sola lettura di EasyIsland (`hook/src/mcp.rs`, tranne `show_card`) → `auto_approve` (`mcp::allowed_without_asking`), come `AGENT_READ_ONLY` per Claude Code e opencode.

## Riepilogo settimanale
- `recap.rs` vede gli eventi (`pipe.rs`, `opencode_agent.rs`) e chiude un turno da richiesta a `Stop`. Solo numeri, id dell'agente, nome della cartella: righe da `easyisland_diff(s)`, comandi da `tool_name`, permessi da `pipe::answer`. `recap.json` in `%LOCALAPPDATA%\EasyIsland`, 12 settimane. La chat non conta.
- `src/island/recap.ts` somma la settimana e apre la card (`src/views/recap.ts`) il lunedì dalle 8, una volta, se l'isola è libera; anche da area di notifica e Impostazioni → Agenti (`tray` = `recap`). `weeklyRecap`.

## Riepilogo del giorno
- Card del mattino (8–13, agenti di ieri) e di fine giornata (da `eveningHour`, 18 di serie), una volta al giorno, solo se c'è qualcosa e l'isola è libera: repository con modifiche o commit da inviare, PR da rivedere e proprie aperte. Si apre all'avvio, al primo agente al lavoro, all'ora (`daily-due` da `giornata.rs`), da area di notifica e Impostazioni → Agenti → «Mostra ora». `dailyRecap` (`both`, `morning`, `evening`, `off`).
- **`giornata.rs`** (31/10): orari in Rust (un sonno fino alla prossima ora, max 30 min, e controllo un minuto dopo l'avvio), così valgono a isola chiusa e su Telegram; una volta al giorno (`giornata.json`). Con `dailyAi` ("" / `memory` / `chat` / id motore) un turno `Channel::Helper` con la domanda di `/oggi` o `/domani` (`telegram::day_prompt`), testo per la card (`daily_ai_text`, evento `daily-ai`; a mano `daily_ai_write`). Con `dailyTelegram` testo e tempo agenti (`agents_line`) alla chat collegata. Niente nuovi tentativi automatici: la card dice perché, con «Riprova». Spento di serie (costa un turno con strumenti).
- `src/island/daily.ts` somma dai turni di `recap.rs`; date dell'ultima apertura in `recap.json` (`lastShownMorning`, `lastShownEvening`, `recap_mark_day`), segnate anche senza niente da dire (git non interrogato a ogni avvio). `recap.rs` registra se uno dei due riepiloghi è acceso.
- `daily.rs`: repository = radici git delle cartelle degli agenti (`note` da `recap::observe`, cache in memoria), in `repos.json` (max 40 percorsi, dimenticati dopo 30 giorni, aggiornati max ogni ora). `git status --porcelain --branch` in parallelo (8 s, senza finestra). PR con `gh search prs` (`--review-requested=@me`, `--author=@me`), altrimenti token GitHub (`search/issues`), sennò una riga lo dice. Vista `src/views/daily.ts`.

## Server MCP in Claude Code
- `easyisland-hook mcp` (`hook/src/mcp.rs`) si aggiunge a Claude Code per tutti i progetti da Impostazioni → Agenti → «Strumenti di EasyIsland in Claude Code» (`mcp_setup.rs`): dopo «Conferma» copia datata `.claude.json.bak-<data>` e `claude mcp add --scope user easyisland -- <easyisland-hook.exe> mcp` (o `remove`). EasyIsland non scrive `~/.claude.json`, lo legge; un percorso vecchio si sostituisce.
- `show_card`: titolo, testo, livello, max 3 pulsanti; aspetta 5–300 s e restituisce l'etichetta, «chiusa», «non mostrata» (regole delle notifiche) o «nessuna risposta» (`moments::ask_card`, `moment_card_answer`); con pulsanti l'isola resta aperta. Non c'è nella chat dell'isola (`EASYISLAND_INTERNAL`). `add_to_tray`: copia nel Vassoio fino a 2 GB. `list_uploaded_files` descrive il Vassoio.
- I permessi restano quelli di Claude Code.
