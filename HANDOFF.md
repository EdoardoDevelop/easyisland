# Handoff — EasyIsland

_Aggiornato al 17 ottobre 2026. Versione **0.8.8** in `main` con il tag `v0.8.8` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 19 ottobre 2026 — Relay aggiornato davvero, righe di Notion create bene
- Segnalato da Edoardo: da Telegram un'aggiunta in Notion ha richiesto 10 minuti e creato 8 pagine vuote. Cause: `bin\easyisland-hook.exe` fermo al 14 ottobre (copia in uso, errore taciuto: niente `notion_map`), e il modello (opencode, gratuito) che metteva `parent` dentro ogni pagina. Ora la copia in uso si mette da parte (`docs/agenti.md`) e l'indice della mappa dice come creare le righe (`docs/integrazioni.md`).
- **Prove:** `cargo test --workspace`; sessione di opencode letta dal suo database. Da provare: la stessa richiesta da Telegram dopo l'aggiornamento.

### 19 ottobre 2026 — Mappa di Notion per la chat, versione 0.9.2
- Chiesto da Edoardo: la chat cercava ogni volta com'è fatto il suo Notion. `notion_map.rs` tiene sul PC, cifrata, la struttura vista dal token (database, proprietà, opzioni, relazioni, data source, pagine); la chat riceve un indice all'inizio e i dettagli con lo strumento `notion_map`. Sincronizza a mano e ogni N ore (`docs/integrazioni.md`).
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`; lettura vera in sola lettura (`notion_map::tests::live`: 11 database, 2 pagine) e data source confrontata con il connettore di Notion. Da provare in chat (`docs/prove-dal-vivo.md`).

### 19 ottobre 2026 — Ferma nella chat e su Telegram
- Chiesto da Edoardo: fermare una risposta che sta facendo lavoro inutile. `chat_turn` (`lib.rs`) corre contro `STOP`: ■ al posto di Invia nell'isola, «⏹ Ferma» e `/stop` su Telegram; il motore viene chiuso con il turno (`docs/chat.md`).
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`. Da provare con un motore vero (`docs/prove-dal-vivo.md`, Telegram 13).

### 18 ottobre 2026 — Remote Desktop Manager con l'Hub, versione 0.9.1
- Segnalato da Edoardo: con il suo Devolutions Hub l'elenco restava «non ancora letto». Causa: tutte le voci stanno nel vault utente, che `Get-RDMSession` non legge. Ora `rdm.rs` legge i vault condivisi e il vault utente (`Get-RDMPrivateSession`) e apre con `/Vault:` (`docs/integrazioni.md`).
- Chiesto da Edoardo: elenco salvato su questo PC e cifrato (DPAPI, `rdm-cache.bin`), sincronizzazione solo con «Sincronizza», pallino «RDM avviato». Il server MCP di RDM è stato provato e scartato (non elenca il vault utente e vuole RDM aperto).
- **Prove:** sul suo PC i comandi del modulo (883 voci) e il formato di apertura dal «Copia link»; `cargo test --workspace`, `npm run build`, `npm run smoke`. Da provare: la sincronizzazione e l'apertura dall'app (`docs/prove-dal-vivo.md`).

### 18 ottobre 2026 — Antigravity (Google), versione 0.9.0
- Versione **0.9.0** con Antigravity; README, README.en.md e homepage aggiornati.
- Chiesto da Edoardo: Antigravity come Claude Code e opencode. Agente con i suoi hook (`~/.gemini/config/hooks.json`, gruppo `easyisland`, `hooks.rs`; traduzione in `hook/src/agents.rs`): sessioni, passi, diff, Consenti / Nega per comandi e strumenti MCP, con `allow` (la sua politica) quando l'isola non risponde. Motore della chat `antigravity.rs` (`agy -p` in `stream-json`), anche da Telegram; istruzioni di installazione in Impostazioni → Chat e motori AI (`docs/agenti.md`, `docs/chat.md`).
- Segnalato da Edoardo dopo l'installazione: la chat non funzionava (agy 1.4.2 annida i campi di ogni evento e vuole la domanda come `--print=`). Corretto e provato con agy vero, anche un hook di prova con `auto_approve`.
- **Prove:** `cargo test --workspace` (traduzione, risposte, gruppo nel file, stream), il relay compilato con payload finti risponde sempre in un formato valido, `npm run build`, `npm run smoke`. Non provato con agy vero: non è installato su questo PC (`docs/prove-dal-vivo.md`).
