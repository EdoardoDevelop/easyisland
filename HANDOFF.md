# Handoff — EasyIsland

_Aggiornato al 21 ottobre 2026. Versione **0.9.6** in `main` con il tag `v0.9.6` (la CI pubblica l'installer). Su `claude/sviluppo`, non ancora in una versione: chat più comoda e memoria. Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat; della 0.9.3 gli strumenti di Notion, Antigravity e Claude API con gli strumenti di EasyIsland, la Seconda opinione, /oggi e /domani; della 0.9.4 velocità e ricette della chat; della 0.9.5 Microsoft To Do (sul PC con Outlook) e gli hook senza Git Bash; della 0.9.6 Accesso remoto ed eliminazione di righe di Notion dalla chat. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): riassunto delle integrazioni fatto dall'IA, da solo agli orari scelti e a richiesta da chat, ricerca, Telegram e azioni rapide. Fatti `/oggi` e `/domani` su Telegram; il resto in `docs/idee.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Chat nuova e memoria:** fatte nel codice; da provare con i motori veri e da guardare dopo qualche giorno d'uso (`docs/prove-dal-vivo.md`).
- [ ] **Accesso remoto:** fatto nel codice; collegamento vero con WinRM e SSH (Windows e Linux) da provare su un PC di un cliente (`docs/prove-dal-vivo.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (segnalato il 14 ottobre 2026, quali personaggi è da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 22 ottobre 2026 — Idee dalle altre app di chat
- Chiesto da Edoardo: prendere spunto dalle alternative (Raycast AI, LibreChat, TypingMind, Open WebUI, Msty, ChatGPT, Claude).
- Fatti:
  - menu `@` (appunti, finestra, Vassoio);
  - modelli con `{{campi}}` e Tab;
  - ⑂ Dirama da qui;
  - Assistenti con motore e istruzioni, scelti con `/`;
  - 🎤 dettatura, con il servizio dei Vocali o con quella di Windows.
- Spostate «Istruzioni e memoria» fuori dal blocco di Claude Code: prima si vedevano solo con quel motore.
- Il 🎤 nascondeva l'isola: «davanti al cliente» vedeva il microfono di WebView2 come una chiamata (`presence.rs`, `chat_dictation`).
- RAM di WebView2 da 557 a 104 MB con l'isola ritirata: Impostazioni nascoste sospese e memoria bassa con l'isola ritirata (`webview_memory.rs`, `docs/architettura.md`).
- Dettagli e cosa non è stato preso in `docs/chat.md`.
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`, anteprima della scena `chat`. Dal vivo in `docs/prove-dal-vivo.md`.

### 21 ottobre 2026 — Chat più comoda e memoria in timeline
- Chiesto da Edoardo: rendere la chat più comoda di Claude Code da terminale.
  - Campo su più righe, con la bozza che resta. ↑ riprende l'ultima domanda.
  - Ctrl+V e trascinamento di file a conversazione avviata.
  - Copia, Modifica e ↻ Rigenera sotto i messaggi.
  - Comandi con `/`, comprese le azioni rapide.
  - Cronologia con ricerca e 📌, Esporta in Markdown, Istruzioni per profilo, `/riprendi` su Telegram.
- Memoria (`memory.rs`): `MEMORIA.md` davanti a ogni conversazione, diario mensile scritto dall'app senza token, `memory_search` e `memory_note`. Dettagli in `docs/chat.md`.
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`, scene `chat` e `chat&history` nell'anteprima. Da provare dal vivo con i motori veri (`docs/prove-dal-vivo.md`).

### 21 ottobre 2026 — Accesso remoto (WinRM e SSH) per l'assistenza, versione 0.9.6
- Versione **0.9.6** con questa voce e la precedente; README, README.en.md e homepage aggiornati.
- Chiesto da Edoardo: nuova integrazione «Accesso remoto» (`remote.rs`, `src/views/remote.ts`). Collegamento temporaneo a un PC con WinRM o SSH (Windows e Linux), niente salvato: la password resta solo in memoria. La scheda ha la guida passo passo già aperta (collegarsi, preparare il PC, se non va) e sotto un errore «Come risolvere» con i passi per quel caso. Con 🔌 nella chat l'IA lavora su quel PC con `remote_run`, sempre con Consenti / Nega. «Chiudi connessione» toglie TrustedHosts e cancella `known_hosts`.
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`, scene `remote` e `chat&remote`. Errori di WinRM e SSH provati dal vivo verso questo PC. Un collegamento riuscito è da provare su un PC vero (`docs/prove-dal-vivo.md`).

### 21 ottobre 2026 — Eliminare righe di Notion dalla chat
- Chiesto da Edoardo: tolta la regola «gli strumenti di EasyIsland non eliminano» per Notion. Nuovo `notion_delete_row` (`notion_tools.rs`, `hook/src/tool_list.rs`): sposta la riga nel cestino di Notion solo con `confirmed: true`, dopo il sì dell'utente in chat; senza, torna la riga da mostrare. In Telegram «Automatica» chiede comunque (nome con «delete»).
- **Prove:** `cargo test` in `hook/`, `cargo check`, `npm run check:i18n`. Da provare dal vivo con una riga vera (`docs/prove-dal-vivo.md`).

### 20 ottobre 2026 — Microsoft To Do, hook in ogni shell, isola su un altro schermo, versione 0.9.5
- Versione **0.9.5** con queste voci; README, README.en.md e homepage aggiornati.
- Segnalato da Edoardo: su un PC senza Git Bash l'hook di EasyIsland fermava Claude Code a ogni strumento. Il comando era tra virgolette, un errore di sintassi in PowerShell: ora è senza virgolette e va in ogni shell (provato in PowerShell, cmd e Git Bash); gli hook vecchi risultano «da aggiornare» (`docs/agenti.md`).
- Segnalato da Edoardo: l'isola aperta non si poteva portare sullo schermo secondario. Ora sì, e ci resta; anche il personaggio lasciato sulla parte lontana di uno schermo stretto tornava sul principale (si guardava il centro della finestra, ora il cursore). Provato qui con trascinamenti simulati sui due schermi (`docs/architettura.md` → Schermi secondari).
- Chiesto da Edoardo: gestire To Do (leggere, aggiungere, cambiare). Strumenti di easyisland `todo_list`, `todo_add`, `todo_update` attraverso Outlook classico via COM (`todo.rs`, `docs/integrazioni.md`): nessun accesso nuovo, niente eliminazioni.
- **Prove:** `cargo test --workspace`, sintassi dello script e sue funzioni su un'attività finta. Su questo PC Outlook non c'è: la prova vera è da fare sul PC con Outlook (`docs/prove-dal-vivo.md`).

