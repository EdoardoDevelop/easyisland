# Handoff — EasyIsland

_Aggiornato al 12 ottobre 2026. Versione **0.7.6** in `main` con il tag `v0.7.6` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **«Sostituisci»** incolla testo semplice: in Word e Outlook il pezzo sostituito perde grassetti e link interni.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Limiti del piano con la sola app desktop di Claude:** l'accesso in `.credentials.json` scade ogni ~8 ore e l'app desktop non lo rinnova: i numeri restano grigi finché Claude Code non gira nel terminale o in VS Code. Un rinnovo senza consumare il piano non è stato trovato.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 13 ottobre 2026 — «Cerchia e chiedi» al posto di «Cattura una zona»
- Lo Strumento di cattura di Windows è sostituito dal nostro velo: lo schermo sotto il mouse si ferma nella finestra dell'isola stessa, si cerchia o riquadra la zona e accanto ci sono domanda alla chat, azioni rapide, Copia immagine, Copia testo (OCR di Windows) e Nel Vassoio (`screenshot.rs`, `capture.ts`, `docs/strumenti.md`). Provati nell'anteprima (scena `capture`) e dal vivo congelamento e OCR (`screenshot::live`); il velo vero va provato (`docs/prove-dal-vivo.md`). Proposte «al momento giusto» annotate in `docs/idee.md`.

### 13 ottobre 2026 — 3CX: personaggio che spariva in chiamata, suoneria predefinita muta, colore delle integrazioni
- In chiamata col telefono «Questo PC» l'isola usa il microfono e «Davanti al cliente» la prendeva per una riunione, nascondendo il personaggio: ora durante una chiamata 3CX il microfono non conta (`threecx::in_call` in `presence.rs`).
- La suoneria predefinita era un `AudioContext` aperto senza clic, che WebView2 può lasciare sospeso: ora è un WAV generato una volta e suonato da `<audio>` come il file dell'utente (provato nell'anteprima: suona senza clic). Da riprovare sul centralino vero.
- Impostazioni → Integrazioni → Colore per ogni integrazione (`integrationColors`): pallino, card e personaggio con la scheda aperta. Provato nell'anteprima (scena `threecx`).

### 13 ottobre 2026 — versione 0.7.6
- Unione in `main` e tag `v0.7.6`: limiti del piano vecchi in grigio con il motivo, richiesta subito quando l'accesso di Claude Code cambia, «Aggiorna» della card Consumo che chiede subito (voce sotto). README con novità e tabella delle versioni.

### 13 ottobre 2026 — limiti del piano fermi a un numero vecchio
- L'isola diceva «7g 85%» con `/usage` al 94%: l'accesso in `.credentials.json` era scaduto (l'app desktop di Claude non lo rinnova) e restavano i numeri vecchi. Ora i numeri di oltre 15 minuti sono grigi nell'intestazione, con il motivo nel suggerimento e nella card (scena `usage&stale`); quando il file cambia si richiede subito (provato: rinnovo alle 06:10:24, numeri alle 06:11:13); «Aggiorna» della card chiede ad Anthropic senza aspettare il turno. Provato e tolto il rinnovo con `claude auth status`, che non rinnova (`docs/decisioni.md`).

### 12 ottobre 2026 — versione 0.7.5
- Unione in `main` e tag `v0.7.5`: 3CX «Questo PC» con suoneria e scheda da telefono, avvio sicuro dopo un aggiornamento (profilo WebView2) e dopo un riavvio del PC (timer senza `Instant - Duration`), campanella 3CX che cambia icona (voci sotto). README con novità e tabella delle versioni.
