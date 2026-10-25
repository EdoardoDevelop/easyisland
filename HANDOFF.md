# Handoff — EasyIsland

_Aggiornato al 25 ottobre 2026. Versione **1.0.5** in `main` con il tag `v1.0.5` (la CI pubblica l'installer, la workflow Homepage pubblica sito e guida). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

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
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (segnalato il 14 ottobre 2026, quali personaggi è da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 25 ottobre 2026 — Modalità chiara, Jarvis Plasma, Aspetto riordinato
- Modalità **Scura / Chiara / Automatica** per entrambi gli stili (`theme.scheme`). Le regole chiare le genera il plugin di Vite `scripts/light-css.mjs` sotto `:where([data-scheme="light"])`; correzioni a mano in `src/style-light.css` e `settings-light.css`; Automatica dal registro (`system_light`). Dettagli in `docs/architettura.md`.
- **Jarvis Plasma** (`jarvis.ts`), da un'immagine: gabbia di filamenti, rete interna, nodo luminoso, niente bordo netto. Jarvis Sfera con colori più accesi.
- Pagina **Aspetto** in cinque sezioni (`appearanceSections`); volumi spostati in Generale.

### 25 ottobre 2026 — Grafo 3D della memoria
- Nuova scheda «Grafo 3D» nella finestra Memoria (`src/memory/graph3d.ts`): forze in 3D, prospettiva su Canvas 2D senza librerie, trascina per girare, clic per portare la stella davanti. Fotogrammi solo mentre si muove.

### 25 ottobre 2026 — Motore per la memoria
- `memory_ai.rs`: un motore scelto in Impostazioni → Chat → Memoria (anche gratuito, senza strumenti) riceve note e pagine e risponde in JSON; EasyIsland scrive solo aggiunte (pagine-argomento con le note, relazioni). «Collega con l'IA» nella mappa e dopo il riordino della sera se la memoria è cambiata.
- **Prove:** `cargo test` (lettura del JSON, intestazione delle pagine), `npm run build`, `npm run smoke`. Da provare dal vivo con un motore vero.

### 25 ottobre 2026 — Grafo della memoria più collegato
- Le note si collegano alle pagine anche con `[[…]]` e con due parole chiave in comune, e alle due note più simili, più le voci che condividono una parola rara (un cliente, un server); le archiviate isolate escono dal grafo (restano nella timeline). Con la memoria del notebook: nessun punto isolato (`brain.rs`, `key_words`, `wiki_links`).
- **Prove:** `cargo test` (nuovo test e `live_graph` sui dati del notebook).

### 25 ottobre 2026 — Jarvis
- Nuovo personaggio **Jarvis** (`jarvis.ts`, tipo `hud`): nucleo e anelli sempre in movimento, ritmo e colori per stato, satelliti per gli agenti al lavoro, avvio con anelli che si compongono, secondi sull'anello esterno, parallasse verso il mouse. Senza occhi, mani né gelatina.
- **Jarvis Sfera**: seconda versione, sfera di punti che ondeggia, dall'immagine di Edoardo (senza satelliti né scintille). Il cubo non si nomina più in README, guida, sito e documentazione.
- Con Jarvis il meteo è un segno piccolo nell'angolo, mai dietro gli anelli. Corretto: «Chiudi finestra» dall'anteprima nella barra delle applicazioni distruggeva la finestra dell'isola (EasyIsland restava acceso senza isola); ora la richiude come la sua ✕ (`CloseRequested` in `lib.rs`, evento `tray` «close»).
- **Prove:** `npm run build`, `npm run smoke`; anteprima degli stati. Da vedere dal vivo nell'isola e nel saluto.
