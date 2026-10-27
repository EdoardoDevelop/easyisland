# Handoff — EasyIsland

_Aggiornato al 27 ottobre 2026. Versione **1.0.9** in `main` con il tag `v1.0.9` (la CI pubblica l'installer, la workflow Homepage pubblica sito e guida). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Integrazioni personali:** fatte nel codice e nell'anteprima (`docs/integrazioni.md`); da provare con l'app vera (`docs/prove-dal-vivo.md`).
- [ ] **Guida sul sito**, italiano e inglese (`docs/guida/`, `docs/guida/en/` → `site/guida/`, `site/en/guide/`; homepage inglese `site/en/index.html`, schermate inglesi in `site/media/en/`): da tenere allineate a ogni funzione nuova (`node scripts/guida.mjs`). Il link delle Impostazioni nella lingua dell'app arriva con la prossima versione.
- [ ] **EasyIsland agente personale** (dopo la 1.0.0) (priorità alta, chiesto da Edoardo il 23 ottobre 2026): fatti i **Compiti** con motore per compito, motori aiutanti e **Battito**, e le **Abilità** (`docs/chat.md`; da provare dal vivo domande e permessi, `docs/prove-dal-vivo.md`). Prossimi: proattività su ticket e chiamate, permessi per livelli, memoria per cliente. Piano in `docs/idee.md`.
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Riquadra e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat; della 0.9.3 gli strumenti di Notion, Antigravity e Claude API con gli strumenti di EasyIsland, la Seconda opinione, /oggi e /domani; della 0.9.4 velocità e ricette della chat; della 0.9.5 Microsoft To Do (sul PC con Outlook) e gli hook senza Git Bash; della 0.9.6 Accesso remoto ed eliminazione di righe di Notion dalla chat; della 0.9.7 la chat nuova, la memoria e la RAM di WebView2. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): riassunto delle integrazioni fatto dall'IA, da solo agli orari scelti e a richiesta da chat, ricerca, Telegram e azioni rapide. Fatti `/oggi` e `/domani` su Telegram; il resto in `docs/idee.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Secondo cervello:** pagine collegate, da-leggere, controllo e finestra Memoria fatti nel codice e nell'anteprima (`docs/chat.md`); da provare con la memoria vera (`docs/prove-dal-vivo.md`).
- [ ] **Chat nuova e memoria:** fatte nel codice; da provare con i motori veri e da guardare dopo qualche giorno d'uso (`docs/prove-dal-vivo.md`).
- [ ] **Accesso remoto:** fatto nel codice; collegamento vero con WinRM e SSH (Windows e Linux) da provare su un PC di un cliente (`docs/prove-dal-vivo.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Modalità chiara:** guardare tutte le schede dell'isola e le pagine delle Impostazioni in chiaro con l'app vera e correggere in `src/style-light.css` / `settings-light.css` ciò che il plugin sbaglia (colori in linea nel codice TypeScript non cambiano).
- [ ] **Flussi:** fatti nel codice (finestra Flussi, agenti, scelte, per ogni, domande su Telegram, tentativi, esecuzioni; piano e scelte in `docs/flussi.md`); da provare con flussi veri, soprattutto un agente con i campi, la scelta del modello e la ripresa dopo un riavvio.
- [ ] **Isola fissa con spazio riservato** su un bordo (alto, basso, destra, sinistra), personaggio non più trascinabile: da studiare con Edoardo (`docs/idee.md`).
- [ ] **Rinominare le conversazioni** nella cronologia della chat (✎ accanto a 📌, `chat_rename`; `docs/idee.md`).
- [ ] **Modello integrato** (accantonato il 27 ottobre 2026): fatto nel branch `claude/modello-integrato`, non unito, manca la prova dal vivo (`docs/idee.md`).
- [ ] **Recapiti tra due EasyIsland** (casa ↔ notebook, memorie separate, senza VPN né cloud): da valutare (`docs/idee.md`).
- [ ] **Pulizia strutturale** (dal controllo del 27 ottobre 2026):
  - guida: due capitoli `10-` (`10-anteprima` e `10-strumenti-ai`, idem in inglese) e `guida.mjs` che abbina italiano e inglese solo dal numero, così il pulsante della lingua porta alla pagina sbagliata: rinumerare e abbinare dal nome;
  - immagini della guida rotte su GitHub (`../media/` da `docs/guida/` cerca `docs/media`): percorso vero verso `site/media/`, corretto da `guida.mjs` per il sito; niente collegamenti simbolici;
  - `island.rs` `on_foreground_change`: un thread nuovo a ogni cambio di finestra (isola ritirata sopra la barra); un contatore che fa uscire i thread vecchi basta;
  - test del front end con `node --test` (zero dipendenze), per primi `expr.ts`, `markdown.ts`, `calc.ts`;
  - i 170 testi inglesi «inutilizzati» di `check:i18n`: guardarli uno per uno, alcuni sono composti al momento.
- [ ] **Inglese lingua principale anche nell'app** (chiesto da Edoardo il 27 ottobre 2026; README e homepage lo sono dalla 1.0.9): oggi i testi nascono in italiano (`t("testo italiano")`, chiave = italiano, inglese in `src/i18n/en.json`) e l'interfaccia parte in italiano. Da decidere come: solo la lingua predefinita di una nuova installazione, oppure anche le chiavi in inglese.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (segnalato il 14 ottobre 2026, quali personaggi è da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 27 ottobre 2026 — Versione 1.0.9: Anteprima nell'isola, inglese prima
- Anteprima di file e pagine web (nell'isola o in finestra), passi della chat a parole, permessi dentro la chat, memoria con riassunti e alias: tutto in `CHANGELOG.md`.
- README e homepage prima in inglese: `README.md` inglese e `README.it.md`; `site/index.html` inglese, `site/it/index.html` italiana, `site/en/index.html` rimanda alla radice; «Sito» nelle Impostazioni apre `/it/` con l'interfaccia in italiano; la guida tiene i suoi indirizzi.

### 27 ottobre 2026 — Permessi della chat dentro la chat (su `claude/sviluppo`)
- Un permesso chiesto dalla chat compare in fondo alla conversazione con Nega / Sempre / Consenti (`chat.ts`), non più su una card che toglie la chat; `State.pendingCard()` per la chat è `prompt`.
- Con l'isola aperta porta sempre alla chat: con «Permessi e chiamate» spento prima restava solo il fumetto in alto e la chat sembrava ferma (`hooks.ts` `handleChatPermission`).

### 26 ottobre 2026 — Passi della chat leggibili (su `claude/sviluppo`)
- Le righe «⚙» della chat (isola e Telegram) dicono a parole cosa fa, con l'argomento («Prepara il piano del compito», «Cerca nella memoria · `…`»), invece di «task_plan · easyisland» (`steps.rs`, `docs/chat.md`). Il motore scrive anche una frase breve prima di ogni gruppo di strumenti (`AGENT_PROMPT`).

### 26 ottobre 2026 — Anteprima di file e pagine web (su `claude/sviluppo`)
- Finestra **Anteprima** (`preview.rs`, `src/preview/`), come quella di Claude desktop: schede di file (codice colorato, Markdown, CSV, immagini, «Modifiche» rispetto a prima della chat) e pagine web in un browser vero dentro la finestra, con misure da telefono/tablet, chiaro/scuro, console, Strumenti per sviluppatori. Si apre da link e percorsi della chat, da sola sui file della Modalità terminale, dal server di sviluppo. Strumenti `preview_*` per la chat (clic e scrittura con Consenti / Nega). Dettagli in `docs/chat.md`, guida `10-anteprima`.
- **Nell'isola** (pannello a destra dentro la finestra dell'isola, largo quanto lo trascini) o finestra separata, a scelta in Impostazioni → Chat → Anteprima (`preview::pane`, island.ts `placePane`). Comandi che creano finestre ora `async` (prima bloccavano tutta l'app).
- La chat vede la pagina come albero di accessibilità con riferimenti (`preview_snapshot`), clicca e scrive per riferimento e riceve la pagina dopo, aspetta (`preview_wait`), legge le richieste fallite (`preview_network`) e sa da sola cosa c'è nell'Anteprima aperta (`preview::hint`).
- Tauri con `unstable` (più webview per finestra); `build.rs` incorpora il manifest perché i test partano (`docs/decisioni.md`).
- **Prove:** `cargo test` (331), `npm run build`, `check:i18n`, la pagina con i dati finti in Edge. **Da provare dal vivo** tutta la parte con l'app (`docs/prove-dal-vivo.md`).

### 26 ottobre 2026 — Memoria: riassunti, alias e secondo passo (su `claude/sviluppo`)
- Intestazione delle pagine con `riassunto:` e `alias:` facoltativi (`brain.rs`): la ricerca della chat dà il riassunto delle pagine collegate e trova una pagina anche dai suoi alias; un `[[Alias]]` porta alla pagina (`target_of`). `memory_page_write` li prende dalle prime righe del testo, senza li conserva.
- Secondo passo della ricerca solo sui legami forti (relazione con nome o indicata da due pagine, al massimo 4). Pulizia proposta e ricerca per significato in `docs/idee.md`.
- Il motore per la memoria (`memory_ai.rs`) scrive anche `summaries`: riscrive solo il riassunto, agli alias aggiunge. Guida e `docs/chat.md` aggiornate.
- **Prove:** `cargo test` (328), `npm run build`, `check:i18n`. Da provare dal vivo «Collega con l'IA» con un motore vero.
