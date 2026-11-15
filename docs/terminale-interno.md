# Modalità terminale interna per il «Modello sul PC» — istruzioni per Antigravity

Documento di lavoro scritto il 15/11/2026 per l'agente che fa questa modifica (Antigravity). A lavoro finito il contenuto si riassume in `docs/chat.md` e questo file si cancella. **Leggilo tutto prima di cominciare.**

## 1. Cosa chiede Edoardo
Il motore della chat **«Modello sul PC»** (`local`, `src-tauri/src/local_model.rs`: llama.cpp dentro EasyIsland, sulla scheda grafica) oggi, con la **Modalità terminale** accesa, passa da **opencode** (`opencode::via_local` + `local_model::opencode_endpoint`). opencode mette davanti a ogni conversazione circa **11.000 token** di istruzioni e strumenti: sulla RTX 3070 la prima domanda prende 13 s, sulla Radeon 840M del portatile 85 s.

Edoardo vuole una **Modalità terminale interna**: EasyIsland stessa dà al modello pochi strumenti (comandi, file, gli strumenti di EasyIsland), li esegue lei dopo il permesso nell'isola, **senza opencode**. Obiettivo: istruzioni + strumenti sotto **2.500 token**.

Solo per il motore `local`. Gli altri motori (OpenAI, Gemini, OpenRouter, Ollama, LM Studio, chiave API di Claude) **restano su opencode come oggi**. Il motore «opencode» resta com'è.

## 2. Dove si lavora
- Repository `C:\Users\Edoardo\WORK\EasyIsland_0.2.0`, ramo **`claude/llm-interno`** (nato da `claude/sviluppo` dopo la 1.0.48). Mai lavorare su `main` o `claude/sviluppo`, mai unire, mai `git push` se Edoardo non lo chiede.
- Leggi prima: `CLAUDE.md` (regole del progetto, obbligatorie), `HANDOFF.md` (voce «Modello sul PC»), `docs/chat.md` → «Motori» → «Modello sul PC» e → «Modalità terminale».
- Commit in **italiano**, frasi brevi, cosa e perché.

## 3. Regole del progetto da rispettare (da `CLAUDE.md`, le più importanti qui)
1. **Lingua:** testi per l'utente in italiano, sempre con `t("…")` / `tf("… {nome} …", &[("nome", &x)])` (Rust `crate::i18n`) e `t()` nel TypeScript; per ogni testo nuovo la traduzione in `src/i18n/en.json` con **chiave = testo italiano esatto**. `npm run check:i18n` deve dire «0 senza inglese». Identificatori e commenti nel codice in **inglese**.
2. **Robustezza Rust:** mai `[a..b]` né indici su dati esterni (output di comandi, file, JSON del modello): usa `.get(..)`. Mai `unwrap()` su dati esterni. Un panic in release chiude l'app.
3. **Nessuna nuova dipendenza** in `Cargo.toml` o `package.json`. Ci sono già `tokio` (process, time), `serde_json`, `reqwest`, `windows`. Niente `regex`, `glob`, `walkdir`: la ricerca nei file si fa a mano (sottostringa, senza maiuscole).
4. **Mai bloccare né eseguire senza clic:** nessun comando e nessuna modifica di file senza la card Consenti/Nega, tranne i casi della tabella al punto 6.
5. **Segreti:** mai leggere senza chiedere i posti delle chiavi (`opencode::secret_place`), mai scrivere chiavi su disco.
6. **Isola ritirata = CPU ~0 %:** nessun timer o ciclo nuovo a riposo.
7. **Processi:** su Windows sempre `creation_flags(0x0800_0000)` (CREATE_NO_WINDOW) e `kill_on_drop(true)`.
8. **File:** molti file del repo hanno fine riga **CRLF**: mantieni quella che hanno. Non riformattare file interi.
9. **Documentazione** a fine lavoro (punto 10).

### Regola da cambiare (decisa da Edoardo il 15/11/2026)
In `CLAUDE.md`, sezione «Regole», punto «Comandi e modifiche ai file solo dalla «Modalità terminale» (strumenti di Claude Code/opencode, Consenti/Nega nell'isola)», aggiungi: «e dalla Modalità terminale interna del Modello sul PC (`local_agent.rs`, 15/11/2026: comandi e file eseguiti da EasyIsland dopo Consenti/Nega)». Non togliere né cambiare nient'altro di quella sezione. La frase «Gli strumenti di `agent.rs` non eseguono comandi arbitrari…» resta vera: il nuovo codice sta in un modulo nuovo, non in `agent.rs`.

## 4. Cosa c'è già (riusalo, non riscriverlo)
| Cosa | Dove |
|---|---|
| Server del modello, avvio, chiave, contesto | `local_model::ensure(model, min_context) -> Lease { base, key, context }`; `TERMINAL_CONTEXT` = 16.384; tieni la `Lease` viva per tutto il turno |
| Chiamata non in streaming con tempi | `local_model::complete` (privata: copiala o rendila `pub(crate)`) |
| Giro modello → strumento → risultato, con permessi | `claude.rs`: `run_tool`, `allowed`, `drop_unfinished` (per l'API Anthropic: stesso schema, formato diverso) |
| Card Consenti/Nega nell'isola | `crate::pipe::request_decision(app, payload).await -> Option<String>` (`"allow"`, `"always"`, `"deny"`, `None` = scaduto = no); da Telegram `crate::telegram::request_decision` |
| Forma del payload | come `opencode::permission_payload`: `hook_event_name: "PermissionRequest"`, `easyisland_chat: true`, `easyisland_engine: "local"`, `tool_name`, `tool_input` |
| Comandi delicati, comandi che guardano soltanto | `opencode::delicate(cmd)`, `opencode::read_only(cmd)` |
| Posti delle chiavi | `opencode::secret_place(path)` (`pub(crate)`) |
| Strumenti di EasyIsland | schema: `claude::tool_list::tools()` → `(name, description, schema, _)`; esecuzione: `crate::agent::call(app, name, &args).await` → `{ text, ok }`; senza permesso: `crate::claude_cli::agent_read_only()` |
| Quali strumenti di EasyIsland servono alla domanda | `toolhint::tools_for(question)` (oggi privata: rendila `pub(crate)`) |
| Riga del passo sotto la risposta | `opencode::step_line(tool, input)` → «> ⚙ Esegue · `…`» |
| «⟲ File» (punti di ripristino) | `crate::checkpoints::touching(chat_ptr, path)` **prima** di ogni scrittura (vedi `claude_cli.rs` riga ~707); `checkpoints::begin` lo fa già `chat_turn` per la Modalità terminale |
| Pannello «Modifiche» / Anteprima | `crate::preview::touched_by(tool, input)` prima di scrivere, con `tool` = `"Edit"` o `"Write"` e `input` con `file_path` |
| Ferma | `chat_turn` avvolge il turno in `until_stopped_in`: il future viene lasciato cadere, quindi i processi figli devono avere `kill_on_drop(true)` |
| Consumo | `crate::engine_usage::record(...)`, `chat.set_usage(Some(claude::TurnUsage{…}))` come fa `claude.rs` |
| Modalità della conversazione | `chat.mode()` (`None`/`""` = chiede, `"acceptEdits"`, `"plan"`), `auto` (Automatica), `chat.read_only()` |

## 5. Cosa costruire

### 5.1 Modulo nuovo `src-tauri/src/local_agent.rs`
Commento in testa (inglese) che spiega: perché esiste (Edoardo, 15/11/2026, niente opencode per il Modello sul PC, istruzioni corte), cosa fa, i limiti.

Funzione pubblica:
```rust
pub async fn send(
    app: &AppHandle,
    chat: &Chat,
    model: &str,            // engine_models["local"]
    folder: &Path,          // la cartella della Modalità terminale
    query: String,
    context: Option<ChatContext>,
    auto: bool,             // «Automatica»
    telegram: bool,         // i permessi vanno su Telegram
    on_text: &(dyn Fn(&str) + Sync),
) -> Result<ChatReply, String>
```

Giro (massimo **25 passi**):
1. `let lease = crate::local_model::ensure(model, TERMINAL_CONTEXT).await?;` tenuta fino alla fine.
2. Messaggi in formato OpenAI: `system` (istruzioni corte, punto 5.3), la storia della conversazione (`chat.snapshot()`, come `openai.rs`), il messaggio dell'utente con `openai::user_message(first, &query, context.as_ref())` (oggi privata: rendila `pub(crate)`; `first` = la conversazione è vuota).
3. `POST {lease.base}/chat/completions` con `bearer_auth(lease.key)`, `model: "easyisland"`, `messages`, `tools` (punto 5.2), `tool_choice: "auto"`, `stream: false`, `temperature: 0.3`, `max_tokens: 2048`; timeout 240 s per richiesta.
4. Risposta: `choices[0].message`. Se ha `tool_calls` (array di `{ id, type: "function", function: { name, arguments } }`, dove `arguments` è **una stringa JSON**): per ognuno esegui lo strumento (5.2) e aggiungi
   - il messaggio `assistant` con `tool_calls` così come è arrivato,
   - un messaggio `{ role: "tool", tool_call_id, content }` per ogni chiamata.
   Poi torna al punto 3. Se `arguments` non è JSON valido: risultato «Argomenti non validi: JSON atteso.», senza eseguire.
5. Senza `tool_calls`: `content` (togli `<think>…</think>` come `local_model::without_thinking`) è la risposta finale. Salva in `chat` **solo** il messaggio dell'utente e la risposta finale (come `openai.rs`): i passi intermedi non restano nella storia, così il contesto non esplode tra un turno e l'altro.
6. Mentre lavora, `on_text` riceve il testo visibile: una riga `opencode::step_line(...)` per ogni strumento (usa i nomi opencode: `bash`, `read`, `edit`, `write`, `grep`, `glob`; per gli strumenti di EasyIsland `easyisland_<nome>`), poi la risposta.
7. Oltre 25 passi: fermati e rispondi «Mi fermo: troppi passi per questa domanda. Riprova con una richiesta più precisa.».
8. Se llama-server risponde 400 perché il contesto è pieno: accorcia a 1.500 caratteri i risultati degli strumenti più vecchi del turno e riprova **una** volta; poi errore chiaro.
9. In caso di errore o di Ferma: niente messaggi a metà nella storia (`chat.pop()` del messaggio utente, come `openai.rs`).

### 5.2 Strumenti (descrizioni **brevi**, in inglese, una riga ciascuna)
| Nome per il modello | Argomenti | Cosa fa |
|---|---|---|
| `run_command` | `command` (string), `timeout_s` (int, facoltativo, 1–600, di serie 120) | PowerShell: `powershell.exe -NoProfile -NonInteractive -Command <command>`, `current_dir(folder)`, `CREATE_NO_WINDOW`, `kill_on_drop(true)`, stdin null. Risultato: codice d'uscita + stdout + stderr, **massimo 20.000 caratteri** (se di più: inizio e fine, con «… N caratteri tolti …» in mezzo). Oltre il tempo: processo ucciso, «Tempo scaduto dopo N s». Decodifica l'output con `String::from_utf8_lossy` |
| `read_file` | `path`, `offset` (riga, facoltativo), `limit` (righe, facoltativo, di serie 400, massimo 2.000) | testo con i numeri di riga; massimo 200 KB; file binari: «File binario, non lo leggo.» |
| `list_dir` | `path` (facoltativo, di serie la cartella) | nome, cartella/file, dimensione; massimo 500 voci; salta `.git`, `node_modules`, `target`, `dist` |
| `search_text` | `text`, `path` (facoltativo), `ext` (facoltativo, es. `rs`) | ricerca **senza maiuscole, a sottostringa** (niente regex) nei file di testo sotto `path`; massimo 200 righe trovate `percorso:riga: testo`; stesse cartelle saltate; file oltre 1 MB saltati |
| `write_file` | `path`, `content` | crea o sostituisce il file (cartelle mancanti create) |
| `edit_file` | `path`, `old_text`, `new_text` | sostituisce `old_text` che deve comparire **una sola volta** (zero o più volte: errore con il numero, nessuna modifica) |
| strumenti di EasyIsland | come in `tool_list::tools()` | solo `memory_search` **più** quelli di `toolhint::tools_for(query)`, mai tutti (sono decine: sarebbero migliaia di token); mai `show_card` |

**Percorsi:** relativi alla cartella della Modalità terminale; assoluti accettati. Normalizza (`..` risolto) **prima** di decidere se è dentro la cartella. Un percorso fuori dalla cartella chiede sempre il permesso, anche in Automatica; un `secret_place` chiede sempre, anche in lettura.

Prima di `write_file`/`edit_file`: `checkpoints::touching(chat as *const Chat as usize, &path_assoluto)` e `preview::touched_by("Write"|"Edit", &json!({ "file_path": path_assoluto }))`.

### 5.3 Istruzioni di sistema (corte: meno di 800 token con gli strumenti)
Passale da `crate::i18n::prompt(...)` come `openai.rs`. Contenuto, in inglese:
- sei l'assistente nella chat di EasyIsland su Windows; rispondi in italiano se l'utente scrive in italiano;
- lavori nella cartella `<folder>`; i comandi sono PowerShell;
- usa gli strumenti quando servono; leggi prima di modificare; dopo una modifica di codice esegui i test se ci sono;
- ogni comando o modifica può chiedere il permesso all'utente: se viene negato, non riprovarlo, dillo;
- niente web: se serve, dillo.

### 5.4 Permessi (una sola funzione pura, testata)
`fn needs_ask(tool: &str, input: &Value, folder: &Path, auto: bool, mode: &str, read_only_chat: bool) -> Decision` con `Decision::{Run, Ask, Refuse(String)}`:

| Situazione | Manuale (di serie) | «Accetta modifiche» (`mode == "acceptEdits"`) | «Automatica» (`auto`) | «Piano» (`mode == "plan"`) | Conversazione in sola lettura |
|---|---|---|---|---|---|
| `read_file`, `list_dir`, `search_text` dentro la cartella | Run | Run | Run | Run | Run |
| … fuori dalla cartella o `secret_place` | Ask | Ask | Ask | Ask | Refuse |
| `write_file`, `edit_file` dentro la cartella | Ask | Run | Run | Refuse («In Piano non modifico: scrivo solo il piano.») | Refuse |
| … fuori dalla cartella | Ask | Ask | Ask | Refuse | Refuse |
| `run_command` con `opencode::read_only` | Run | Run | Run | Run | Run |
| `run_command` non delicato | Ask | Ask | Run | Refuse | Refuse |
| `run_command` con `opencode::delicate` | Ask | Ask | Ask | Refuse | Refuse |
| strumento di EasyIsland in `agent_read_only()` | Run | Run | Run | Run | Run |
| altro strumento di EasyIsland | Ask | Ask | Ask | Refuse | Refuse |

Ask: payload come `opencode::permission_payload`, con `tool_name` = `"Bash"` (comando, `tool_input: { command }`), `"Edit"` / `"Write"` (`tool_input: { file_path, old_string, new_string }` o `{ file_path, content }`, così l'isola mostra la differenza come per Claude Code), `"Read"` (`{ file_path }`), `"mcp__easyisland__<nome>"` per gli strumenti di EasyIsland. `"always"` vale **per quella conversazione e per quel comando o quel file esatti** (un `Mutex<Vec<(usize, String)>>` per conversazione, svuotato quando la conversazione si chiude). Risposta negata o scaduta: risultato «L'utente ha negato questa azione: non riprovarla.».

### 5.5 Collegamento in `chat_turn` (`src-tauri/src/lib.rs`)
Nel `match (&terminal, engine.as_str())`, **prima** del ramo `(Some(folder), e) if e == "api" || openai::ENGINES.contains(&e)`, aggiungi:
```rust
(Some(folder), "local") => local_agent::send(app, chat, &other_model, folder, query, context, auto, telegram, on_text).await,
```
Poi togli dal ramo opencode il caso `local` (`opencode_endpoint` / `via_local`) e le due funzioni se non le usa più nessuno (`cargo check` senza avvisi). `mod local_agent;` vicino a `mod local_model;`.

In `local_model.rs`: aggiorna il commento in testa («Used by: …») e l'errore di contesto troppo piccolo (oggi parla di strumenti di opencode).

### 5.6 Interfaccia
Nessuna schermata nuova. In `src/settings/main.ts`, `ENGINE_HINTS.local` e `ENGINE_FACTS.local`: «Con la Modalità terminale usa gli strumenti tramite opencode» → «Con la Modalità terminale esegue comandi e modifica file da solo, dopo il tuo permesso» (e la traduzione in `en.json`; togli la vecchia chiave se non è più usata).

## 6. Test (obbligatori, in `local_agent.rs`, `#[cfg(test)]`)
1. `needs_ask`: ogni riga della tabella 5.4 (almeno 15 casi), compresi `..` che esce dalla cartella e un `secret_place`.
2. Percorsi: relativo, assoluto dentro, assoluto fuori, `..\..\x`.
3. `edit_file`: una occorrenza (sostituita), zero (errore), due (errore, file invariato) — in una cartella temporanea `std::env::temp_dir()`.
4. Taglio dell'output a 20.000 caratteri con inizio e fine, **anche con caratteri accentati e emoji** (taglia per caratteri, non per byte).
5. `search_text`: trova senza maiuscole, salta `node_modules`, rispetta il massimo.
6. Lettura delle `tool_calls`: `arguments` valido, non valido, assente.
7. Il giro intero contro un **server finto** scritto sul modello di `local_model::tests::serve` (quello risponde a una sola richiesta: il tuo deve rispondere a due, in ordine) (risposta 1: una `tool_call` di `list_dir`; risposta 2: testo finale): il turno finisce con il testo, la storia ha solo domanda e risposta. Per farlo senza `AppHandle` separa la logica del giro da `send` (passa una funzione per i permessi e una per eseguire gli strumenti), così il test non apre card.

Comandi (devono passare tutti):
```
cd src-tauri && cargo test --workspace
npm run build
npm run check:i18n
npm run smoke:rapido      (con «npm run dev» acceso: deve dire «nessun errore»)
```

## 7. Prove dal vivo
**Non installare tu l'app** e non lanciare installer dalla shell: l'installazione la fa Claude Code (`release\installa.cmd` tramite Esplora file e WinRM per il portatile). Tu prepara il ramo committato e scrivi in questo file, sezione «Stato», cosa provare. Prove da fare dopo l'installazione:
- RTX 3070 e Radeon 840M: prima domanda in Modalità terminale con il Modello sul PC: tempo e token letti (da `%LOCALAPPDATA%\EasyIsland\llama\server.log`, riga `prompt eval time`). Atteso sotto 2.500 token.
- «elenca i file della cartella» (deve andare senza permesso), «crea prova.txt con scritto ciao» (card Consenti/Nega con la differenza), «esegui git status» (senza permesso, `read_only`), «esegui npm install» (card).
- Ferma durante un comando lungo (`Start-Sleep 60`): il processo PowerShell deve sparire da Gestione attività.
- «⟲ File» dopo una modifica: il file torna com'era.

## 8. Cosa NON fare
- Non toccare `agent.rs`, `terminal.rs`, `opencode.rs` (tranne rendere `pub(crate)` ciò che serve), `claude_cli.rs`, `permits.rs`.
- Non cambiare il comportamento degli altri motori.
- Non aggiungere dipendenze, non cambiare versioni, non toccare `identifier` in `tauri.conf.json`.
- Non scrivere in `%USERPROFILE%\.claude\` né nelle configurazioni di opencode.
- Non eseguire comandi del modello senza passare da `needs_ask`.
- Non usare `unwrap()`/`[a..b]` su output e JSON del modello.
- Non fare push né unioni.

## 9. Definizione di «finito»
- [x] `local_agent.rs` con giro, strumenti, permessi, test (punto 6) che passano.
- [x] `chat_turn` usa `local_agent` per `local` in Modalità terminale; opencode non più usato per `local`.
- [x] Nessun avviso di `cargo check`; `cargo test --workspace`, `npm run build`, `check:i18n`, `smoke:rapido` puliti.
- [x] `CLAUDE.md` aggiornato (solo la frase del punto 3).
- [x] Documentazione (punto 10).
- [x] Commit sul ramo `claude/llm-interno`, in italiano.

## 10. Documentazione da aggiornare
- `docs/chat.md` → «Motori» → «Modello sul PC», punto «Usi»: la Modalità terminale interna (`local_agent.rs`, strumenti, permessi, limiti: 25 passi, 20.000 caratteri, 600 s). Stile asciutto, a elenco, dove stanno le cose e perché, niente codice.
- `docs/chat.md` → «Modalità terminale»: una riga che il Modello sul PC non passa da opencode.
- `docs/decisioni.md`: «Modalità terminale interna per il Modello sul PC (Edoardo, 15/11/2026): comandi e file eseguiti da EasyIsland dopo Consenti/Nega, senza opencode; gli altri motori restano su opencode.»
- `docs/guida/09-motori.md` e `docs/guida/en/09-engines.md`, sezione «Modello sul PC»: con la Modalità terminale esegue comandi e modifica file da solo, dopo il tuo permesso, senza altri programmi. Poi `node scripts/guida.mjs`.
- `HANDOFF.md`: voce «Modello sul PC» in «Da fare» aggiornata; voce di 2–4 righe in cima al «Registro» (massimo 5 voci: la più vecchia va in `docs/archivio/registro.md`).

## Stato
- **Fatto (15/11/2026):**
  - Nuovo modulo `src-tauri/src/local_agent.rs`: giro OpenAI-compatibile diretto contro `llama-server` (`local_model::ensure` con `TERMINAL_CONTEXT`), istruzioni brevi via `i18n::prompt`, 6 strumenti locali (`run_command`, `read_file`, `list_dir`, `search_text`, `write_file`, `edit_file`) + `memory_search` e gli strumenti pertinenti da `toolhint::tools_for`, permessi con `needs_ask` + card `pipe::request_decision_id` / `telegram::request_decision` e memoria `"always"` per conversazione e comando/file esatto (`local_agent::forget` alla chiusura/reset/apertura cronologia), checkpoint (`checkpoints::touching`), Anteprima (`preview::touched_by`), retry una volta su HTTP 400 accorciando i risultati più vecchi, `TurnUsage` / `engine_usage::record`, 7 test unitari incluso server HTTP finto a due turni.
  - Collegamento in `src-tauri/src/lib.rs` (`chat_turn`, `chat_close`, `chat_reset`, `chat_history_open`); rimossi `local_model::opencode_endpoint`, `opencode::via_local` e il campo non letto `Lease.context` / `Server.context`.
  - Testo aggiornato in `src/settings/main.ts` (`ENGINE_HINTS.local`) e `src/i18n/en.json`.
  - Aggiornati `CLAUDE.md`, `docs/chat.md`, `docs/decisioni.md`, `docs/guida/09-motori.md`, `docs/guida/en/09-engines.md`, `HANDOFF.md`, `docs/archivio/registro.md` e rigenerato `site/guida/` + `site/en/guide/` con `node scripts/guida.mjs`.
  - Verifiche dopo le modifiche: `cargo check --workspace --tests` (0 avvisi), `cargo test --workspace` (`574 passed; 0 failed; 70 ignored` su `easyisland_lib`, incluse tutte e 7 le prove di `local_agent::tests`, più `38 passed` su `easyisland_hook`), `npm run build` (`5256 testi, 0 senza inglese`, built in `2.75s`), `npm run smoke:rapido` (`11 prove in 32 s con 6 Edge, nessun errore`).
- **Cosa provare dal vivo (dopo `release\installa.cmd`):**
  1. RTX 3070 e Radeon 840M: prima domanda in Modalità terminale con «Modello sul PC»; verificare in `%LOCALAPPDATA%\EasyIsland\llama\server.log` (`prompt eval time`) che i token letti siano sotto **2.500** e notare il tempo.
  2. «Elenca i file della cartella» e «esegui git status»: devono andare senza card di permesso.
  3. «Crea prova.txt con scritto ciao»: deve comparire la card Consenti/Nega con la differenza.
  4. «Esegui npm install» o un comando fuori cartella: deve comparire la card Consenti/Nega (e testare «Sempre» sullo stesso comando esatto nella stessa conversazione).
  5. **Ferma** durante un comando lungo (`Start-Sleep 60`): verificare che `powershell.exe` sparisca da Gestione attività e non restino messaggi a metà nella chat.
  6. **«⟲ File»** dopo una modifica con `write_file`/`edit_file`: verificare che il file torni allo stato precedente.
- **Note / dubbi:**
  - `check:i18n` non segnala testi mancanti; la vecchia chiave `ENGINE_HINTS.local` è stata sostituita e quelle già segnalate prima (`223 inutilizzati`) non riguardano questa modifica.
  - Questo file (`docs/terminale-interno.md`) resta nel commit con la sezione Stato compilata per le prove dal vivo; a fine prove si potrà rimuovere.
