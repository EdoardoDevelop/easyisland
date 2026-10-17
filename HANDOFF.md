# Handoff — EasyIsland

_Aggiornato al 17 ottobre 2026. Versione **0.8.8** in `main` con il tag `v0.8.8` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode. Tutte in `docs/prove-dal-vivo.md`.
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

### 17 ottobre 2026 — Cartella di lavoro, strumenti di EasyIsland per opencode, versione 0.8.8
- Versione **0.8.8** con questa voce e Telegram; README, README.en.md e homepage aggiornati.
- Su richiesta di Edoardo, cartella di lavoro (`workdir.rs`, `src/views/workdir.ts`, `docs/strumenti.md`): è `chatFolder`, scelta con la finestra di Windows; in «File e schermo» sotto il Vassoio con sottocartelle, Rinomina, Sposta, Nel Vassoio, Cestino, trascinamento; dal Vassoio si sposta lì; strumenti `list_work_folder` e `move_to_work_folder`; `/cartella` in Telegram.
- opencode (e gli altri motori in modalità terminale) ha ora gli strumenti di EasyIsland come Claude Code (`with_agent`, `docs/chat.md`).
- **Prove:** `cargo test --workspace`, `npm run build`, scena `files` (cartella d'esempio, navigazione e «⋯»). Da provare dal vivo (`docs/prove-dal-vivo.md`).

### 17 ottobre 2026 — Telegram
- Su richiesta di Edoardo, integrazione «Telegram» (`telegram.rs`, `docs/integrazioni.md`): la chat di EasyIsland nel suo bot (BotFather), solo long polling, una chat collegata con un codice. Conversazione separata con motore e modello scelti da Telegram (`/motore`, `/modello`), Consenti / Nega come pulsanti in Telegram nella modalità terminale, foto e file nel Vassoio, messaggi a app chiusa scartati. Poi, segnalato da Edoardo: i file che il turno mette nel Vassoio arrivano in Telegram (anche `/vassoio`), e il bot resta acceso con qualsiasi profilo.
- Il turno della chat è ora `chat_turn` in `lib.rs`, con il testo verso una funzione: prima i motori lo mandavano sempre all'isola (anche «Sostituisci», senza effetto).
- **Prove:** `cargo test --workspace` (anche l'HTML per Telegram e i messaggi lunghi), `npm run build`, riga nelle Impostazioni nell'anteprima. Non provato con un bot vero (`docs/prove-dal-vivo.md`).

### 17 ottobre 2026 — Documentazione in inglese, versione 0.8.7
- Versione **0.8.7** con le voci del 16–17 ottobre (Registra, Cerca con Google, loghi, alone, ⚡ Automatica con i connettori).
- Su richiesta di Edoardo, documentazione in inglese accanto a quella italiana: `README.en.md`, `CONTRIBUTING.en.md`, `docs/en/` (architettura, sviluppo, agenti e chat), con i collegamenti tra le lingue. I file italiani restano il riferimento; regola in `docs/sviluppo.md`.

### 17 ottobre 2026 — «Automatica» con opencode e i connettori
- Segnalato da Edoardo: in «Automatica» opencode chiedeva sempre per aggiungere in Notion. Non era un guasto: gli strumenti MCP restavano tutti sulla card. Su sua scelta ora passano da soli, tranne quelli che cancellano o inviano (`mcp_delicate` in `opencode.rs`, `docs/chat.md`).
- **Prove:** turno vero con opencode 2.0.25 (gli eventi hanno `action` = `<server>_<strumento>`), `cargo test --lib opencode::`.

### 17 ottobre 2026 — Loghi Teams e RDM, alone in tutte le schede, ricerca che si chiude
- Su richiesta di Edoardo: loghi di Teams e Remote Desktop Manager da `brand/` (`scripts/gen-brands.mjs`, RDM senza la piastrella chiara). Alone colorato in basso come nella chat anche in Panoramica e integrazioni (colore della scheda), Azioni (ambra) e File e schermo (verde). Un clic su una scheda mentre si scrive nella barra di ricerca la chiude e la svuota.
- **Prove:** `npm run build`, scena `media&long&summary`, `npm run smoke`.
