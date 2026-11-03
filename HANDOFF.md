# Handoff — EasyIsland

_3 novembre 2026. **1.0.22** in `main` (tag `v1.0.22`). Si lavora su `claude/sviluppo` (uniti `telegram-voce`, `cattura`, `vocale-ricorda`, `ticket-simili`, `voce-pc`, `agentchat`, `agentchat-autonomi`); in attesa `claude/modello-integrato`. Repo pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale; il funzionamento sta in `docs/` (indice in `CLAUDE.md`).

## Da fare
- [ ] **Notizie** (`docs/chat.md` → Notizie, piano in `docs/idee.md`): fatte (1.0.14–1.0.15) argomenti anche scelti da un motore (mai persone né il nome dell'utente), Google/Bing News, vista elenco/miniature/schede, «Di più»/«Non mi interessa», Panoramica, Buongiorno, Telegram, barra, scheda fissa. Da provare dal vivo; mancano riassunti del motore e argomenti cambiati dalla chat.
- [ ] **Allegati della chat** (1.0.15, `docs/chat.md` → Allegati): più file, cartelle, 📎. Da provare con i vari motori.
- [ ] **Personaggio e isola in due finestre** (`docs/due-webview.md`, `docs/architettura.md`): da provare ai lati e su un secondo schermo (in basso e file rilasciati provati il 29/10).
- [ ] **Barra fissa** (`docs/architettura.md` → Barra fissa): provata in alto; da provare in basso, secondo monitor, menu «…».
- [ ] **Widget della barra** (1.0.13+, `barsys.rs`, card in `src/views/barcard.ts`): da provare dal vivo, soprattutto «Nascondi da sola», sfocatura, winget. Mancano Wi-Fi, Bluetooth, temperature (`docs/idee.md`).
- [ ] **Aspetto a schede con le immagini** (`docs/architettura.md` → Impostazioni): modalità chiara non guardata.
- [ ] **Integrazioni personali** (`docs/integrazioni.md`): da provare con l'app vera.
- [ ] **Guida sul sito** IT/EN (`docs/guida/`, `docs/guida/en/` → `site/guida/`, `site/en/guide/`; homepage EN `site/en/index.html`, schermate EN `site/media/en/`): allineare a ogni funzione nuova (`node scripts/guida.mjs`). Link delle Impostazioni nella lingua dell'app: prossima versione.
- [ ] **Agente personale** (priorità alta, 23/10): fatti Compiti, motori aiutanti, Battito, Abilità, permessi per livelli (1.0.16: «Sempre» sulle reversibili, permessi per compito, «Cosa ho fatto» con Annulla; `docs/chat.md`). Da provare dal vivo. Prossimi: proattività su ticket e chiamate, memoria per cliente (`docs/idee.md`).
- [ ] **Prove dal vivo** delle versioni 0.6.3–0.9.7: elenco in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): fatti `/oggi` e `/domani` (Telegram, chat), voce nel campo in alto e azione rapida, riassunto IA in Buongiorno/Fine giornata con motore a scelta, invio Telegram all'ora scelta (orari in `giornata.rs`). Da provare dal vivo.
- [ ] **3CX team e chat**, **3CX «Questo PC»** (WebRTC, suoneria): da provare sul centralino vero (`docs/prove-dal-vivo.md`; il log scrive `3cx: event type …`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (Graph):** predisposto; da provare registrando l'app in Entra, poi avvisi mail, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Secondo cervello**, **chat nuova e memoria**: da provare con memoria e motori veri (`docs/chat.md`, `docs/prove-dal-vivo.md`).
- [ ] **Accesso remoto:** WinRM e SSH (Windows/Linux) da provare su un PC cliente.
- [ ] **Remote Desktop Manager:** predisposto; prova sul PC con RDM, poi passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file** («Manda a EasyIsland», azioni sui file; deciso l'11/10, `docs/idee.md`).
- [ ] **opencode:** card per `question` anche nella chat, controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Agent Chat** (1.0.18–1.0.21): server sulla VPS, token `casa` collegato. Server nuovo (token owner, `/api/status`) da pubblicare, poi provare stati e scrittura dall'isola con i due PC. Da provare: risposte dei motori, capo che affida un lavoro, ascolto spento dall'isola, un «ciao» con due PC accesi (risponde uno solo), `@nome`, nome già preso. Memoria condivisa (lavoro «Condividi la memoria» Sì; casa «Memoria di un altro PC» = lavoro): ricerca da casa con lavoro acceso e spento; nota di lavoro da casa a lavoro spento, poi riaccenderlo.
- [ ] **Spunti dall'app originale:** Amp/Hermes, limiti di Codex, riepilogo come immagine, GitHub (`docs/idee.md`).
- [ ] **Modalità chiara:** guardare schede dell'isola e Impostazioni con l'app vera, correggere in `src/style-light.css` / `settings-light.css` (i colori in linea nel TS non cambiano).
- [ ] **Flussi** (`docs/flussi.md`): da provare con flussi veri, soprattutto agente con campi, scelta del modello, ripresa dopo riavvio.
- [ ] **Isola fissa, barra riservata** con tre aree scelte dall'utente, personaggio non trascinabile: decisa; primo passo una prova della barra di Windows (`docs/idee.md`).
- [ ] **Modello integrato** (accantonato 27/10): branch `claude/modello-integrato`, manca la prova dal vivo.
- [ ] **Recapiti tra due EasyIsland** senza VPN né cloud: da valutare (`docs/idee.md`).
- [ ] **Pulizia strutturale** (27/10):
  - immagini della guida rotte su GitHub (`../media/` da `docs/guida/` punta a `docs/media`): percorso vero verso `site/media/`, corretto da `guida.mjs`; niente symlink;
  - `island.rs` `on_foreground_change` crea un thread a ogni cambio di finestra: basta un contatore che faccia uscire i vecchi;
  - test front end con `node --test`, prima `expr.ts`, `markdown.ts`, `calc.ts`;
  - 170 testi inglesi «inutilizzati» di `check:i18n`: alcuni sono composti al momento, guardarli uno per uno.
- [ ] **Inglese lingua principale nell'app** (27/10): oggi chiavi in italiano e avvio in italiano. Da decidere: solo lingua predefinita delle nuove installazioni o anche chiavi in inglese.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (14/10, quali da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro; torna davanti al cambio di finestra. Verificare con Start aperto.
- **Limiti del piano da Anthropic:** `/api/oauth/usage` non è documentato; se smette, il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): parte invisibile, apre `/usage`, si chiude senza processi; il rinnovo di un accesso scaduto va visto alla prossima scadenza. Dopo, Claude Code può usare una volta il renderer classico.
- **Chiave salvata in opencode vince su quella di EasyIsland** (2/11): in Modalità terminale OpenRouter, OpenAI, Gemini e API Anthropic passano da opencode (`opencode::via`, chiave in `OPENROUTER_API_KEY` ecc.), che preferisce la sua (`opencode auth list`). Sintomo: «User not found» solo in `~/.local/share/opencode/log/opencode.log`. Risolto a mano con `opencode auth logout openrouter`. Da fare: far vincere sempre la chiave di EasyIsland (`providers.openrouter.settings.apiKey` in `OPENCODE_CONFIG_CONTENT` non ha funzionato) o dirlo nell'errore.

## Registro
Max 5 voci, la più recente in alto; le vecchie in `docs/archivio/registro.md`.

### 3/11 — Mappa della memoria: viste nuove, gruppi, collegamenti giudicati dall'IA (`claude/mappa-memoria`)
- Viste Galassia, Rete neurale (impulsi su `memory-activity`), Bolle, Raggiera, Fiume, Da dove arriva; gruppi a colori, freschezza, filtri (legenda, periodo, solo sicuri), «Come è collegato a…», doppio clic = messa a fuoco, note sole (`src/memory/`).
- Collegamenti: forza 1–3, stime più severe (`Rarity`), niente catene di parole rare; «Collega con l'IA» giudica le note e salva `collegamenti.json` (`memory_links.rs`), anche per la copia di lavoro da casa. Provato nell'anteprima con i dati finti e con test Rust; non sulla memoria vera né con un motore vero. `docs/chat.md` → Finestra Memoria.

### 3/11 — Coda della chat, font, Agent Chat: chi lavora e scrivere dall'isola (`claude/sviluppo`)
- Chat: si scrive mentre risponde, messaggi in coda con Invia subito / Modifica / ✕ (`chat.ts`); Ctrl+Invio = Ferma e manda.
- Aspetto → Font: titoli e testo separati (`src/core/fonts.ts`, `theme.fonts`), Doto/DotGothic16/VT323/Space Mono in `public/fonts/` (OFL), più i font di Windows (`system_fonts`). Anche nella barra fissa, con «Font di Aspetto → Font» (acceso di serie). Scheda Agent Chat a tutta isola. Smoke: Edge chiusi con `Browser.close` (restavano appesi).
- Agent Chat: stato per motore dagli eventi del turno (`Reporter` → `/api/status`), «preso da», «nessuna risposta», «nessun agente attivo» nella scheda e nella pagina; campo nella scheda per scrivere come l'owner con un token a parte e un nome scelto (`owner_send`, `as_owner`). Server cambiato in `C:\Users\Edoardo\agentchat` (token owner, `human`, `/api/status`): da pubblicare. Provato con server locale, anteprima, smoke e test Rust; non con i motori veri. `docs/integrazioni.md` → Agent Chat.

### 3/11 — Chat e integrazioni in una finestra, Anteprima nella finestra della chat (1.0.22)
Clic destro, pulsante o voce trascinata fuori dall'isola → finestra (`popout.ts`, `popout_window` in `lib.rs`); tutto resta nella pagina dell'isola. Pagina `about:blank` (una dell'app restava vuota); la vista va al sicuro nell'isola a ogni `pagehide` e torna nella pagina nuova, la ✕ è trattenuta da Rust finché la vista non è rientrata: prima la chat tornava con i pulsanti morti. Finestre per nome (`popout_take`, `get_window`): cercate come webview window sparivano con l'Anteprima dentro, che andava e tornava. Smoke in parallelo (~2,5 min) e `smoke:rapido` (~30 s). «Rimetti» chiude da Rust (`popout_close`). L'Anteprima agganciata segue la chat (`preview::chat_dock` la rifà, `reopen` aspetta che la vecchia sparisca). Bordo della barra delle conversazioni trascinabile. Provato nell'anteprima con un iframe; da provare nell'app l'Anteprima nella finestra della chat. `docs/architettura.md` → Viste, `docs/chat.md` → Anteprima.

### 2/11 — Finestra Memoria: Questo PC / altro PC / Tutte (1.0.22)
Con la copia di un altro PC (`memoria-condivise`) la barra della finestra Memoria sceglie quale memoria disegnare (`memory_graph` con `source`, `brain::graph_of`). Nome dell'altro PC dalla cartella o dall'impostazione. `docs/chat.md` → Finestra Memoria. Provato nell'anteprima con «ufficio» finto e `cargo check`; non ancora nell'app con la copia vera.

### 2/11 — Chat: barra delle conversazioni, più conversazioni aperte (1.0.22)
Barra a sinistra (Ctrl+B; allarga l'isola con `chatSideRoom`, galleggia se stretta), colonna centrale di 780 px. Ogni conversazione ha il suo `Chat` in Rust (`Chats`, comandi con `sid`), processo e «Ferma»; max 8 (`MAX_OPEN_CHATS`). `docs/chat.md` → Cronologia. Provato con test, smoke e `?scene=chat&history`, non con due motori veri insieme.
