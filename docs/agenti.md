# Agenti di programmazione e hook

## Relay (`hook/`)
- `easyisland-hook.exe` riceve gli hook di Claude Code e li passa all'app sulla named pipe (accessibile solo all'utente che ha avviato l'app). Se l'app non risponde entro il timeout, esce con 0. `DECISION_TIMEOUT` = 108 s in `pipe.rs`: non accorciarlo.
- `easyisland-hook notify …` manda un messaggio all'isola da qualsiasi script.
- Il relay accorcia ogni stringa a 2.000 caratteri e scarta `tool_response` e `transcript_path`. Ciò che serve intero va calcolato lì, prima del taglio:
  - `hook/src/diff.rs`: diff delle modifiche (`easyisland_diff`) e ultimo messaggio (`easyisland_last_message`). La vista è `src/views/diff.ts`.
  - `hook/src/testrun.rs`: esito dei test letto dall'output (`easyisland_tests`).
- Piano dell'agente (TodoWrite, TaskCreate/TaskUpdate, `update_plan`, `write_todos`): `src/island/plan.ts`. Avvisi di rischio sulla card dei permessi: `src/island/risk.ts`.

## Altri agenti
- `easyisland-hook <Evento> --agent codex|gemini|cursor|copilot|opencode` (`hook/src/agents.rs`) traduce i loro eventi nella forma di Claude Code e aggiunge `easyisland_agent`.
- Installazione degli hook: `src-tauri/src/hooks.rs` → `Target`, sempre con backup, diff e conferma. File di ciascun agente:
  - Claude Code: `%USERPROFILE%\.claude\settings.json`
  - Codex: `~/.codex/hooks.json`
  - Gemini: `~/.gemini/settings.json`
  - Cursor: `~/.cursor/hooks.json`
  - Copilot CLI: `~/.copilot/hooks/easyisland.json`
- **Cursor e Copilot solo in osservazione:** mai `preToolUse` o altri hook di permesso, perché lì una risposta illeggibile o un errore bloccano lo strumento. I loro eventi arrivano dopo l'esecuzione con `easyisland_after_only`.

## opencode
- **opencode 2** (i suoi plugin non vedono più eventi né strumenti): `src-tauri/src/opencode_agent.rs` segue il servizio in background. Ricava l'indirizzo da `opencode service status` e la password da `~/.config/opencode/service.json`, che resta solo in memoria. Interruttore `opencodeWatch`, spento di serie.
  - Traduce `/api/event` negli eventi di Claude Code e riusa `hook/src/diff.rs`, `testrun.rs` e `agents.rs` con `#[path]`. Accorcia le stringhe a 2.000 caratteri come il relay.
  - I permessi passano da `pipe::request_decision_as`. La risposta va a `/api/session/{id}/permission/{rid}/reply`. Su `permission.replied` l'attesa si libera con `pipe::decline`.
  - Le domande (strumento `question`, e ogni altro form) arrivano come `form.created`: in opencode 2 lo strumento apre un form con un campo per domanda (`q0`, `q1`…, `string` o `multiselect` con le opzioni). Se tutti i campi sono scelte o testo diventano la card «ask» di AskUserQuestion. La risposta (etichette → `value`) va a `/api/session/{id}/form/{fid}/reply` con `{answer: {q0: …}}`. `form.replied` e `form.cancelled` chiudono la card. Gli altri form (numeri, accesso esterno, campi con `when`) dicono solo che opencode aspetta. Gli eventi dei form non sono nell'OpenAPI (`/openapi.json`): forma ricavata dall'eseguibile di opencode 2.0.24.
  - Uno strumento fallito (`PostToolUseFailure`, anche di Claude Code) mostra lo step e la prima riga di `error`: «⚠ Domanda · Invalid arguments…». Spesso è il modello che sbaglia gli argomenti e riprova da solo.
  - A ogni collegamento legge `/api/session` per la cartella delle sessioni aperte prima (senza, il progetto si chiamerebbe «Session»).
  - Ogni evento ha `easyisland_host: "opencode"`. `easyisland.log` scrive ogni evento (`opencode SessionStart`…).
  - Sul PC di Edoardo opencode Desktop avvia un suo servizio (`ai.opencode.desktop\cli.0.24\opencode-cli.exe`) e il CLI npm un altro (`serve --service`). Entrambi usano la porta 49374 con la stessa password. L'osservatore si ricollega da solo.
  - Riproduzione di uno stream registrato: test `opencode_agent::tests::replay` con `OPENCODE_EVENTS=<file>`.
- **opencode 1.x** non ha hook a comando. `Target::OpenCode` scrive un plugin tutto suo, `~/.config/opencode/plugins/easyisland.js`. La sorgente è `src-tauri/src/opencode-plugin.js`, con il percorso del relay al posto di `__HOOK__`. Il plugin lancia `easyisland-hook <evento> --agent opencode` senza mai aspettare. Per `permission.asked` aspetta l'isola in parallelo e risponde al server (`once`/`always`/`reject`). Un file con lo stesso nome che non è di EasyIsland non viene toccato.

## Nell'isola
- Le sessioni diventano `AgentTask` (`src/island/hooks.ts`, `taskFor`). Ogni agente ha la sua chiave `agent:<id>`.
- **Scheda Agenti:** gli agenti non sono pillole, ma stanno nella scheda Agenti e nella Panoramica. `AgentTask.lastActive` viene aggiornato a ogni evento. `State.sessionTasks` / `latestSessionTask` danno l'agente sentito per ultimo, che è quello aperto dal clic. Con più agenti compare una barra di pulsanti (`.agent-switch`, `.agent-chip`, con un puntino verde se l'agente lavora; Claude Code per primo). Un agente senza sessione mostra «In attesa» (`agentIdleCard`). L'aspetto della scheda si regola in Impostazioni → Agenti → «Scheda nell'isola».
- **Fine della risposta (`Stop`):** se in primo piano c'è l'app della sessione (`HOST_APPS` in `hooks.ts`: Claude, VS Code, terminale, opencode) niente suono né card. In ogni altro programma l'isola si apre sulla sessione con la card «finito», qualunque scheda stesse mostrando. Sopra un'app a schermo intero o con «Avvisi: solo permessi» resta solo il segno sulla pillola.
- **«Apri»:** `apps::open_session` per `SessionHost`. Per opencode prova Desktop, poi il terminale, poi avvia Desktop (`%LOCALAPPDATA%\Programs\@opencodedesktop\OpenCode.exe`), poi la cartella. Mai VS Code.
- Gli hook di Claude Code vanno reinstallati per ricevere `PreCompact`. Le Impostazioni lo segnalano.
